# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Mesh Doctor API for the dashboard (runs on Linux, or inside WSL).

Reads Mesh Doctor results and starts jobs.  Every path comes from config.py.
Jobs only ever run on copies in the workspace folder.
"""
import json, os, posixpath, re, sys

import config
import jobs
import schema

PKG = os.path.dirname(os.path.abspath(__file__))
DRIVER = posixpath.join(PKG, "repair.py")
ABTEST = posixpath.join(PKG, "abtest.py")


def _paths():
    """(cases, workspace, bashrc)."""
    s = config.settings()
    return s["cases"], s["workspace"], s["bashrc"]


def run_dir():
    """The folder of source cases."""
    return _paths()[0]


def md_dir():
    """The workspace (repair copies and A/B runs)."""
    return _paths()[1]


def procs():
    """[(command name, full command line)] of this machine's processes, from /proc."""
    return [(comm, cmd) for _, comm, cmd in jobs.procs()]


def _submit(kind, params, name, cmd, **kw):
    """Start a job through the runner (jobs.py), which applies the one-big-job
    rule and the RAM guard.  The answer the old routes expect, plus the job."""
    try:
        job = jobs.submit(kind, params, name, cmd, **kw)
    except jobs.Refused as e:
        return _refuse(e.code, e.message)
    return {"ok": True, "name": name, "label": name, "job": job}


def _refuse(code, msg):
    """A refused request.  `code` is one of api_v1.STATUS (which maps it to an
    HTTP status); the old /api/md routes show only the message."""
    return {"ok": False, "error": msg, "code": code}


# Plain folder names only: no leading dot, so "." and ".." (parent folder) are refused.
SAFE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$")


def _read_json(path, kind=None):
    """A JSON file, or None if missing/unreadable.  With a kind (schema.VERSIONS),
    a file from a newer major version gives {"error": {...}} instead of data
    this code would misread."""
    try:
        if kind:
            return schema.read(path, kind)
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except schema.SchemaError as e:
        return {"error": {"code": "schema-version", "message": getattr(e, "why", str(e))}}
    except (OSError, ValueError):
        return None


def sources():
    out = []
    cases, ws, _ = _paths()
    try:
        names = sorted(os.listdir(run_dir()))
    except OSError:
        return out
    for n in names:
        if (ws + "/").startswith(posixpath.join(cases, n) + "/"):
            continue                          # the workspace itself is not a source case
        d = os.path.join(run_dir(), n)
        if os.path.isfile(os.path.join(d, "constant", "polyMesh", "owner")) or \
           os.path.isfile(os.path.join(d, "processor0", "constant", "polyMesh", "owner")):
            out.append(n)
    return out


def results():
    rows = []
    try:
        names = sorted(os.listdir(md_dir()))
    except OSError:
        return rows
    for n in names:
        md = os.path.join(md_dir(), n, "meshDoctor")
        if not os.path.isdir(md):
            continue
        st = _read_json(os.path.join(md, "status.json")) or {}
        res = _read_json(os.path.join(md, "result.json"), "repair")
        row = {"name": n, "status": st}
        if res:
            row.update({
                "source": res.get("source"), "profile": res.get("profile"),
                "verdict": res.get("verdict"), "finished": res.get("finished"),
                "nCells": res.get("layout", {}).get("nCells"),
            })
        rows.append(row)
    return rows


def result(name):
    if not SAFE.match(name):
        return None
    return _read_json(os.path.join(md_dir(), name, "meshDoctor", "result.json"), "repair")


def cluster(name, tag, cid):
    if not (SAFE.match(name) and tag in ("before", "after", "report") and cid.isdigit()):
        return None
    return _read_json(os.path.join(md_dir(), name, "meshDoctor", f"clusters_{tag}", f"{cid}.json"))


def log_tail(name, n=60):
    if not SAFE.match(name):
        return ""
    p = os.path.join(md_dir(), name, "meshDoctor", "log.fix")
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        return "".join(l for l in lines[-n:] if "sweep" in l or l.startswith("["))
    except OSError:
        return ""


