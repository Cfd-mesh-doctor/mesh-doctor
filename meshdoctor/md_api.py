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


def _unfinished(case):
    """Is this a new case from a template that isn't made yet: being made, or stopped before its mesh was?  Its
    marker says so (jobs.CASE_MARKER); blockMesh's background mesh is in it long before the case's mesh is."""
    marker = os.path.join(case, jobs.CASE_MARKER)
    if not os.path.isfile(marker):
        return False
    doc = _read_json(marker)
    return not (isinstance(doc, dict) and doc.get("state") == "done")


def made(case):
    """What Mesh Doctor made this case from, once it is made (its marker says done): {"template": ...} for a case job's
    new case, {"copyOf": ...} for a solve's copy of a case you made, {"transientOf": ...} for a transient run of a
    steady one; None for a case you made, or one not made yet.  Only a case made here is solved (solve.py)."""
    doc = _read_json(os.path.join(case, jobs.CASE_MARKER))
    if isinstance(doc, dict) and doc.get("state") == "done":
        if doc.get("copyOf"):
            return {"copyOf": str(doc["copyOf"])}
        if doc.get("transientOf"):
            return {"transientOf": str(doc["transientOf"])}
        return {"template": str(doc.get("template") or "")}
    return None


def sources():
    """The cases in the cases folder: each folder with a mesh, but the workspace and a new case not made yet."""
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
        if (os.path.isfile(os.path.join(d, "constant", "polyMesh", "owner")) or
                os.path.isfile(os.path.join(d, "processor0", "constant", "polyMesh", "owner"))) and not _unfinished(d):
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
                   log=name + ".log", result=f"{name}/meshDoctor/result.json", ram=(case, "repair"),
                   disk=_repair_disk(src, os.path.join(md_dir(), name)))


def _repair_disk(src, folder):
    """What a repair of source case `src` writes into `folder` in the workspace, for the disk guard: (MB, folder, what
    needs it, with its verb): its copy and what the repair writes in it (repair.disk_need)."""
    import repair
    return repair.disk_need(posixpath.join(run_dir(), src)), folder, f"the copy of {src} and its repair need"


def repair_disk(src):
    """GET /disk/repair: what a repair of source case `src` writes, as start's disk guard counts it: ((MB, folder,
    what), None), or (None, the refusal start would give)."""
    if not SAFE.match(src):
        return None, _refuse("bad-request", "bad arguments")
    if src not in sources():
        return None, _refuse("not-found", "unknown source case")
    return _repair_disk(src, md_dir()), None


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
                with open(os.path.join(pp, d, td, "residuals.dat"), encoding="utf-8", errors="replace") as f:
                    lines = f.read().splitlines()
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


def _extend_plan(label, to):
    """Running A/B test `label`'s second run longer, to iteration `to`, as ab_extend starts it: ({top, now, to}, None):
    the test's folder, the iteration that run is at and the one it goes to; else (None, the refusal)."""
    if not SAFE.match(label):
        return None, _refuse("bad-request", "bad arguments")
    top = os.path.join(md_dir(), label + "_ab")
    r = _read_json(os.path.join(top, "ab_result.json"), "abtest")
    if not r or not r.get("fixed"):
        return None, _refuse("not-ready", "A/B not finished")
    try:
        to = int(to)
    except ValueError:
        return None, _refuse("bad-request", "bad iteration count")
    import abtest
    try:
        now = float(abtest.latest_time(os.path.join(top, "fixed")))
    except (OSError, ValueError):                 # no processor0/, or no time in it
        return None, _refuse("not-ready", "second run has no decomposed fields to continue from")
    if not (now < to <= 5000):
        return None, _refuse("bad-request", f"target must be between {int(now) + 1} and 5000: the second run is at "
                             f"iteration {now:g}")
    return {"top": top, "now": now, "to": to}, None


def _extend_disk(label, plan):
    """What running A/B test `label`'s second run longer (_extend_plan) writes, for the disk guard: (MB, the test's
    folder, what needs it, with its verb): its written times, split (abtest.extend_need)."""
    import abtest
    return (abtest.extend_need(os.path.join(plan["top"], "fixed"), int(plan["now"]), plan["to"]), plan["top"],
            f"running {label}'s second run longer needs")


def extend_disk(label, to):
    """GET /disk/abextend: what running A/B test `label`'s second run to iteration `to` writes, as ab_extend's disk
    guard counts it: ((MB, folder, what), None), or (None, the refusal ab_extend would give)."""
    plan, why = _extend_plan(label, to)
    return (None, why) if why else (_extend_disk(label, plan), None)


def ab_extend(label, to):
    """Continue the second run of an A/B (abtest.py extend) and judge it.  The target must be past the iteration
    that run is at now (the A/B test's own iterations, or where an earlier extension ended), as `ab extend` checks."""
    plan, why = _extend_plan(label, to)
    if why:
        return why
    top, to = plan["top"], plan["to"]
    return _submit("abextend", {"name": label, "to": to}, label, [sys.executable, ABTEST, "extend", top, str(to)],
                   log=f"{label}_ab/extend.log", result=f"{label}_ab/ab_result.json",
                   ram=(os.path.join(top, "fixed"), "solve"), disk=_extend_disk(label, plan))


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


