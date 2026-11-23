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
import json, math, os, re

import jobs
import md_api
import ramguard
import schema
import version

API_VERSION = "1.2"
PREFIX = "/api/v1"
MAX_BODY = 64 * 1024

# error code -> HTTP status.  md_api refusals carry one of these codes.
STATUS = {
    "bad-request": 400, "forbidden": 403, "not-found": 404, "method-not-allowed": 405,
    "exists": 409, "finished": 409, "busy": 409, "not-ready": 409, "not-enough-memory": 409, "schema-version": 409,
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


@route("GET", "/cases", "Source cases this worker may read (only ever read, never changed), with their sizes",
       ok={"type": "object", "required": ["items", "cells"], "properties": {
           "items": {"type": "array", "items": {"type": "string"}},
           "cells": {"type": "object", "additionalProperties": {"type": ["integer", "null"]},
                     "description": "each case's cell count, from its mesh's owner header (summed over processors "
                                    "for a decomposed case); null when the header doesn't say (API 1.2)"}}})
def cases(p, q, b):
    names = md_api.sources()
    return {"items": names, "cells": {n: ramguard.mesh_cells(os.path.join(md_api.run_dir(), n)) for n in names}}


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


@route("GET", "/repairs/{name}/clusters/{id}", "Geometry of one defect cluster, before or after the repair",
       query={"tag": {"schema": {"enum": ["before", "after", "report"], "default": "before"},
                      "description": "which cluster list: before or after the repair, or the report"}},
       ok={"type": "object"})
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


@route("GET", "/abtests", "A/B solver tests in the workspace", ok=_items({"type": "string"}))
def abtests(p, q, b):
    return {"items": md_api.ab_list()}


@route("GET", "/abtests/{name}", "An A/B test: status, result (abtest schema), residual histories, oscillation maps",
       ok={"type": "object", "required": ["status", "result", "live", "modes"]})
def abtest(p, q, b):
    d = md_api.ab(_name(p["name"]))
    if not d or not d.pop("exists", False):
        raise ApiError("not-found", "no A/B test " + p["name"])
    if isinstance(d.get("result"), dict):
        _found(d["result"], "")
    return d


@route("GET", "/abtests/{name}/live", "The steady-run page data: stages, residuals, forces, live judge",
       ok={"type": "object"})
def abtest_live(p, q, b):
    if not os.path.isdir(os.path.join(md_api.md_dir(), _name(p["name"]) + "_ab")):
        raise ApiError("not-found", "no A/B test " + p["name"])
    if "abtest_live" not in _live:
        raise ApiError("unavailable", "the live monitor is not running in this server")
    return _live["abtest_live"](p["name"])


@route("GET", "/live/abtest", "The A/B test running now, or else the one updated last: the same steady-run page "
       "data as /abtests/{name}/live, with its name in `label`", ok={"type": "object", "required": ["label"]})
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
              "window": {"schema": {"type": "integer", "minimum": 10, "maximum": 100000, "default": 200},
                         "description": "iterations (steady) or time steps (transient) to judge"},
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
    return ab.judge(case, q["window"], avg_from=q.get("avgFrom"), logs=logs)


@route("GET", "/live", "The live (transient) case: forces, averaging window, time step, processes, memory",
       ok={"type": "object"})
def live(p, q, b):
    if "live" not in _live:
        raise ApiError("unavailable", "the live monitor is not running in this server")
    return _live["live"]()


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
       "Start a repair, A/B test or A/B extension.  Needs the launch token (X-MD-Token) or the pairing key "
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
        v = query[k]
        try:
            v = int(v) if sch.get("type") == "integer" else float(v) if sch.get("type") == "number" else v
        except ValueError:
            raise ApiError("bad-request", f"{k} must be a {sch['type']}")
        if isinstance(v, float) and not math.isfinite(v):           # nan, inf: never valid, never in JSON
            raise ApiError("bad-request", f"{k} must be a finite number")
        problems = schema.check(v, sch)
        if problems:
            raise ApiError("bad-request", f"{k}: " + problems[0].split(": ", 1)[-1])
        out[k] = v
    return out


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
        try:
            doc = json.loads(body.decode("utf-8") or "null")
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