def start(src, name, profile, replace=True):
    """Start a repair of a copy of source case `src` as workspace run `name`.
    replace=False refuses when that run already exists (the copy step would
    delete it)."""
    if not (SAFE.match(src) and SAFE.match(name)) or profile not in ("openfoam", "strict"):
        return _refuse("bad-request", "bad arguments")
    if src not in sources():
        return _refuse("not-found", "unknown source case")
    if not replace and os.path.exists(os.path.join(md_dir(), name)):
        return _refuse("exists", f"run {name} already exists; pick another name or replace it")
    case = posixpath.join(run_dir(), src)
    return _submit("repair", {"source": src, "name": name, "profile": profile}, name,
                   [sys.executable, DRIVER, "full", case, name, "--profile", profile],
                   log=name + ".log", result=f"{name}/meshDoctor/result.json", ram=(case, "repair"))


# --------------------------------------------------------------------------
# Solver A/B test (abtest.py): original mesh vs repaired mesh


def _residuals(case, maxpts=400):
    pp = os.path.join(case, "postProcessing")
    try:
        dirs = [d for d in os.listdir(pp) if d.startswith("residuals")]
    except OSError:
        dirs = []
    for d in dirs:
        # a restarted run writes a new time folder: join them in time order
        try:
            tds = sorted(os.listdir(os.path.join(pp, d)), key=lambda x: float(x) if x.replace(".", "", 1).isdigit() else 1e30)
        except OSError:
            continue
        cols, rows = None, []
        for td in tds:
            try:
                lines = open(os.path.join(pp, d, td, "residuals.dat"), encoding="utf-8", errors="replace").read().splitlines()
            except OSError:
                continue
            try:   # a restart from an earlier time supersedes the rows it repeats
                t0 = float(td)
                rows = [r for r in rows if r[0] < t0]
            except ValueError:
                pass
            for line in lines:
                if line.startswith("#"):
                    if "Time" in line:
                        cols = line[1:].split()
                    continue
                t = line.split()
                if cols and len(t) == len(cols):
                    try:
                        rows.append([float(x) if x != "N/A" else None for x in t])
                    except ValueError:
                        pass
        if not cols:
            continue
        return _thin_rows(cols, rows, maxpts)
    # no residuals function object: read the solver logs
    import caseinfo
    r = caseinfo.log_residuals(caseinfo.solver_logs(case))
    if not r:
        return None
    cols = ["Time"] + [k for k in r if k != "Time"]
    return _thin_rows(cols, [list(x) for x in zip(*(r[c] for c in cols))], maxpts)