def _ab_plan(name, iters, init, variant):
    """An A/B test of repair run `name` as ab_start starts it: ({src, case, iters, init, label, base}, None): its source
    case's path as the repair's result has it, its folder in the cases folder, the iterations (20 to 2000), the start
    fields (auto taken), the test's label, and the earlier test whose first run it reuses (None: none); else (None,
    the refusal)."""
    import abtest
    if variant and variant not in abtest.PRESETS:
        return None, _refuse("bad-request", "unknown variant")
    if not SAFE.match(name) or init not in ("auto", "0.warm", "0.cold", "0"):
        return None, _refuse("bad-request", "bad arguments")
    try:
        iters = max(20, min(int(iters), 2000))
    except (TypeError, ValueError):
        return None, _refuse("bad-request", "bad iteration count")
    res = result(name)
    if not res or not res.get("finished"):
        return None, _refuse("not-ready", "repair run not finished")
    if res.get("layout", {}).get("parallel"):
        return None, _refuse("unsupported", "A/B test supports serial (root) meshes only for now")
    src = res.get("source", "")
    cases, ws, _ = _paths()
    if posixpath.dirname(src) != cases.rstrip("/") or not SAFE.match(posixpath.basename(src)):
        return None, _refuse("unsupported", "unexpected source path")
    case = os.path.join(run_dir(), posixpath.basename(src))
    if init == "auto":                     # as the command does: a solution the case has, else its own 0
        init = "0.warm" if os.path.isdir(os.path.join(case, "0.warm")) else "0"
    if not os.path.isdir(os.path.join(case, init)):
        return None, _refuse("bad-request", f"source case has no {init} directory")
    label = f"{os.path.basename(src)}_{variant}" if variant else name
    return {"src": src, "case": case, "iters": iters, "init": init, "label": label,
            "base": _base_for(src, iters, init) if variant else None}, None


def _ab_disk(plan):
    """What A/B test `plan` (_ab_plan) writes, for the disk guard: (MB, its folder in the workspace, what needs it, with
    its verb): a copy of its case for each run it solves and what each writes (abtest.disk_need), one when it reuses
    an earlier test's first run."""
    import abtest
    return (abtest.disk_need(plan["case"], plan["init"], 1 if plan["base"] else 2),
            os.path.join(md_dir(), plan["label"] + "_ab"), f"the A/B test {plan['label']} needs")


def ab_disk(name, iters, init, variant=""):
    """GET /disk/abtest: what an A/B test of repair run `name` writes, as ab_start's disk guard counts it: ((MB,
    folder, what), None), or (None, the refusal ab_start would give)."""
    plan, why = _ab_plan(name, iters, init, variant)
    return (None, why) if why else (_ab_disk(plan), None)


def ab_start(name, iters, init, variant="", replace=True):
    """Start an A/B solver test of repair run `name`.  replace=False refuses
    when the A/B folder it would write already exists."""
    plan, why = _ab_plan(name, iters, init, variant)
    if why:
        return why
    src, iters, init, label = plan["src"], plan["iters"], plan["init"], plan["label"]
    if not replace and os.path.exists(os.path.join(md_dir(), label + "_ab")):
        return _refuse("exists", f"A/B test {label} already exists; extend it or replace it")
    cmd = [sys.executable, ABTEST, src, "-" if variant else name, "--iters", str(iters), "--init", init]
    if variant:
        cmd += ["--variant", variant, "--label", label]
        if plan["base"]:
            cmd += ["--base-from", plan["base"]]       # reuse an earlier original-mesh run with the same settings
    return _submit("abtest", {"name": name, "iters": iters, "init": init, "variant": variant}, label, cmd,
                   log=label + "_ab.log", result=f"{label}_ab/ab_result.json", ram=(src, "solve"),
                   disk=_ab_disk(plan))


def ab_list():
    try:
        return sorted(d[:-3] for d in os.listdir(md_dir())
                      if d.endswith("_ab") and os.path.isdir(os.path.join(md_dir(), d)))
    except OSError:
        return []


def ab_brief(name):
    """What the A/B tests list says of one test: its last step and when that began (ab_status.json), and once both
    runs have ended, when, each field's residual ratio and the judge's verdict on the repaired-mesh run (only a test
    that `ab extend` continued has one).  A result from a newer Mesh Doctor counts as none here; the test's own
    answer (ab()) says why."""
    top = os.path.join(md_dir(), name + "_ab")
    st = _read_json(os.path.join(top, "ab_status.json"))
    st = st if isinstance(st, dict) else {}
    res = _read_json(os.path.join(top, "ab_result.json"), "abtest")
    res = res if isinstance(res, dict) and "error" not in res else {}
    text = lambda v: v if isinstance(v, str) else None
    ratios = res.get("residualRatioFixedOverBase")
    judge = res.get("fixedJudge")
    return {"step": text(st.get("step")), "updated": text(st.get("time")), "finished": text(res.get("finished")),
            "ratios": {k: v for k, v in ratios.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
            if isinstance(ratios, dict) else {},
            "verdict": text(judge.get("verdict")) if isinstance(judge, dict) else None}


def mapdata(name):
    """Repair-vs-hotspot map written by mapdata.py (meshDoctor/map.json)."""
    if not SAFE.match(name):
        return None
    return _read_json(os.path.join(md_dir(), name, "meshDoctor", "map.json"), "map")


def map_list():
    return [n for n in sorted(os.listdir(md_dir()))
            if os.path.isfile(os.path.join(md_dir(), n, "meshDoctor", "map.json"))] if os.path.isdir(md_dir()) else []
