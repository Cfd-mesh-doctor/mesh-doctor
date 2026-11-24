# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Mesh Doctor HTTP API, version 1 (docs/architecture.md, "API v1").

A table of routes that knows nothing about the HTTP server:

    status, document, headers = handle(method, path, query, body, content_type)

server.py runs the security checks first (host, origin, launch token) and then
hands every /api/v1 request here, so another server (or a test) can use the
same table.  Every answer is JSON.  Errors always look like

    {"error": {"code": "busy", "message": "another OpenFOAM job is running; ..."}}

with the HTTP status from STATUS.  The OpenAPI description is built from the
same table (GET /api/v1/openapi.json), so it cannot drift from the code.
"""
import json, math, os, re, threading, time

import jobs
import md_api
import pictures
import ramguard
import schema
import solve
import templates
import tplan
import validate
import version

API_VERSION = "1.16"
PREFIX = "/api/v1"
WRITES_MAX = solve.transient.MAX_WRITES   # the most times a stretch of a transient run writes
MAX_BODY = 64 * 1024

# error code -> HTTP status.  md_api refusals carry one of these codes.
STATUS = {
    "bad-request": 400, "forbidden": 403, "not-found": 404, "method-not-allowed": 405,
    "exists": 409, "finished": 409, "busy": 409, "not-ready": 409, "not-enough-memory": 409, "not-enough-disk": 409,
    "schema-version": 409,
    "too-large": 413, "unsupported-media-type": 415, "unsupported": 422,
    "internal": 500, "unavailable": 503,
}
NAME = {"type": "string", "pattern": md_api.SAFE.pattern,
        "description": "plain folder name: letters, digits, _ . - (no leading dot), at most 80 characters"}

# Routes that need the live monitor in server.py, which registers them with provide().
_live = {}


class ApiError(Exception):
    def __init__(self, code, message, headers=None):
        super().__init__(message)
        self.code, self.message, self.headers = code, message, headers or {}


def error_doc(code, message):
    return {"error": {"code": code, "message": message}}


def provide(**funcs):
    """server.py hands over its live-monitor functions: abtest_live(label), live()."""
    _live.update(funcs)


# --------------------------------------------------------------------------
# the route table

class Route:
    def __init__(self, method, template, func, summary, query, ok, status, body):
        self.method, self.template, self.func, self.summary = method, template, func, summary
        self.query, self.ok, self.status, self.body = query, ok, status, body
        self.names = re.findall(r"{(\w+)}", template)
        parts = re.split(r"({\w+})", template)
        self.rx = re.compile("^" + "".join(f"(?P<{x[1:-1]}>[^/]+)" if x.startswith("{") else re.escape(x)
                                           for x in parts) + "$")
        self.op = func.__name__.strip("_")


ROUTES = []


def route(method, template, summary, query=None, ok=None, status=200, body=None):
    """Register a handler f(path_args, query_args, body) -> document."""
    def deco(f):
        ROUTES.append(Route(method, template, f, summary, query or {}, ok, status, body))
        return f
    return deco


def _items(of):
    return {"type": "object", "required": ["items"], "properties": {"items": {"type": "array", "items": of}}}


def _ref(kind):
    """A response that is one of the versioned result documents (served under /schemas)."""
    return {"$ref": f"schemas/{kind}"}


def _name(v):
    if not md_api.SAFE.match(v):
        raise ApiError("bad-request", "bad name: " + NAME["description"])
    return v


def _found(doc, what):
    if doc is None:
        raise ApiError("not-found", f"no {what}")
    err = doc.get("error") if isinstance(doc, dict) else None
    if isinstance(err, dict) and err.get("code") == "schema-version":
        raise ApiError("schema-version", err.get("message", "newer file version"))
    return doc


@route("GET", "/", "This API: its version, the result-file versions, the OpenAPI document",
       ok={"type": "object", "required": ["apiVersion", "schemas"], "properties": {
           "apiVersion": {"type": "string", "description": "major.minor of this API"},
           "version": {"type": "string", "description": "the Mesh Doctor release"},
           "schemas": {"type": "object", "additionalProperties": {"type": "string"},
                       "description": "result-document kind: its schema version"},
           "openapi": {"type": "string"},
           "jobKinds": {"type": "array", "items": {"type": "string"}}}})
def info(p, q, b):
    return {"apiVersion": API_VERSION, "version": version.VERSION, "schemas": dict(schema.VERSIONS),
            "openapi": PREFIX + "/openapi.json", "jobKinds": sorted(JOBS)}


@route("GET", "/openapi.json", "This API described in OpenAPI 3.1", ok={"type": "object"})
def openapi_json(p, q, b):
    return openapi()


@route("GET", "/schemas/{kind}", "JSON Schema of a versioned result document (repair, abtest, judge, map)",
       ok={"type": "object"})
def result_schema(p, q, b):
    if p["kind"] not in schema.VERSIONS:
        raise ApiError("not-found", "no schema " + p["kind"][:40])
    return schema.schema(p["kind"])


@route("GET", "/cases", "Source cases this worker may read (never changed: a new case from a template goes in a "
       "new folder, listed once its mesh is made), with their sizes and which ones Mesh Doctor made",
       ok={"type": "object", "required": ["items", "cells"], "properties": {
           "items": {"type": "array", "items": {"type": "string"}},
           "cells": {"type": "object", "additionalProperties": {"type": ["integer", "null"]},
                     "description": "each case's cell count, from its mesh's owner header (summed over processors "
                                    "for a decomposed case); null when the header doesn't say (API 1.2)"},
           "made": {"type": "object", "additionalProperties": {
                        "type": "object", "additionalProperties": False, "properties": {
                            "template": {"type": "string", "description": "the template a case job made it from"},
                            "copyOf": {"type": "string",
                                       "description": "the case you made that a solve job copied it from, to solve"},
                            "transientOf": {"type": "string",
                                            "description": "the steady run a solve job made it a transient run of"}}},
                    "description": "the cases Mesh Doctor made, each with what from: a template, or a case you made "
                                   "(a copy of it, to solve); the cases a solve job takes (API 1.6)"},
           "results": {"type": "object", "additionalProperties": {"type": ["string", "null"]},
                       "description": "each case's latest written time with its face flux (phi), the result a "
                                      "transient plan starts from (a tplan job); null before one (API 1.8)"}}})
def cases(p, q, b):
    names = md_api.sources()
    root = md_api.run_dir()
    made = {n: m for n, m in ((n, md_api.made(os.path.join(root, n))) for n in names) if m is not None}
    return {"items": names, "cells": {n: ramguard.mesh_cells(os.path.join(root, n)) for n in names}, "made": made,
            "results": {n: _result(os.path.join(root, n)) for n in names}}


def _result(case):
    """The case's latest written time with its face flux (tplan.latest_time), or None; None too when it can't be
    read, as a case removed while it was listed."""
    try:
        return tplan.latest_time(case)[0]
    except (OSError, ValueError):
        return None


@route("GET", "/repairs", "Repair runs in the workspace, with their status and verdict",
       ok=_items({"type": "object", "required": ["name", "status"], "properties": {
           "name": {"type": "string"},
           "status": {"type": "object", "description": "the repair's own status.json (step, state); {} if none"},
           "source": {"type": ["string", "null"],
                      "description": "the source case's folder on the worker (finished runs)"},
           "profile": {"type": ["string", "null"]},
           "verdict": {"type": ["object", "null"], "required": ["improved", "regressions", "unchanged"],
                       "description": "checkMesh numbers that got better, worse, or stayed the same (finished runs)",
                       "properties": {k: {"type": "array", "items": {"type": "string"}}
                                      for k in ("improved", "regressions", "unchanged")}},
           "finished": {"type": ["string", "null"], "description": "the worker's local time, yyyy-mm-dd hh:mm:ss"},
           "nCells": {"type": ["integer", "null"]}}}))
def repairs(p, q, b):
    return {"items": md_api.results()}


@route("GET", "/repairs/{name}", "Result of a finished repair (meshDoctor/result.json)", ok=_ref("repair"))
def repair(p, q, b):
    return _found(md_api.result(_name(p["name"])), "finished result for repair " + p["name"])


# One defect cluster's shapes for a 3D view, as repair.cluster writes them (meshDoctor/clusters_<tag>/<id>.json).
_POLYGON = {"type": "array", "items": {"type": "number"},
            "description": "the polygon's corners in order, x y z after x y z, in metres"}
CLUSTER = {
    "type": "object", "required": ["cells", "ctx"],
    "properties": {
        "cells": {"type": "array", "description": "every face of the cells beside the cluster's failing faces "
                                                  "(at most 6000)",
                  "items": {"type": "object", "required": ["cell", "face", "bad", "hot", "xyz"], "properties": {
                      "cell": {"type": "integer", "description": "the cell, numbered in its processor's mesh when "
                                                                 "the case is decomposed"},
                      "face": {"type": "integer", "description": "the face, numbered like the cell"},
                      "bad": {"type": "number", "description": "the face's badness: its worst measure divided by "
                                                               "that measure's target, so above 1 fails the target"},
                      "hot": {"type": "boolean", "description": "one of this cluster's failing faces"},
                      "xyz": _POLYGON}}},
        "ctx": {"type": "array", "description": "boundary faces near the cluster (any patch but processor "
                                                "boundaries), to show where it is (at most 8000)",
                "items": {"type": "object", "required": ["patch", "xyz"], "properties": {
                    "patch": {"type": "string", "description": "the patch the face is on"},
                    "xyz": _POLYGON}}}}}


@route("GET", "/repairs/{name}/clusters/{id}", "Geometry of one defect cluster, before or after the repair",
       query={"tag": {"schema": {"enum": ["before", "after", "report"], "default": "before"},
                      "description": "which cluster list: before or after the repair, or the report"}},
       ok=CLUSTER)
def repair_cluster(p, q, b):
    if not re.fullmatch(r"[0-9]{1,9}", p["id"]):
        raise ApiError("bad-request", "cluster id must be a number")
    return _found(md_api.cluster(_name(p["name"]), q["tag"], p["id"]), f"cluster {p['id']} ({q['tag']})")


@route("GET", "/repairs/{name}/log", "The repair sweeps from the repair log",
       ok={"type": "object", "required": ["text"], "properties": {"text": {"type": "string"}}})
def repair_log(p, q, b):
    if not os.path.isdir(os.path.join(md_api.md_dir(), _name(p["name"]), "meshDoctor")):
        raise ApiError("not-found", "no repair run " + p["name"])
    return {"text": md_api.log_tail(p["name"])}


@route("GET", "/repairs/{name}/report",
       "Portable report: the repair, its map and its A/B test in one file, worker paths replaced (open it in /report)",
       query={"ab": {"schema": NAME, "description": "A/B test label to include (default: the run's own, if any)"}},
       ok=_ref("report"))
def repair_report(p, q, b):
    import report
    try:
        return report.build(_name(p["name"]), q.get("ab"))
    except FileNotFoundError as e:
        raise ApiError("not-found", str(e))
    except schema.SchemaError as e:
        raise ApiError("schema-version", getattr(e, "why", "newer file version"))


_TEXT = {"type": ["string", "null"]}
AB_BRIEF = {"type": "object", "required": ["step", "updated", "finished", "ratios", "verdict"], "properties": {
    "step": dict(_TEXT, description="its last step (ab_status.json): copying base, solving base, copying fixed, "
                                    "solving fixed, hotspots base or fixed, extending fixed <from> -> <to>, or done "
                                    "(done, but the SOURCE CASE CHANGED during the run: the case changed meanwhile); "
                                    "null when it has none"),
    "updated": dict(_TEXT, description="when that step began: the worker's local time, yyyy-mm-dd hh:mm:ss"),
    "finished": dict(_TEXT, description="when both runs had ended (ab_result.json): the worker's local time"),
    "ratios": {"type": "object", "additionalProperties": {"type": "number"},
               "description": "each field's median initial residual over the test's window, repaired ÷ original "
                              "mesh: below 1 the repaired mesh converges further (empty until both runs have ended)"},
    "verdict": dict(_TEXT, description="the judge's verdict on the repaired-mesh run, saved when `ab extend` "
                                       "continued the test; null otherwise (GET /abtests/{name}/judge judges any run)")}}


@route("GET", "/abtests", "A/B solver tests in the workspace, with each one's last step and outcome",
       ok={"type": "object", "required": ["items", "tests"], "properties": {
           "items": {"type": "array", "items": {"type": "string"}},
           "tests": {"type": "object", "additionalProperties": AB_BRIEF,
                     "description": "each test in items: its last step and, once both runs have ended, its outcome "
                                    "(API 1.3)"}}})
def abtests(p, q, b):
    names = md_api.ab_list()
    return {"items": names, "tests": {n: md_api.ab_brief(n) for n in names}}


_NUMBER = {"type": ["number", "null"]}
RESIDUALS = {"type": ["object", "null"], "required": ["cols", "rows"],
             "description": "a run's initial residuals: from its residuals function object, else from its solver "
                            "logs, thinned evenly to at most 400 rows and the last; null before the run has any",
             "properties": {
                 "cols": {"type": "array", "items": {"type": "string"}, "description": "Time, then each field"},
                 "rows": {"type": "array", "items": {"type": "array", "items": _NUMBER},
                          "description": "one row per iteration, in the order of cols (null: not solved then)"}}}
_MODE = {"type": "object", "required": ["from", "to", "summary", "nearDefects", "top"], "properties": {
    "from": {"type": ["string", "number", "null"], "description": "the earlier written time"},
    "to": {"type": ["string", "number", "null"], "description": "the later written time"},
    "summary": {"type": "object", "description": "the map's own numbers (foamResidualHotspots' summary)"},
    "nearDefects": dict(_NUMBER, description="the share of the change that lies near the mesh's defects, 0 to 1"),
    "top": {"type": "array", "description": "where the solution moves most, largest share first (at most 8)",
            "items": {"type": "object", "required": ["share", "nCells", "centroid"], "properties": {
                "share": {"type": "number", "description": "this group's share of the change, 0 to 1"},
                "nCells": {"type": "number", "description": "cells in the group"},
                "centroid": {"type": "array", "items": {"type": "number"}, "description": "x y z, in metres"},
                "h": dict(_NUMBER, description="the cells' typical size there, in metres"),
                "maxNonOrtho": dict(_NUMBER, description="the worst non-orthogonality there, in degrees")}}}}}
ABTEST = {"type": "object", "required": ["status", "result", "live", "modes"], "properties": {
    "status": {"type": ["object", "null"], "description": "the test's own ab_status.json: its last step and when "
               "that began, the worker's local time (see the steps in GET /abtests); null when it has none",
               "properties": {"step": {"type": "string"}, "time": {"type": "string"}}},
    "result": {"anyOf": [_ref("abtest"), {"type": "null"}],
               "description": "ab_result.json without the runs' residual histories (live has them). It is written "
                              "as each run ends, so while the repaired-mesh run solves it holds the original-mesh "
                              "run alone; null before that"},
    "live": {"type": "object", "required": ["base", "fixed"],
             "description": "each run's residuals as they are now: the original mesh (base) and the repaired one "
                            "(fixed), its continuations included",
             "properties": {"base": RESIDUALS, "fixed": RESIDUALS}},
    "modes": {"type": "array", "items": _MODE,
              "description": "slow-oscillation maps (abtest.py mode): where the repaired-mesh run's solution moves "
                             "between two written times a few hundred iterations apart"}}}


@route("GET", "/abtests/{name}", "An A/B test: its step, result (abtest schema), each run's residuals as they are "
       "now, and oscillation maps", ok=ABTEST)
def abtest(p, q, b):
    d = md_api.ab(_name(p["name"]))
    if not d or not d.pop("exists", False):
        raise ApiError("not-found", "no A/B test " + p["name"])
    if isinstance(d.get("result"), dict):
        _found(d["result"], "")
    return d


_STAGE = {"type": "object", "required": ["name", "from", "to"], "properties": {
    "name": {"type": "string", "description": "the settings of this stretch: the A/B run, or a continuation"},
    "from": {"type": "number"}, "to": {"type": "number"}}}
_TABLE = {"type": "object", "properties": RESIDUALS["properties"],
          "description": "initial residuals ({cols, rows} as in GET /abtests/{name}); {} before the run has any"}
LIVE = {"type": "object", "required": ["label", "status", "stages", "current", "solver", "residuals",
                                       "baseResiduals", "judge", "now"], "properties": {
    "label": {"type": "string", "description": "the A/B test"},
    "status": {"type": "object", "description": "its ab_status.json, as in GET /abtests/{name}; {} when it has none"},
    "stages": {"type": "array", "items": _STAGE,
               "description": "the repaired-mesh run's stretches: the A/B run, then each continuation"},
    "current": dict(_STAGE, description="the stretch the run is in now"),
    "solver": {"type": "object", "required": ["state", "end"],
               "description": "the repaired-mesh run's newest solver log", "properties": {
                   "state": {"enum": ["pending", "running", "done", "error", "stopped"],
                             "description": "pending: no log yet; stopped: running, but its log has not changed for "
                                            "5 minutes"},
                   "iteration": {"type": "number", "description": "the last iteration in the log"},
                   "end": {"type": "number", "description": "the iteration it runs to (endTime)"},
                   "wall_per_it": {"type": "number",
                                   "description": "seconds per iteration: the median of the last 40, or their mean "
                                                  "when the log's whole-second clock makes that 0; left out until it "
                                                  "can tell"},
                   "eta": {"type": "number", "description": "seconds left at that pace (while running; a "
                                                           "transient run's: its time steps left at its latest "
                                                           "time step)"},
                   "deltaT": {"type": "number", "description": "a transient run's latest time step in s, from its "
                                                              "log (API 1.6)"},
                   "clock": {"type": "number"}, "log": {"type": "string"},
                   "error": {"type": "string", "description": "the log's FOAM FATAL message (state error)"},
                   "idle_s": {"type": "number", "description": "seconds since the log changed (state stopped)"}}},
    "residuals": dict(_TABLE, description="the repaired-mesh run's residuals, at most 1500 rows; {} before it has any"),
    "baseResiduals": dict(_TABLE, description="the original-mesh run's residuals, at most 400 rows; {} if none"),
    "forces": {"type": "object", "description": "each force group's [iteration, drag, vertical] rows"},
    "forceInfo": {"type": "object", "description": "how to read them: total, groups, vertical, flow, up, source"},
    "judge": {"type": "object", "required": ["window"],
              "description": "the live judge, on the stretch the run is in (the same limits as abtest.judge)",
              "properties": {
                  "window": {"type": "integer", "description": "iterations judged"},
                  "verdict": {"type": "string", "description": "collecting: ... until the stretch has 40 iterations"},
                  "level": {"enum": ["ok", "warn", "err"]},
                  "average": {"type": "object", "description": "averaged forces with their uncertainty (batch means)"},
                  "avgFrom": {"type": "number"}}},
    "savedJudge": {"type": ["object", "null"], "description": "the verdict `ab extend` saved (fixedJudge)"},
    "settings": {"type": "object"}, "proc": {"type": "object"},
    "source": dict(_TEXT, description="the source case"), "variant": dict(_TEXT, description="second-run settings"),
    "labels": {"type": "array", "items": {"type": "string"}, "description": "every A/B test, as GET /abtests"},
    "now": {"type": "number", "description": "the worker's clock, seconds since 1970"}}}


@route("GET", "/abtests/{name}/live", "The steady-run page data: stages, residuals, forces, live judge", ok=LIVE)
def abtest_live(p, q, b):
    if not os.path.isdir(os.path.join(md_api.md_dir(), _name(p["name"]) + "_ab")):
        raise ApiError("not-found", "no A/B test " + p["name"])
    if "abtest_live" not in _live:
        raise ApiError("unavailable", "the live monitor is not running in this server")
    return _live["abtest_live"](p["name"])


@route("GET", "/live/abtest", "The A/B test running now, or else the one updated last: the same steady-run page "
       "data as /abtests/{name}/live, with its name in `label`", ok=LIVE)
def live_abtest(p, q, b):
    if "abtest_live" not in _live:
        raise ApiError("unavailable", "the live monitor is not running in this server")
    d = _live["abtest_live"]("")              # an empty name: the server picks the active test
    if not isinstance(d, dict) or "label" not in d:
        raise ApiError("not-found", "no A/B test in the workspace yet")
    return d


@route("GET", "/abtests/{name}/judge", "Is one side of an A/B test converged?  The judge on its original-mesh "
       "(base) or repaired-mesh (fixed) run; with `to`, as the run was at that iteration, so both sides can be "
       "judged over the same iterations",
       query={"side": {"schema": {"enum": ["base", "fixed"]}, "required": True,
                       "description": "base: the original mesh; fixed: the repaired mesh"},
              "window": {"schema": {"type": "integer", "minimum": 10, "maximum": 100000},
                         "description": "iterations to judge (default: half the run, 10 to 200)"},
              "to": {"schema": {"type": "number", "minimum": 0},
                     "description": "judge the run as it was at this iteration (default: all of it)"},
              "avgFrom": {"schema": {"type": "number", "minimum": 0},
                          "description": "average forces from this iteration on (default: the last 2 windows)"}},
       ok=_ref("judge"))
def abtest_judge(p, q, b):
    test, side = _name(p["name"]) + "_ab", q["side"]
    if side == "base" and not _is_case(test, side):
        test = _reused_base(test) or test     # a test made with --base-from: judge the run it reused
    if not _is_case(test, side):
        raise ApiError("not-found", f"no {side} run in A/B test {p['name']}")
    case = os.path.join(md_api.md_dir(), test, side)
    import abtest as ab, caseinfo           # only reads the logs and force files
    # log.foamRun_hot is the one-iteration hotspot run made after the test, not part of it
    logs = [f for f in caseinfo.solver_logs(case) if not f.endswith("_hot")] or None
    out = ab.judge(case, q.get("window"), avg_from=q.get("avgFrom"), to=q.get("to"), logs=logs)
    out["run"] = f"{test}/{side}"
    return out


def _is_case(test, side):
    return os.path.isfile(os.path.join(md_api.md_dir(), test, side, "system", "controlDict"))


def _reused_base(test):
    """The A/B folder whose original-mesh run this test reused (--base-from), if any.
    Only its folder name is taken from the file, so the answer stays in the workspace."""
    try:
        prev = schema.read(os.path.join(md_api.md_dir(), test, "ab_result.json"), "abtest").get("baseReusedFrom")
    except (OSError, ValueError):
        return None
    prev = os.path.basename(str(prev or "").rstrip("/"))
    return prev if prev.endswith("_ab") and md_api.SAFE.match(prev[:-3]) and prev != test else None


_live_judged = {}                           # (case, window, avgFrom, logs' size and time) -> verdict


@route("GET", "/live/judge", "Is the live (transient) run converged?  The transient judge on the live case's "
       "transient log (log.ddes*, else log.foamRun*): force means, per-time-step convergence, Courant number",
       query={"window": {"schema": {"type": "integer", "minimum": 10, "maximum": 100000},
                         "description": "time steps to judge (default: half the run, 10 to 200)"},
              "avgFrom": {"schema": {"type": "number", "minimum": 0},
                          "description": "average forces from this flow time on, in s (default: the last 2 windows)"}},
       ok=_ref("judge"))
def live_judge(p, q, b):
    if "live_case" not in _live:
        raise ApiError("unavailable", "the live monitor is not running in this server")
    case = _live["live_case"]() or ""
    if not os.path.isfile(os.path.join(case, "system", "controlDict")):
        raise ApiError("not-found", "this server watches no live case")
    import abtest as ab, caseinfo           # only reads the logs and force files
    logs = caseinfo.solver_logs(case, ("log.ddes*",)) or caseinfo.solver_logs(case)
    try:
        key = (case, q.get("window"), q.get("avgFrom"),
               tuple((f, os.path.getsize(f), os.path.getmtime(f)) for f in logs))
    except OSError:
        key = None                              # a log went away meanwhile: judge without the cache
    if not logs:
        raise ApiError("not-found", "the live case has no solver log yet")
    if key is None or key not in _live_judged:
        out = ab.judge(case, q.get("window"), avg_from=q.get("avgFrom"), logs=logs)
        if key is None:
            return out
        if len(_live_judged) >= 8:            # the log grows every step: keep only recent answers
            _live_judged.clear()
        _live_judged[key] = out
    return _live_judged[key]


@route("GET", "/maps", "Repair runs that have a repair map", ok=_items({"type": "string"}))
def maps(p, q, b):
    return {"items": md_api.map_list()}


@route("GET", "/maps/{name}", "Repair map: where the mesh was repaired, over where the flow does not settle",
       ok=_ref("map"))
def repair_map(p, q, b):
    return _found(md_api.mapdata(_name(p["name"])), "map for " + p["name"])


@route("GET", "/judge", "Is this source case converged?  Steady or transient verdict from its logs and forces",
       query={"case": {"schema": NAME, "required": True,
                       "description": "a case in the cases folder: a source case (GET /cases), or a folder "
                                      "with just system/ and the solver logs"},
              "window": {"schema": {"anyOf": [{"type": "integer", "minimum": 10, "maximum": 100000},
                                              {"enum": ["auto"]}], "default": 200},
                         "description": "iterations (steady) or time steps (transient) to judge, or auto: half the "
                                        "run's, 10 to 200, as meshdoctor judge <case> auto and a transient run's page "
                                        "judge it (API 1.11)"},
              "avgFrom": {"schema": {"type": "number", "minimum": 0},
                          "description": "average forces from this time on (default: the window)"},
              "log": {"schema": {"type": "string", "pattern": r"^log\.[A-Za-z0-9_.*-]{1,60}$"},
                      "description": "solver log file name or pattern in the case folder, such as log.pimple "
                                     "(default log.foamRun*)"}},
       ok=_ref("judge"))
def judge(p, q, b):
    case = os.path.join(md_api.run_dir(), q["case"])
    ws = md_api.md_dir().rstrip("/")
    if not os.path.isfile(os.path.join(case, "system", "controlDict")) or \
            (ws + "/").startswith(case.rstrip("/") + "/"):
        raise ApiError("not-found", "no case " + q["case"] + " in the cases folder")
    import abtest as ab, caseinfo           # only reads the logs and force files
    logs = None
    if q.get("log"):
        logs = caseinfo.solver_logs(case, (q["log"],))
        if not logs:
            raise ApiError("not-found", f"no log matches {q['log']} in case {q['case']}")
    window = None if q["window"] == "auto" else q["window"]       # auto: abtest.auto_window, from the run's length
    return ab.judge(case, window, avg_from=q.get("avgFrom"), logs=logs)


@route("GET", "/live", "The live (transient) case: forces, averaging window, time step, processes, memory",
       ok={"type": "object"})
def live(p, q, b):
    if "live" not in _live:
        raise ApiError("unavailable", "the live monitor is not running in this server")
    return _live["live"]()


@route("GET", "/templates", "Cases the engine can make (a `case` job): the templates in examples/, each with its "
       "mesh sizes and about how many cells each one makes (API 1.5)",
       ok=_items({"type": "object", "required": ["name", "label", "about", "size", "sizes"], "properties": {
           "name": {"type": "string", "description": "the template's folder in examples/, as a case job names it"},
           "label": {"type": "string"},
           "about": {"type": "string", "description": "what the case is, in a sentence or two"},
           "size": {"enum": templates.SIZES, "description": "the size a case job makes when it names none"},
           "sizes": {"type": "array", "items": {
               "type": "object", "required": ["name", "label", "cells", "about"], "properties": {
                   "name": {"enum": templates.SIZES},
                   "label": {"type": "string"},
                   "cells": {"type": "integer", "minimum": 1,
                             "description": "about how many cells the mesh has, as OpenFOAM 14 made it here"},
                   "about": {"type": "string", "description": "what the size is for"}}}}}}))
def list_templates(p, q, b):
    return {"items": templates.listing()}


_INT_OR_NULL = {"type": ["integer", "null"]}
_NUM_OR_NULL = {"type": ["number", "null"]}
RUN = {"type": "object", "required": ["name", "state", "step", "iteration", "start", "end", "written", "nProcs",
                                       "stretches", "started", "updated", "finished", "error"], "properties": {
    "name": {"type": "string", "description": "the case it solves: a case in the cases folder that Mesh Doctor made"},
    "state": {"enum": ["running", "done", "stopped", "failed", "cancelled", "interrupted"],
              "description": "stopped: ended at a written iteration before its end (Stop); interrupted: its status "
                             "says running but nothing solves it: no job, and no solve in a terminal (the computer "
                             "restarted, or the job or the solve was killed)"},
    "step": {"type": "string", "description": "copying (a copy of a case you made), meshing or meshing: <its mesh's "
                                             "step> (a case made from a template first), decomposing, potentialFoam, "
                                             "solving, reconstructing or done"},
    "iteration": dict(_NUM_OR_NULL, description="the last iteration in its solver log (a transient run's: the time "
                                                "in s, as are its other times)"),
    "start": {"type": "number", "description": "the iteration the latest stretch started from"},
    "end": dict(_NUM_OR_NULL, description="the iteration the latest stretch runs to (endTime)"),
    "written": {"type": "number", "description": "the latest iteration written, which a continuation starts from"},
    "nProcs": dict(_INT_OR_NULL, description="the processes it runs on; 1: the case isn't split"),
    "stretches": {"type": "array", "description": "the stretches solved so far, oldest first", "items": {
        "type": "object", "required": ["from", "to"],
        "properties": {"from": {"type": "number"}, "to": {"type": "number"}}}},
    "started": dict(_TEXT, description="when the latest stretch started (UTC)"),
    "updated": dict(_TEXT, description="when its status last changed (UTC)"),
    "finished": dict(_TEXT, description="when the latest stretch ended (UTC); null while it runs"),
    "error": dict(_TEXT, description="why it failed (state failed), naming no folders"),
    "transient": {"type": ["object", "null"], "required": ["steady", "at", "maxCo", "model"],
                  "description": "a transient run: the steady run it started from, and the time of that run's result "
                                 "it took (at), its largest Courant number and its model; null for a steady run "
                                 "(API 1.6)", "properties": {
                      "steady": {"type": "string"}, "at": {"type": "string"},
                      "maxCo": {"type": ["number", "null"]}, "model": {"type": ["string", "null"]},
                      "writes": {"type": "integer", "minimum": 1, "maximum": WRITES_MAX,
                                 "description": "the times each of its stretches writes, evenly to its end: it keeps "
                                                "every one (4 for a run that never asked) (API 1.10)"}}},
    "averaging": {"type": ["object", "null"], "required": ["from", "settled", "written"],
                  "description": "a transient run's averaged flow (the fieldAverage meanFlow: UMean, pMean, UPrime2Mean "
                                 "and pPrime2Mean in each time it writes), which the solve switches on once its forces "
                                 "have settled, as the transient judge finds that; all null until then; null for a "
                                 "steady run, or a transient run with none (made before API 1.9 and not solved "
                                 "since, as its next solve gives it one; or with a fieldAverage of its own) (API "
                                 "1.9)", "properties": {
                      "from": dict(_NUM_OR_NULL, description="the time it averages from, in s: the latest time "
                                                             "written with it less its averaging's totalTime, else the "
                                                             "time the solver was at when it was switched on"),
                      "settled": dict(_NUM_OR_NULL, description="when its forces had settled then, in s"),
                      "written": dict(_NUM_OR_NULL, description="the latest time written with it, in s; null before "
                                                                "one")}},
    "times": {"type": "array", "items": {"type": "number"},
              "description": "the written times it keeps, oldest first, not its start: its processors' and its own "
                             "when it is split (a transient run keeps every one; a steady run as many as its "
                             "controlDict's purgeWrite says) (API 1.10)"},
    "joined": {"type": "array", "items": {"type": "number"},
               "description": "those of its times that are joined, the whole mesh's, in the case's own folder: every "
                              "one when it isn't split, else the latest of each stretch (API 1.10)"}}}
RUN_ONE = dict(RUN, properties=dict(RUN["properties"], links={
    "type": "object", "description": "itself, Stop, and its convergence judge (GET /judge?case=; a transient run's "
                                     "with window=auto, over the last half of its time steps as its page judges it, "
                                     "API 1.11)"}))


def _run_out(run):
    me = f"{PREFIX}/runs/{run['name']}"
    judge = f"{PREFIX}/judge?case={run['name']}" + ("&window=auto" if run.get("transient") else "")
    return dict(run, links={"self": me, "stop": me + "/stop", "judge": judge})


@route("GET", "/runs", "Solves of cases Mesh Doctor made (`solve` jobs), the newest first (API 1.6)", ok=_items(RUN))
def list_runs(p, q, b):
    return {"items": solve.runs()}


@route("GET", "/runs/{name}", "One run: its state, the iteration it is at, the stretches solved, and its links "
       "(API 1.6)", ok=RUN_ONE)
def get_run(p, q, b):
    return _run_out(_found(solve.describe(_name(p["name"])), "run " + p["name"]))


@route("POST", "/runs/{name}/stop", "Stop a run at a written iteration: it writes the iteration it is at and ends, "
       "so a later solve job continues from there.  Needs the token or pairing key (API 1.6)", ok=RUN_ONE)
def stop_run(p, q, b):
    run, why = solve.stop(_name(p["name"]))
    if why:
        raise ApiError(*why)
    return _run_out(run)


_AGAINST = {"type": "number", "description": "percent: this run's drag against it"}
VALIDATION = {"type": "object", "required": ["name", "state", "template", "size", "slant", "cells", "iterations",
                                              "window", "cd", "cl", "drift", "tunnel", "published", "comparable",
                                              "matches"], "properties": {
    "name": {"type": "string", "description": "the run: a case made from the Ahmed body template"},
    "state": RUN["properties"]["state"],
    "template": {"type": "string", "description": "the template it was made from (ahmed-body)"},
    "size": {"enum": templates.SIZES, "description": "its mesh: the accuracy check has a run of each"},
    "slant": {"type": "integer", "description": "the body's rear slant, in degrees"},
    "cells": dict(_INT_OR_NULL, description="its mesh's cells"),
    "iterations": {"type": "integer", "description": "the last iteration with force coefficients"},
    "window": {"type": "integer", "description": "the iterations its drag and lift are averaged over: the last "
                                                 "quarter, as the accuracy check takes them"},
    "cd": {"type": "number", "description": "its drag coefficient: the window's mean"},
    "cl": {"type": "number", "description": "its lift coefficient: the window's mean"},
    "drift": {"type": "number", "description": "percent: the drag of the window's second half against its first; "
                                               "near 0 once it has settled"},
    "tunnel": {"type": "object", "required": ["cd", "difference"], "properties": {
        "cd": {"type": "number", "description": "the wind tunnel's drag coefficient (Ahmed, Ramm & Faltin 1984)"},
        "difference": _AGAINST}},
    "published": {"type": "object", "required": ["cd", "cl", "iterations", "difference"],
                  "description": "the accuracy check's run of the same mesh (docs/validation.md)", "properties": {
                      "cd": {"type": "number"}, "cl": {"type": "number"},
                      "iterations": {"type": "integer", "description": "what it was solved to"},
                      "difference": _AGAINST}},
    "comparable": {"type": "boolean", "description": "solved to the accuracy check's iterations or more"},
    "matches": {"type": "boolean", "description": f"comparable, and its drag within {validate.MATCH:g} % of the "
                                                  "accuracy check's: the install gives the same answer"}}}


@route("GET", "/runs/{name}/validation", "Verify install: how a run of the Ahmed body template compares with the "
       "wind tunnel and with the accuracy check's run of the same mesh (docs/validation.md), its drag and lift taken "
       "over the last quarter of its iterations (API 1.6)", ok=VALIDATION)
def run_validation(p, q, b):
    doc, why = validate.of_run(_name(p["name"]))
    if why:
        raise ApiError(*why)
    return doc


_SOLVER = LIVE["properties"]["solver"]
_STEPS = {"type": "object", "required": ["cols", "rows"],
          "description": "a transient run's time steps from its solver logs, only for a transient run: its time "
                         "step (deltaT, s) and Courant number (coMean, coMax) at each; at most 1500 rows, past that "
                         "each row a run of steps: its last time, their mean time step and Courant number and the "
                         "largest of their largest",
          "properties": {"cols": {"type": "array", "items": {"type": "string"},
                                  "description": "Time, deltaT, coMean, coMax"},
                         "rows": {"type": "array", "items": {"type": "array", "items": _NUMBER},
                                  "description": "one row per time step, in the order of cols (null: not in the "
                                                 "log)"}}}
RUN_LIVE = {"type": "object", "required": ["name", "run", "stages", "current", "solver", "residuals", "forces",
                                           "forceInfo", "judge", "now"], "properties": {
    "name": {"type": "string", "description": "the case it solves"},
    "run": dict(RUN, description="the run, as GET /runs/{name} has it"),
    "stages": {"type": "array", "items": _STAGE,
               "description": "its stretches: the first solve, then each continuation; while it solves, the stretch "
                              "it is in comes last"},
    "current": dict(_STAGE, description="the stretch it is in now, or else its last"),
    "solver": dict(_SOLVER, description="the solver log of the stretch it is in (log.foamRun, or log.foamRun_to_<end> "
                                        "for a continuation); stopped: its log ended without End (a Stop's ends "
                                        "with it) or hasn't changed for 5 minutes"),
    "residuals": dict(_TABLE, description="its initial residuals over all its stretches, at most 1500 rows; {} "
                                          "before it has any"),
    "forces": LIVE["properties"]["forces"], "forceInfo": LIVE["properties"]["forceInfo"],
    "steps": _STEPS,
    "judge": dict(LIVE["properties"]["judge"], description="the live judge on the whole run, whose stretches share "
                                                           "their settings (the same limits as abtest.judge); a "
                                                           "transient run's is the transient judge, in time steps, as "
                                                           "GET /judge?case=&window=auto answers it: over the last half "
                                                           "of its time steps (10 to 200), its forces averaged from when they "
                                                           "settled (`settled`), judged again at most every 15 s while "
                                                           "it solves"),
    "now": LIVE["properties"]["now"]}}


@route("GET", "/runs/{name}/live", "A run's page data: its stretches, the solver's iteration and pace, its residuals "
       "and forces, and the live judge (API 1.6)", ok=RUN_LIVE)
def run_live(p, q, b):
    name = _name(p["name"])
    if "run_live" not in _live:
        raise ApiError("unavailable", "the live monitor is not running in this server")
    return _found(_live["run_live"](name), "run " + name)


@route("GET", "/tplans/{name}", "The transient plan a tplan job made of a case: from its latest result, the time "
       "step a transient run of it would need at each Courant number, which cells set it (where they are, their "
       "nearest wall, the flow's speed and their shape there, and the cell set of them it wrote), and the steps and "
       "hours such a run would take (API 1.6)", ok=_ref("tplan"))
def transient_plan(p, q, b):
    doc, why = tplan.of(_name(p["name"]))
    if why:
        raise ApiError(*why)
    return doc


@route("GET", "/variants", "Solver-setting variants an A/B second run can use",
       ok=_items({"type": "object", "required": ["name", "label"],
                  "properties": {"name": {"type": "string"}, "label": {"type": "string"}}}))
def variants(p, q, b):
    return {"items": md_api.variants()}


# --- jobs -----------------------------------------------------------------
# One entry per kind: the params it takes (a JSON Schema, also used in the
# OpenAPI document) and how to start it.  Every job works on copies.

def _params(props, required):
    return {"type": "object", "required": required, "additionalProperties": False, "properties": props}


REPLACE = {"type": "boolean", "default": False,
           "description": "replace an existing run of the same name (its results are deleted)"}
JOBS = {
    "repair": {
        "summary": "copy a source case, checkMesh, repair the copy, checkMesh again",
        "params": _params({"source": dict(NAME, description="source case (GET /cases)"),
                           "name": dict(NAME, description="name of the new workspace run"),
                           "profile": {"enum": ["openfoam", "strict"], "default": "openfoam"},
                           "replace": REPLACE}, ["source", "name"]),
        "start": lambda a: md_api.start(a["source"], a["name"], a["profile"], replace=a["replace"]),
        "links": lambda n: {"repair": f"{PREFIX}/repairs/{n}", "log": f"{PREFIX}/repairs/{n}/log"},
    },
    "abtest": {
        "summary": "solve the original and the repaired mesh with the same settings and compare",
        "params": _params({"name": dict(NAME, description="a finished repair run (GET /repairs)"),
                           "iters": {"type": "integer", "minimum": 20, "maximum": 2000, "default": 200},
                           "init": {"enum": ["auto", "0.warm", "0.cold", "0"], "default": "auto",
                                    "description": "the case's folder both runs start from; auto: 0.warm when "
                                                   "the case has one, else 0"},
                           "variant": {"type": "string", "default": "",
                                       "description": "solver-setting variant for the second run (GET /variants)"},
                           "replace": REPLACE}, ["name"]),
        "start": lambda a: md_api.ab_start(a["name"], a["iters"], a["init"], a["variant"], replace=a["replace"]),
        "links": lambda n: {"abtest": f"{PREFIX}/abtests/{n}", "live": f"{PREFIX}/abtests/{n}/live"},
    },
    "abextend": {
        "summary": "continue the second run of a finished A/B test and judge it again",
        "params": _params({"name": dict(NAME, description="an A/B test (GET /abtests)"),
                           "to": {"type": "integer", "minimum": 21, "maximum": 5000,
                                  "description": "continue to this iteration, past the one the second run is at "
                                                 "now (the A/B test's iterations, or where an earlier extension "
                                                 "ended)"}}, ["name", "to"]),
        "start": lambda a: md_api.ab_extend(a["name"], a["to"]),
        "links": lambda n: {"abtest": f"{PREFIX}/abtests/{n}", "live": f"{PREFIX}/abtests/{n}/live"},
    },
    "case": {
        "summary": "make a new case from a template: copy it into the cases folder under a new name and mesh it",
        "params": _params({"template": dict(NAME, description="a template (GET /templates)"),
                           "size": {"enum": templates.SIZES, "default": "medium",
                                    "description": "one of the template's mesh sizes"},
                           "name": dict(NAME, description="the new case's folder in the cases folder: a name not "
                                                          "taken there"),
                           "replace": {"type": "boolean", "default": False,
                                       "description": "make again a case of the same name that an earlier case job "
                                                      "made (deleted first, with everything in it); a case Mesh "
                                                      "Doctor didn't make is never replaced"}}, ["template", "name"]),
        "start": lambda a: templates.start(a["template"], a["size"], a["name"], replace=a["replace"]),
        "links": lambda n: {"cases": f"{PREFIX}/cases"},
    },
    "solve": {
        "summary": "solve a case Mesh Doctor made to an iteration: while none is written it splits the case, starts "
                   "the flow with potentialFoam and runs foamRun; once one is written it continues from the latest. "
                   "With a source, it first makes the case as a copy of a case you made; with a template, it first "
                   "makes it from the template, as a case job does; with a steady run, it first makes it a transient "
                   "run of that one, solved in time to a time in s",
        "params": _params({"name": dict(NAME, description="a case in the cases folder that Mesh Doctor made (a case "
                                                          "job's, or a copy); with a source or a template, the new "
                                                          "case it makes, a name not taken there"),
                           "source": dict(NAME, description="a case you made, to solve a copy of: its mesh and "
                                                            "settings, not its results, are copied into the cases "
                                                            "folder as name (a case you made is never changed). It "
                                                            "needs its mesh joined, its 0 (or 0.orig) fields and a "
                                                            "steady foamRun setup"),
                           "template": dict(NAME, description="a template (GET /templates) to make the case from "
                                                              "first, as a case job does (Verify install: the Ahmed "
                                                              "body's coarse mesh, solved to 2000)"),
                           "size": {"enum": templates.SIZES, "description": "with a template: one of its mesh sizes "
                                                                            "(default: the template's own)"},
                           "steady": dict(NAME, description="a solved steady run (GET /runs) to start a "
                                                            "transient run of: the new case name takes its mesh, "
                                                            "settings and latest result, and is solved in time "
                                                            "from there, with no potentialFoam (API 1.6)"),
                           "maxCo": {"type": "number", "minimum": 0, "maximum": 20,
                                     "description": "with steady: the largest Courant number the time step keeps "
                                                    "to (default 1; DDES 2 or less)"},
                           "model": {"enum": ["DDES", "URANS"],
                                     "description": "with steady: DDES (kOmegaSSTDES with F2 shielding: the wake's "
                                                    "eddies resolved, the boundary layers RANS; the default), or "
                                                    "URANS (the steady run's RAS model, in time)"},
                           "writes": {"type": "integer", "minimum": 1, "maximum": WRITES_MAX,
                                      "description": "for a transient run, new (with steady) or continued: the times "
                                                     "each stretch writes, evenly to its end, each kept (a new "
                                                     "one's default 4; a continuation's, the run's own), which its "
                                                     "later stretches write too (API 1.10)"},
                           "to": {"type": "number", "minimum": 0, "maximum": solve.MAX_ITERS,
                                  "description": "the iteration to solve to (a whole number; 2000 by default), or "
                                                 "for a transient run the time in s (a new one's default: 8 flow "
                                                 "times over the body, 8 L/U); past the latest written one"},
                           "np": {"type": "integer", "minimum": 1, "maximum": 64, "default": 4,
                                  "description": "processes for a solve from iteration 0 (1: not split); a "
                                                 "continuation keeps the run's own"}}, ["name"]),
        "start": lambda a: solve.start(a["name"], a.get("to"), a["np"], a.get("source"), a.get("template"),
                                       a.get("size"), a.get("steady"), a.get("maxCo"), a.get("model"),
                                       a.get("writes")),
        "links": lambda n: {"run": f"{PREFIX}/runs/{n}"},
    },
    "tplan": {
        "summary": "plan a transient run of a solved case: from its latest result, the time step its mesh allows at "
                   "each Courant number, which cells set it, and the steps and hours such a run would take. The case "
                   "is only read: OpenFOAM works in a throwaway shadow case of links to it, and the cell set of the "
                   "fastest cells goes in the workspace, beside the plan",
        "params": _params({"name": dict(NAME, description="a case in the cases folder with a solved result: a run "
                                                          "(GET /runs), or a case you made (GET /cases)")}, ["name"]),
        "start": lambda a: tplan.start(a["name"]),
        "links": lambda n: {"tplan": f"{PREFIX}/tplans/{n}"},
    },
    "pictures": {
        "summary": "make pictures of a solved case's flow with ParaView, offscreen, at a written time, or of a "
                   "transient run's mean flow: cuts from its cut list (cuts.json) or made from its model's size, its "
                   "vortices, and any spot of unphysical pressure on its walls (Cp below -5: a numerical error). The "
                   "case is only read: ParaView reads it through a folder of links, and the pictures go in the "
                   "workspace, with a list of them; a computer's first set starts with ParaView's self test (API "
                   "1.15; the mean flow and the self test, API 1.16)",
        "params": _params({"name": dict(NAME, description="a case in the cases folder with a written result: a run "
                                                          "(GET /runs), or a case you made (GET /cases)"),
                           "time": {"type": "string", "default": "", "pattern": r"^([0-9][0-9.eE+-]*)?$",
                                    "description": "the written time to picture, as its folder says it (default: "
                                                   "the latest on the case's whole mesh; with mean, the latest with "
                                                   "a mean flow)"},
                           "kinds": {"type": "string", "default": ",".join(pictures.KINDS),
                                     "pattern": r"^(cuts|vortices|spots)(,(cuts|vortices|spots))*$",
                                     "description": "what to make, comma-separated: cuts, vortices, spots"},
                           "mean": {"type": "boolean", "default": False,
                                    "description": "a transient run's mean flow (UMean and pMean) in place of the "
                                                   "flow at that time: a time written once its averaging is on (GET "
                                                   "/runs' averaging); its set is <time>_mean (API 1.16)"}},
                          ["name"]),
        "start": lambda a: pictures.start(a["name"], a["time"] or None, tuple(dict.fromkeys(a["kinds"].split(","))),
                                          a["mean"]),
        "links": lambda n: {},
    },
}
JOB_REQUEST = {"oneOf": [
    {"type": "object", "required": ["kind", "params"], "additionalProperties": False,
     "description": j["summary"],
     "properties": {"kind": {"enum": [k]}, "params": j["params"]}} for k, j in JOBS.items()]}
def _job_out(job):
    """A job document with the links a client follows (the job, cancelling it, its run)."""
    me = f"{PREFIX}/jobs/{job['id']}"
    return dict(job, links={"self": me, "cancel": me + "/cancel", **JOBS[job["kind"]]["links"](job["name"])})


def _job(job_id):
    if not jobs.ID.match(job_id):
        raise ApiError("bad-request", "bad job id")
    job = jobs.get(job_id)
    if job is None:
        raise ApiError("not-found", "no job " + job_id)
    return job


@route("GET", "/machine", "The computer this engine runs on, as Linux sees it (inside WSL: what WSL was given): "
       "processors, cores and memory, for the app's size estimator",
       ok={"type": "object", "required": ["cpus", "cores", "memoryMb", "ramLimitMb"], "properties": {
           "cpus": {"type": ["integer", "null"], "description": "logical processors"},
           "cores": {"type": ["integer", "null"],
                     "description": "physical cores (/proc/cpuinfo), so the threads of one core count once; "
                                    "null when it doesn't say"},
           "memoryMb": {"type": ["integer", "null"], "description": "all the memory Linux may use (MemTotal)"},
           "ramLimitMb": {"type": ["integer", "null"],
                          "description": "the ram_limit_mb setting: the most memory a job may use; null if none"}}})
def machine(p, q, b):
    return ramguard.machine()


_SOLVES = {"type": ["object", "null"], "required": ["several", "one"], "properties": {
    "several": {"type": "integer", "minimum": 0, "description": "on several processes"},
    "one": {"type": "integer", "minimum": 0, "description": "on one process"}}}
DISK_CASE = {"type": ["object", "null"], "required": ["name", "copyMb", "transientMb", "solveMb", "continueMb"],
             "description": "with `case`: what solving it takes on the disk", "properties": {
    "name": NAME,
    "copyMb": {"type": "integer", "minimum": 0,
               "description": "a copy of it, as a solve of a case you made makes one: its mesh, settings and initial "
                              "fields, as the copy walks it (links followed)"},
    "transientMb": {"type": ["integer", "null"], "minimum": 0,
                    "description": "a transient run of it: its copy, with its latest result in place of its initial "
                                   "fields; null when it has no joined result to start from"},
    "solveMb": dict(_SOLVES, description="what a solve of it from the start writes as it goes: its split and its "
                                         "written times (meshdoctor/diskguard.py), as a solve of a copy of it or of a "
                                         "transient run of it does too; null when it has no mesh to measure"),
    "continueMb": dict(_SOLVES, description="what a continuation of it writes as it goes: on several processes its "
                                            "latest time joined, and its written times when it keeps every one "
                                            "(purgeWrite 0), a transient run's with its averaged flow, `writes` of "
                                            "them (else its own); null when it has no mesh to measure"),
    "transientSolveMb": dict(_SOLVES, description="what a transient run of it writes as it goes from the start: its "
                                                  "split, and its `writes` written times (else 4), each kept, with its "
                                                  "averaged flow, and on several processes its latest time joined; "
                                                  "null when it has no joined result to start from, or no mesh to "
                                                  "measure (API 1.9)")}}
DISK_TEMPLATE = {"type": ["object", "null"], "required": ["name", "size", "madeMb", "solveMb"],
                 "description": "with `template`: what a solve job that makes a case of it takes on the disk, as its "
                                "disk guard counts it (API 1.13)", "properties": {
    "name": NAME,
    "size": {"enum": templates.SIZES, "description": "the mesh size it counts: `size`, else the template's own"},
    "madeMb": {"type": "integer", "minimum": 0,
               "description": "the new case: its mesh and the sets snappyHexMesh writes of its layers, from the cells "
                              "it makes, as GET /disk/case counts them"},
    "solveMb": dict(_SOLVES, type="object",
                    description="what its solve writes as it goes from the start: its split and its written times "
                                "(meshdoctor/diskguard.py); the disk guard counts the new case and this")}}


@route("GET", "/disk", "The free space for a new case in the cases folder, which the disk guard checks a solve "
       "against, and with `case`, what solving that case takes on the disk, in MB (API 1.7); with `template`, what a "
       "solve that makes a case of it takes, as Verify install's does (API 1.13)",
       query={"case": {"schema": NAME, "description": "a case in the cases folder (GET /cases)"},
              "writes": {"schema": {"type": "integer", "minimum": 1, "maximum": WRITES_MAX},
                         "description": "with `case`: the times each stretch of a transient run writes, for "
                                        "transientSolveMb (a new transient run of it) and, when it is a transient "
                                        "run, continueMb (API 1.10)"},
              "template": {"schema": NAME, "description": "a template (GET /templates), for what a solve job that "
                                                          "makes a case of it takes (API 1.13)"},
              "size": {"schema": JOBS["solve"]["params"]["properties"]["size"],
                       "description": "with `template`: one of its mesh sizes (default: the template's own), as a "
                                      "solve job takes it (API 1.13)"}},
       ok={"type": "object", "required": ["freeMb", "keepMb", "case"], "properties": {
           "freeMb": {"type": ["integer", "null"], "minimum": 0,
                      "description": "the free space for a new case in the cases folder: its disk's, and inside WSL 2 "
                                     "at most that of the Windows drive that holds Linux's own disk; null when it "
                                     "can't be read"},
           "keepMb": {"type": "integer", "minimum": 0,
                      "description": "kept free for everything else: the disk guard refuses a solve when the new case "
                                     "it makes, what it writes and this are more than freeMb"},
           "case": DISK_CASE, "template": DISK_TEMPLATE}})
def disk(p, q, b):
    import diskguard
    root = md_api.run_dir()
    doc = {"freeMb": diskguard.free_mb(root), "keepMb": diskguard.KEEP_MB, "case": None, "template": None}
    if q.get("size") and not q.get("template"):
        raise ApiError("bad-request", "a mesh size goes with a template")
    if q.get("case"):
        if not os.path.isfile(os.path.join(root, q["case"], "system", "controlDict")):
            raise ApiError("not-found", "no case " + q["case"] + " in the cases folder")
        doc["case"] = solve.disk(q["case"], q.get("writes"))
    if q.get("template"):
        why = templates.problem(q["template"], q.get("size") or solve.own_size(q["template"]))
        if why:
            raise ApiError(*why)
        doc["template"] = solve.template_disk(q["template"], q.get("size"))
    return doc


DISK_JOB = {"type": "object", "required": ["needMb", "freeMb", "keepMb", "folder"], "properties": {
    "needMb": {"type": ["integer", "null"], "minimum": 0,
               "description": "what the job writes on the disk as it goes, as the engine's disk guard counts it before "
                              "the job starts (meshdoctor/diskguard.py); null when it can't be measured, and the "
                              "guard lets the job through"},
    "freeMb": {"type": ["integer", "null"], "minimum": 0,
               "description": "the free space of the disk it writes on (inside WSL 2, at most that of the Windows "
                              "drive that holds Linux's own disk); null when it can't be read"},
    "keepMb": {"type": "integer", "minimum": 0,
               "description": "kept free for everything else: the disk guard refuses the job when what it writes and "
                              "this are more than freeMb"},
    "folder": {"enum": ["workspace", "cases"],
               "description": "where it writes: the engine's workspace (a repair, an A/B test) or its cases folder (a "
                              "new case)"}}}


def _disk_job(planned, folder):
    """A GET /disk/{kind} answer, from what a job's start works out for its disk guard: ((MB, folder, what), None),
    or (None, the refusal the job's start would give), which this gives too."""
    import diskguard
    disk, why = planned
    if why:
        raise ApiError(why.get("code", "bad-request"), why.get("error", "refused"))
    return {"needMb": disk[0], "freeMb": diskguard.free_mb(disk[1]), "keepMb": diskguard.KEEP_MB, "folder": folder}


def _job_query(kind, name, description=None):
    """A GET /disk/{kind} query parameter that is job `kind`'s own parameter `name` (its schema from JOBS)."""
    sch = JOBS[kind]["params"]["properties"][name]
    return {"schema": sch, "description": description or sch.get("description", "")}


@route("GET", "/disk/repair", "What a repair of a case writes in the engine's workspace, as the disk guard counts it "
       "before the repair starts (its copy, a backup of each mesh's points, the sets it writes, and room to collapse "
       "faces in the mesh it repairs), and the free space there, in MB (API 1.12)",
       query={"source": {"schema": NAME, "required": True, "description": "the case to repair (GET /cases)"}},
       ok=DISK_JOB)
def disk_repair(p, q, b):
    return _disk_job(md_api.repair_disk(q["source"]), "workspace")


@route("GET", "/disk/abtest", "What an A/B test of a finished repair writes in the engine's workspace, as the disk "
       "guard counts it before the test starts (a copy of the case for each run it solves, with its split and two "
       "written times; one run when it reuses an earlier test's first run), and the free space there, in MB "
       "(API 1.12)",
       query={"name": {"schema": NAME, "required": True, "description": "a finished repair run (GET /repairs)"},
              "iters": _job_query("abtest", "iters", "each run's iterations, as the test would take them (an earlier "
                                                     "test's first run is reused only with the same ones)"),
              "init": _job_query("abtest", "init"), "variant": _job_query("abtest", "variant")},
       ok=DISK_JOB)
def disk_abtest(p, q, b):
    return _disk_job(md_api.ab_disk(q["name"], q["iters"], q["init"], q["variant"]), "workspace")


@route("GET", "/disk/abextend", "What running an A/B test's second run longer writes in the engine's workspace, as the "
       "disk guard counts it before it starts (the times it writes, split), and the free space there, in MB "
       "(API 1.12)",
       query={"name": {"schema": NAME, "required": True, "description": "an A/B test (GET /abtests)"},
              "to": dict(_job_query("abextend", "to"), required=True)},
       ok=DISK_JOB)
def disk_abextend(p, q, b):
    return _disk_job(md_api.extend_disk(q["name"], q["to"]), "workspace")


@route("GET", "/disk/case", "What making a new case from a template writes in the cases folder, as the disk guard "
       "counts it before the case job starts (its mesh, and the sets snappyHexMesh writes of its layers), and the "
       "free space there, in MB (API 1.12)",
       query={"template": {"schema": NAME, "required": True, "description": "a template (GET /templates)"},
              "size": _job_query("case", "size")},
       ok=DISK_JOB)
def disk_case(p, q, b):
    return _disk_job(templates.disk_of(q["template"], q["size"]), "cases")


NULL_TEXT = {"type": ["string", "null"]}
CELLS = {"type": ["integer", "null"], "minimum": 0}
READINESS = {"type": "object", "required": ["ready", "checks", "memory", "checked"], "properties": {
    "ready": {"type": "boolean",
              "description": "no check failed: a repair, an A/B test and a solve can run here (a warning doesn't "
                             "stop them)"},
    "checks": {"type": "array", "items": {
        "type": "object", "required": ["id", "label", "group", "state", "found", "fix", "command"], "properties": {
            "id": {"type": "string",
                   "description": "python, numpy, cases, workspace, openfoam, pvbatch (API 1.14), memory, or a "
                                  "program's name"},
            "label": {"type": "string"},
            "group": {"enum": ["python", "folders", "openfoam", "programs", "pictures", "memory"],
                      "description": "programs are checked only once an OpenFOAM environment is found; pictures: "
                                     "ParaView's pvbatch, which only pictures of the flow need, so a warning without "
                                     "it (API 1.14)"},
            "state": {"enum": ["ok", "warn", "fail"]},
            "found": {"type": "string", "description": "what the check found"},
            "fix": dict(NULL_TEXT, description="what to do about a warning or a failure; a command, setting or "
                                               "file name in it is in backticks"),
            "command": dict(NULL_TEXT, description="the command for the fix, to copy: one that does it, or one "
                                                   "that shows what it needs")}}},
    "memory": {"type": "object", "required": ["availableMb", "limitMb", "cells"], "properties": {
        "availableMb": {"type": ["integer", "null"],
                        "description": "the memory free now (MemAvailable), at most ram_limit_mb: what the RAM "
                                       "guard checks a job against; null when it is unknown"},
        "limitMb": {"type": ["integer", "null"], "description": "the ram_limit_mb setting; null if none"},
        "cells": {"type": "object", "required": ["repair", "solve"],
                  "properties": {"repair": CELLS, "solve": CELLS},
                  "description": "the largest mesh, in cells, that the RAM guard lets a repair or a solve take in "
                                 "that memory; null when it is unknown"}}},
    "checked": {"type": "string", "description": "when the checks ran (UTC)"}}}
# One check at a time: a request that comes while one runs gets its answer, and one just after reuses it.
_check = {"lock": threading.Lock(), "at": -1e9, "doc": None}
CHECK_REUSE_S = 2.0


@route("GET", "/check", "Is this computer ready?  `meshdoctor check` as JSON: Python, numpy, the folders, "
       "OpenFOAM 14, the programs a repair, an A/B test and a solve run, ParaView for pictures of the flow (API "
       "1.14), and the memory, each with what was found and the fix, never this machine's folders (API 1.4)",
       ok=READINESS)
def readiness(p, q, b):
    asked = time.monotonic()
    with _check["lock"]:
        if _check["doc"] is None or _check["at"] < asked - CHECK_REUSE_S:
            import selfcheck                # sources OpenFOAM's bashrc in a shell: a second or two
            _check["doc"] = selfcheck.report()
            _check["at"] = time.monotonic()
        return _check["doc"]


@route("GET", "/jobs", "Jobs on this worker, newest first, with their progress",
       query={"state": {"schema": {"enum": ["queued", "running", "done", "failed", "cancelled"]},
                        "description": "only jobs in this state"},
              "limit": {"schema": {"type": "integer", "minimum": 1, "maximum": 1000, "default": 50}}},
       ok=_items(_ref("job")))
def list_jobs(p, q, b):
    return {"items": [_job_out(j) for j in jobs.list_jobs(state=q.get("state"), limit=q["limit"])]}


@route("GET", "/jobs/{job}", "One job: state, progress (the tool's own step), exit code, error", ok=_ref("job"))
def get_job(p, q, b):
    return _job_out(_job(p["job"]))


@route("POST", "/jobs/{job}/cancel",
       "Stop a queued or running job and everything it started.  Needs the token or pairing key.",
       ok=_ref("job"))
def cancel_job(p, q, b):
    if _job(p["job"])["state"] not in jobs.ACTIVE:
        raise ApiError("finished", "job already finished")
    return _job_out(jobs.cancel(p["job"]))


@route("POST", "/jobs",
       "Start a repair, A/B test, A/B extension, new case or solve.  Needs the launch token (X-MD-Token) or the "
       "pairing key "
       "(X-MD-Key).", body=JOB_REQUEST, ok=_ref("job"), status=202)
def start_job(p, q, b):
    if not isinstance(b, dict) or b.get("kind") not in JOBS:
        raise ApiError("bad-request", "body must be {\"kind\": one of %s, \"params\": {...}}" % sorted(JOBS))
    job = JOBS[b["kind"]]
    extra = sorted(set(b) - {"kind", "params"})
    params = b.get("params", {})
    problems = [f"unexpected {k}" for k in extra] + schema.check(params, job["params"])
    if problems:
        raise ApiError("bad-request", "; ".join(x.replace("$.", "params.").replace("$:", "params:")
                                                 for x in problems[:5]))
    args = {k: s["default"] for k, s in job["params"]["properties"].items() if "default" in s}
    args.update(params)
    r = job["start"](args)
    if not r.get("ok"):
        raise ApiError(r.get("code", "bad-request"), r.get("error", "refused"))
    return _job_out(r["job"])


# --------------------------------------------------------------------------
# dispatch

def _query_args(spec, query):
    out = {}
    for k, s in spec.items():
        sch = s["schema"]
        if k not in query:
            if s.get("required"):
                raise ApiError("bad-request", f"missing query parameter {k}")
            if "default" in sch:
                out[k] = sch["default"]
            continue
        out[k] = _query_value(k, query[k], sch)
    return out


def _query_value(k, v, sch):
    """Query parameter k's text v as its schema takes it, or ApiError: an integer or a number when its type says so,
    checked against the schema. With anyOf, the first alternative it fits, such as a number in a range or a word of
    an enum (GET /judge's window: iterations, or auto)."""
    if "anyOf" in sch:
        for alt in sch["anyOf"]:
            try:
                return _query_value(k, v, alt)
            except ApiError:
                pass
        raise ApiError("bad-request", f"{k} must be " + " or ".join(map(_said, sch["anyOf"])))
    try:
        v = int(v) if sch.get("type") == "integer" else float(v) if sch.get("type") == "number" else v
    except ValueError:
        raise ApiError("bad-request", f"{k} must be a {sch['type']}")
    if isinstance(v, float) and not math.isfinite(v):           # nan, inf: never valid, never in JSON
        raise ApiError("bad-request", f"{k} must be a finite number")
    problems = schema.check(v, sch)
    if problems:
        raise ApiError("bad-request", f"{k}: " + problems[0].split(": ", 1)[-1])
    return v


def _said(sch):
    """An anyOf alternative of a query parameter's schema in words, for the answer that refuses its value."""
    if "enum" in sch:
        return " or ".join(map(str, sch["enum"]))
    what = "a whole number" if sch.get("type") == "integer" else "a number"
    lo, hi = sch.get("minimum"), sch.get("maximum")
    return what + (f" from {lo} to {hi}" if lo is not None and hi is not None else "")


def _no_number(word):
    raise ValueError(f"{word} is not a JSON number")


def _finite(text):
    v = float(text)
    if not math.isfinite(v):
        raise ValueError(f"{text} is too large a number")
    return v


def handle(method, path, query=None, body=b"", content_type=""):
    """(HTTP status, JSON document, extra headers) for one request below PREFIX.
    `query` is {name: first value}.  Unexpected exceptions are the caller's to log."""
    try:
        return _handle(method, path, query or {}, body, content_type)
    except ApiError as e:
        return STATUS[e.code], error_doc(e.code, e.message), e.headers


def _handle(method, path, query, body, content_type):
    sub = path[len(PREFIX):] if path.startswith(PREFIX) else path
    sub = sub or "/"
    matches = [(r, m) for r in ROUTES for m in [r.rx.match(sub)] if m]
    if not matches:
        raise ApiError("not-found", "no such API route")
    hit = [(r, m) for r, m in matches if r.method == method]
    if not hit:
        allow = ", ".join(sorted({r.method for r, _ in matches}))
        raise ApiError("method-not-allowed", f"use {allow} here", {"Allow": allow})
    r, m = hit[0]
    doc = None
    if r.body is not None:
        if content_type.split(";")[0].strip().lower() != "application/json":
            raise ApiError("unsupported-media-type", "send the body as application/json")
        if len(body) > MAX_BODY:
            raise ApiError("too-large", f"body over {MAX_BODY} bytes")
        try:                                # NaN, Infinity and 1e999 are no JSON numbers: refused, not inf
            doc = json.loads(body.decode("utf-8") or "null", parse_constant=_no_number, parse_float=_finite)
        except (UnicodeDecodeError, ValueError):
            raise ApiError("bad-request", "body is not valid JSON")
    return r.status, r.func(m.groupdict(), _query_args(r.query, query), doc), {}


# --------------------------------------------------------------------------
# OpenAPI 3.1, built from the table above

def openapi():
    err = {"$ref": "#/components/schemas/Error"}
    paths = {}
    for r in ROUTES:
        op = {"operationId": r.op, "summary": r.summary, "parameters": [], "responses": {
            str(r.status): {"description": "OK" if r.status == 200 else "Accepted",
                            "content": {"application/json": {"schema": r.ok or {"type": "object"}}}},
            "default": {"description": "Error (the code says which; see STATUS in api_v1.py)",
                        "content": {"application/json": {"schema": err}}}}}
        for n in r.names:
            sch = {"type": "string", "pattern": r"^[0-9]{1,9}$"} if n == "id" else \
                {"enum": sorted(schema.VERSIONS)} if n == "kind" else \
                {"type": "string", "pattern": jobs.ID.pattern} if n == "job" else NAME
            op["parameters"].append({"name": n, "in": "path", "required": True, "schema": sch})
        for n, s in r.query.items():
            op["parameters"].append({"name": n, "in": "query", "required": bool(s.get("required")),
                                     "description": s.get("description", ""), "schema": s["schema"]})
        if not op["parameters"]:
            del op["parameters"]
        if r.body is not None:
            op["requestBody"] = {"required": True, "content": {"application/json": {"schema": r.body}}}
            op["security"] = [{"launchToken": []}, {"pairingKey": []}]
        paths.setdefault(r.template, {})[r.method.lower()] = op
    return {
        "openapi": "3.1.0",
        "info": {"title": "Mesh Doctor API", "version": API_VERSION,
                 "description": "Finds and repairs bad cells in OpenFOAM meshes and tests whether the repair "
                                "helped the solver.  Served by `meshdoctor serve` on 127.0.0.1 only: requests "
                                "must name this machine in Host, may not come from another site's page "
                                "(Origin), and POST requests need the launch token from the dashboard page.  "
                                "The Mesh Doctor web app (an address in app_origins) sends the pairing key "
                                "instead, on every request.",
                 "license": {"name": "GPL-3.0-or-later", "identifier": "GPL-3.0-or-later"}},
        "servers": [{"url": PREFIX}],
        "paths": paths,
        "components": {
            "schemas": {"Error": {
                "type": "object", "required": ["error"],
                "properties": {"error": {"type": "object", "required": ["code", "message"],
                                         "properties": {"code": {"enum": sorted(STATUS)},
                                                        "message": {"type": "string"}}}}}},
            "securitySchemes": {"launchToken": {
                "type": "apiKey", "in": "header", "name": "X-MD-Token",
                "description": "made fresh at each server start and written into the dashboard pages "
                               "(<meta name=\"md-token\">), which other sites cannot read"},
                "pairingKey": {
                "type": "apiKey", "in": "header", "name": "X-MD-Key",
                "description": "the web app's key from `meshdoctor pair` (~/.config/meshdoctor/app.key); "
                               "accepted only from an address in app_origins, on every /api/v1 request"}}},
    }