def _thin_rows(cols, rows, maxpts):
    step = max(1, len(rows) // maxpts)
    rows = rows[::step] + ([rows[-1]] if rows and (len(rows) - 1) % step else [])
    return {"cols": cols, "rows": rows}


def ab(name):
    if not SAFE.match(name):
        return None
    top = os.path.join(md_dir(), name + "_ab")
    if not os.path.isdir(top):
        return {"exists": False}
    out = {"exists": True, "status": _read_json(os.path.join(top, "ab_status.json")),
           "result": _read_json(os.path.join(top, "ab_result.json"), "abtest"), "live": {}}
    if out["result"]:
        for tag in ("base", "fixed"):
            if tag in out["result"]:
                out["result"][tag].pop("residualHistory", None)
        out["result"].pop("fixedFull", None)
    for tag in ("base", "fixed"):
        out["live"][tag] = _residuals(os.path.join(top, tag))
    # slow-oscillation maps (abtest.py mode): where the solution moves between
    # two written times a few hundred iterations apart
    out["modes"] = []
    mdir = os.path.join(top, "fixed", "meshDoctor")
    try:
        for f in sorted(os.listdir(mdir)):
            if f.startswith("mode_") and f.endswith(".json"):
                m = _read_json(os.path.join(mdir, f)) or {}
                cl = m.get("clusters", [])
                tot = sum(c.get("sumScore2", 0) for c in cl) or 1
                out["modes"].append({"from": m.get("from"), "to": m.get("to"),
                                     "summary": m.get("summary", {}),
                                     "nearDefects": m.get("shareOfTopChangeNearMeshDefects"),
                                     "top": [dict(share=c["sumScore2"] / tot, nCells=c["nCells"],
                                                  centroid=c["centroid"], h=c.get("h"),
                                                  maxNonOrtho=c.get("maxNonOrtho"))
                                             for c in cl[:8]]})
    except OSError:
        pass
    return out


def ab_extend(label, to):
    """Continue the second run of an A/B (abtest.py extend) and judge it."""
    if not SAFE.match(label):
        return _refuse("bad-request", "bad arguments")
    top = os.path.join(md_dir(), label + "_ab")
    r = _read_json(os.path.join(top, "ab_result.json"), "abtest")
    if not r or not r.get("fixed"):
        return _refuse("not-ready", "A/B not finished")
    try:
        to = int(to)
    except ValueError:
        return _refuse("bad-request", "bad iteration count")
    if not (r["iters"] < to <= 5000):
        return _refuse("bad-request", f"target must be between {r['iters'] + 1} and 5000")
    if not os.path.isdir(os.path.join(top, "fixed", "processor0")):
        return _refuse("not-ready", "second run has no decomposed fields to continue from")
    return _submit("abextend", {"name": label, "to": to}, label, [sys.executable, ABTEST, "extend", top, str(to)],
                   log=f"{label}_ab/extend.log", result=f"{label}_ab/ab_result.json",
                   ram=(os.path.join(top, "fixed"), "solve"))


def _base_for(src, iters, init):
    """An earlier A/B whose original-mesh run can be reused."""
    for n in ab_list():
        r = _read_json(os.path.join(md_dir(), n + "_ab", "ab_result.json"), "abtest") or {}
        if (r.get("source"), r.get("iters"), r.get("init")) == (src, iters, init) and r.get("base"):
            return posixpath.join(_paths()[1], n + "_ab")
    return None


def variants():
    """The solver-settings presets an A/B second run can use (abtest.PRESETS)."""
    import abtest
    return [{"name": k, "label": abtest.PRESET_LABELS.get(k, k)} for k in abtest.PRESETS]


def ab_start(name, iters, init, variant="", replace=True):
    """Start an A/B solver test of repair run `name`.  replace=False refuses
    when the A/B folder it would write already exists."""
    import abtest
    if variant and variant not in abtest.PRESETS:
        return _refuse("bad-request", "unknown variant")
    if not SAFE.match(name) or init not in ("auto", "0.warm", "0.cold", "0"):
        return _refuse("bad-request", "bad arguments")
    try:
        iters = max(20, min(int(iters), 2000))
    except (TypeError, ValueError):
        return _refuse("bad-request", "bad iteration count")
    res = result(name)
    if not res or not res.get("finished"):
        return _refuse("not-ready", "repair run not finished")
    if res.get("layout", {}).get("parallel"):
        return _refuse("unsupported", "A/B test supports serial (root) meshes only for now")
    src = res.get("source", "")
    cases, ws, _ = _paths()
    if posixpath.dirname(src) != cases.rstrip("/") or not SAFE.match(posixpath.basename(src)):
        return _refuse("unsupported", "unexpected source path")
    case = os.path.join(run_dir(), posixpath.basename(src))
    if init == "auto":                     # as the command does: a solution the case has, else its own 0
        init = "0.warm" if os.path.isdir(os.path.join(case, "0.warm")) else "0"
    if not os.path.isdir(os.path.join(case, init)):
        return _refuse("bad-request", f"source case has no {init} directory")
    label = f"{os.path.basename(src)}_{variant}" if variant else name
    if not replace and os.path.exists(os.path.join(md_dir(), label + "_ab")):
        return _refuse("exists", f"A/B test {label} already exists; extend it or replace it")
    cmd = [sys.executable, ABTEST, src, "-" if variant else name, "--iters", str(iters), "--init", init]
    if variant:
        cmd += ["--variant", variant, "--label", label]
        b = _base_for(src, iters, init)
        if b:
            cmd += ["--base-from", b]       # reuse an earlier original-mesh run with the same settings
    return _submit("abtest", {"name": name, "iters": iters, "init": init, "variant": variant}, label, cmd,
                   log=label + "_ab.log", result=f"{label}_ab/ab_result.json", ram=(src, "solve"))


def ab_list():
    try:
        return sorted(d[:-3] for d in os.listdir(md_dir())
                      if d.endswith("_ab") and os.path.isdir(os.path.join(md_dir(), d)))
    except OSError:
        return []


def mapdata(name):
    """Repair-vs-hotspot map written by mapdata.py (meshDoctor/map.json)."""
    if not SAFE.match(name):
        return None
    return _read_json(os.path.join(md_dir(), name, "meshDoctor", "map.json"), "map")


def map_list():
    return [n for n in sorted(os.listdir(md_dir()))
            if os.path.isfile(os.path.join(md_dir(), n, "meshDoctor", "map.json"))] if os.path.isdir(md_dir()) else []
