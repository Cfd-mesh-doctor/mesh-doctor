# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Mesh Doctor dashboard and live OpenFOAM progress monitor (Linux, or inside WSL).

    python3 -m meshdoctor serve [--port 8765] [--case <live case>]

Listens on 127.0.0.1 only.  From Windows, open http://localhost:<port>: WSL
forwards it.  From another machine (a cluster node, a lab PC), use an SSH
tunnel, never a public address:

    ssh -L 8765:localhost:8765 <you>@<host>     then open http://localhost:8765

The live case (the transient page) is --case, else the `live_case` setting
(config.py).  The port is --port, else MESHDOCTOR_PORT, else 8765.
"""
import argparse, http.server, json, os, re, sys, time, threading

import caseinfo
import config
import prog

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
CASE = ""                       # set in main()
PORT = int(os.environ.get("MESHDOCTOR_PORT", "8765"))   # dashboard port (this machine only)
# last-resort run lengths when the case has neither setup/controlDict.* nor an endTime
STEADY_END = 1000
DDES_END = 1.0

NUM = r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?"


def p(*parts):
    # no live case configured: point at a folder that does not exist, so the page shows "pending"
    return os.path.join(CASE or os.path.join(HERE, "_no_live_case_"), *parts)


def read_tail(path, n=400_000):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2); size = f.tell()
            f.seek(max(0, size - n))
            return f.read().decode("utf-8", "replace"), size
    except OSError:
        return None, 0


def read_all(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return None


def _dict_files(name):
    out = [p("setup", name), p("system", "controlDict")]
    try:
        out += [p("system", n) for n in sorted(os.listdir(p("system"))) if n != "controlDict"]
    except OSError:
        pass
    return out


def run_setting(name, key):
    """A number from the transient run's dictionaries: deltaT (controlDict) or the
    fieldAverage timeStart (the averaging window).  None when the case has neither."""
    for f in _dict_files(name):
        t = read_all(f) or ""
        if key == "timeStart" and "fieldAverage" not in t:
            continue
        m = re.search(r"(?<![\w.])" + key + r"\s+(" + NUM + r")\s*;", t)
        if m:
            return float(m.group(1))
    return None


def end_time(name, default):
    """endTime from setup/<name> (a staged run), else system/controlDict, else default."""
    for f in (p("setup", name), p("system", "controlDict")):
        t = read_all(f)
        m = re.search(r"\bendTime\s+(" + NUM + r")\s*;", t or "")
        if m:
            return float(m.group(1))
    return default


_proc = {"t": 0, "val": {}}


def processes():
    if time.time() - _proc["t"] < 30:
        return _proc["val"]
    names = ("snappyHexMesh", "foamRun", "checkMesh", "decomposePar", "blockMesh")
    comms = [c for c, _ in md_api.procs()]
    val = {x: comms.count(x) for x in names}
    try:
        mem = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                mem[k] = int(v.split()[0]) // 1024        # kB -> MB
        val["mem_total_mb"] = mem["MemTotal"]
        val["mem_used_mb"] = mem["MemTotal"] - mem.get("MemAvailable", mem.get("MemFree", 0))
    except (OSError, KeyError, ValueError) as e:
        val["error"] = "memory unknown: " + type(e).__name__
    _proc.update(t=time.time(), val=val)
    return val


# ---------------- meshing ----------------
_mesh_cache = {"key": None, "val": None}


def mesh_status():
    key = (mtime(p("log.snappyHexMesh")), mtime(p("log.blockMesh")))
    if _mesh_cache["key"] == key and _mesh_cache["val"] and _mesh_cache["val"]["state"] != "running":
        return _mesh_cache["val"]
    val = _mesh_status()
    _mesh_cache.update(key=key, val=val)
    return val


def _mesh_status():
    txt, _ = read_tail(p("log.snappyHexMesh"), 3_000_000)
    if txt is None:
        return {"state": "pending"}
    s = {"state": "running"}
    cells = re.findall(r"cells:(\d+)", txt)
    if cells:
        s["cells"] = int(cells[-1])
    # phase detection, ordered
    phases = [
        ("Surface refinement", r"Surface refinement iteration (\d+)", 0.02, 0.15),
        ("Feature refinement", r"Feature refinement iteration (\d+)", 0.0, 0.02),
        ("Box refinement", r"Shell refinement iteration (\d+)", 0.15, 0.30),
        ("Removing interior cells", r"Splitting mesh at surface intersections|Removing mesh beyond surface intersections", 0.30, 0.34),
        ("Snapping to surfaces", r"Morph iteration (\d+)", 0.34, 0.62),
        ("Snapping to feature edges", r"Feature snapping|Repatching faces according to nearest surface", 0.62, 0.66),
        ("Adding boundary layers", r"Layer addition iteration (\d+)|Adding layers|layer addition", 0.66, 0.96),
    ]
    label, frac = "Starting", 0.0
    best_pos = -1
    for name, rx, lo, hi in phases:
        ms = list(re.finditer(rx, txt))
        if ms and ms[-1].start() > best_pos:
            best_pos = ms[-1].start()
            it = ms[-1].group(1) if ms[-1].groups() and ms[-1].group(1) else None
            label = name + (f" (iteration {it})" if it else "")
            if it and name == "Snapping to surfaces":
                frac = lo + (hi - lo) * min(1, int(it) / 30)
            elif it and name == "Adding boundary layers":
                frac = lo + (hi - lo) * min(1, int(it) / 50)
            elif it:
                frac = lo + (hi - lo) * min(1, int(it) / 10)
            else:
                frac = lo
    m = re.search(r"Finished meshing in = (" + NUM + ")", txt)
    if m or re.search(r"^End\s*$", txt, re.M):
        s["state"] = "done"; label, frac = "Finished", 1.0
        if m:
            s["seconds"] = float(m.group(1))
    if "FOAM FATAL" in txt or "FOAM aborting" in txt:
        s["state"] = "error"
        e = txt[txt.rfind("FOAM FATAL"):][:600]
        s["error"] = e
    lay = re.findall(r"(\w+)\s+\d+\s+(" + NUM + r")\s+(" + NUM + r")\s+(" + NUM + r")\s*\n", txt[txt.rfind("Layer mesh"):] if "Layer mesh" in txt else "")
    s["phase"], s["fraction"] = label, frac
    t0 = mtime(p("log.blockMesh")) or mtime(p("log.decomposePar"))
    t1 = mtime(p("log.snappyHexMesh"))
    if t0 and t1:
        s["elapsed"] = (time.time() if s["state"] == "running" else t1) - t0
    # snappy reports layer coverage table
    cov = re.findall(r"^(\S+)\s+\d+\s+(" + NUM + r")\s+(" + NUM + r")\s+(" + NUM + r")\s*$", txt, re.M)
    if cov and "Layer mesh" in txt:
        s["layers"] = [{"patch": c[0], "nLayers": float(c[1]), "thickness_m": float(c[2]), "pct": float(c[3])} for c in cov[-8:]]
    return s


def checkmesh_status():
    txt = read_all(p("log.checkMesh"))
    if not txt:
        return {"state": "pending"}
    s = {"state": "done" if "End" in txt else "running"}
    for key, rx in [("cells", r"cells:\s+(\d+)"), ("maxNonOrtho", r"Mesh non-orthogonality Max:\s*(" + NUM + ")"),
                    ("maxSkewness", r"Max skewness = (" + NUM + ")")]:
        m = re.search(rx, txt)
        if m:
            s[key] = float(m.group(1))
    s["ok"] = "Mesh OK." in txt
    s["failed"] = re.findall(r"Failed (\d+) mesh checks", txt)
    return s


# ---------------- solver ----------------
def solver_status(log, end, kind):
    txt, size = read_tail(p(log), 600_000)
    if txt is None:
        return {"state": "pending", "end": end}
    s = {"state": "running", "end": end}
    times = re.findall(r"^Time = (" + NUM + r")s?\s*$", txt, re.M)
    execs = re.findall(r"^ExecutionTime = (" + NUM + r") s\s+ClockTime = (" + NUM + ") s", txt, re.M)
    if times:
        s["time"] = float(times[-1])
        s["fraction"] = min(1.0, s["time"] / end)
    if len(execs) >= 2:
        clock = float(execs[-1][1])
        s["clock"] = clock
        n = min(len(execs), 40)
        # median per-step wall time, so one pause (PC sleep) doesn't wreck the ETA
        deltas = sorted(float(execs[i][1]) - float(execs[i - 1][1]) for i in range(len(execs) - n + 1, len(execs)))
        dt_wall = deltas[len(deltas) // 2] if deltas else None
        if dt_wall and times:
            step = (float(times[-1]) - float(times[-n])) / (n - 1) if len(times) >= n and n > 1 else None
            if step and step > 0:
                s["wall_per_step"] = dt_wall
                s["eta"] = (end - s["time"]) / step * dt_wall
    co = re.findall(r"Courant Number mean: (" + NUM + r") max: (" + NUM + ")", txt)
    if co:
        s["courant_mean"], s["courant_max"] = float(co[-1][0]), float(co[-1][1])
    if re.search(r"^End\s*$", txt, re.M):
        s["state"] = "done"; s["fraction"] = 1.0
    if "FOAM FATAL" in txt or "FOAM aborting" in txt or "nan" in txt[-4000:].lower().split("courant")[0][-50:]:
        if "FOAM FATAL" in txt or "FOAM aborting" in txt:
            s["state"] = "error"; s["error"] = txt[txt.rfind("FOAM FATAL"):][:600]
    if s["state"] == "running" and mtime(p(log)) and time.time() - mtime(p(log)) > 600:
        s["stale"] = True
    return s


def read_dat(path, maxrows=4000):
    t = read_all(path)
    if not t:
        return None, []
    header, rows = None, []
    for line in t.splitlines():
        if line.startswith("#"):
            if "Time" in line:
                header = line.lstrip("# ").split()
            continue
        nums = re.findall(NUM, line)
        if nums:
            rows.append([float(x) for x in nums])
    if len(rows) > maxrows:
        k = len(rows) // maxrows + 1
        rows = rows[::k] + [rows[-1]]
    return header, rows


def force_payload(case, pp_dir="postProcessing"):
    """Every force group of a case: {"info": how to read them, "series": {group: [[t, drag, vertical]]}}.
    Groups, flow direction and up axis come from the case itself (caseinfo.py)."""
    frc = caseinfo.parse_forces(case, pp_dir)
    d = caseinfo.describe(case, frc)
    series = {}
    for g in d["groups"]:
        dr = caseinfo.series(frc, d, g, "drag")
        ve = caseinfo.series(frc, d, g, "vertical")
        series[g] = _thin([[t, a, b] for (t, a), (_, b) in zip(dr, ve)])
    info = {"total": d["total"], "groups": d["groups"], "vertical": d["vertical"],
            "flow": ("-" if d["flowSign"] < 0 else "+") + "xyz"[d["flowAxis"]], "up": "xyz"[d["upAxis"]],
            "source": d["source"]}
    return {"info": info, "series": series}


def forces(pp_dir):
    """Force groups of the live case (see force_payload)."""
    return force_payload(p(), pp_dir)


def _log_residuals(log):
    """{field: [[t, r]]} from the stage's solver log, for cases without a residuals function object."""
    r = caseinfo.log_residuals([p(log)]) if log else {}
    res = {k: [[t, v] for t, v in zip(r["Time"], r[k]) if v and v > 0] for k in r if k != "Time"}
    for k in res:
        if len(res[k]) > 3000:
            step = len(res[k]) // 3000 + 1
            res[k] = res[k][::step] + [res[k][-1]]
    return res


def residuals(pp_dir, log=None):
    root = p(pp_dir)
    if not os.path.isdir(root):
        return _log_residuals(log)
    # folder is "residuals" or "residuals(p,U,k,omega)" depending on how it was included
    cands = [d for d in os.listdir(root) if d.startswith("residuals") and os.path.isdir(os.path.join(root, d))]
    if not cands:
        return _log_residuals(log)
    gdir = os.path.join(root, max(cands, key=lambda d: mtime(os.path.join(root, d)) or 0))
    res = {}
    for tdir in sorted(os.listdir(gdir), key=lambda x: float(x) if re.match(NUM + "$", x) else 0):
        f = os.path.join(gdir, tdir, "residuals.dat")
        t = read_all(f)
        if not t:
            continue
        if re.match(NUM + "$", tdir):  # a restart folder supersedes older data from its start time on
            t0 = float(tdir)
            for k in res:
                res[k] = [r for r in res[k] if r[0] < t0]
        header = None
        for line in t.splitlines():
            if line.startswith("#"):
                if "Time" in line:
                    header = line.lstrip("# ").split()
                continue
            vals = line.split()
            if not header or len(vals) < 2:
                continue
            tt = float(vals[0])
            for name, v in zip(header[1:], vals[1:]):
                try:
                    fv = float(v)
                except ValueError:
                    continue
                if fv > 0:
                    res.setdefault(name, []).append([tt, fv])
    for k in res:
        if len(res[k]) > 3000:
            step = len(res[k]) // 3000 + 1
            res[k] = res[k][::step] + [res[k][-1]]
    return res


_cache = {"t": 0, "val": None}
_lock = threading.Lock()


def status():
    # Reading big logs (over the WSL network share on Windows) costs CPU the solver needs: compute at most every 15 s.
    with _lock:
        if _cache["val"] is not None and time.time() - _cache["t"] < 15:
            return _cache["val"]
        val = _status()
        _cache.update(t=time.time(), val=val)
        return val


def _status():
    steady_end = end_time("controlDict.steady", STEADY_END)
    ddes_end = end_time("controlDict.ddes", DDES_END)
    mesh = mesh_status()
    chk = checkmesh_status()
    steady = solver_status("log.steady", steady_end, "steady")
    ddes = solver_status("log.ddes", ddes_end, "ddes")
    ddes["deltaT"] = run_setting("controlDict.ddes", "deltaT")
    ddes["avgFrom"] = run_setting("controlDict.ddes", "timeStart")
    steady_pp = "postProcessing_steady" if os.path.isdir(p("postProcessing_steady")) else "postProcessing"
    single = None
    if steady["state"] == "pending" and ddes["state"] == "pending" and os.path.isfile(p("log.foamRun")):
        # a plain case (one foamRun, e.g. examples/ahmed-body): follow log.foamRun as the steady or the transient stage
        transient = "steadyState" not in (read_all(p("system", "fvSchemes")) or "steadyState")
        run = solver_status("log.foamRun", end_time("controlDict", DDES_END if transient else STEADY_END),
                            "ddes" if transient else "steady")
        single = "transient" if transient else "steady"
        if transient:
            ddes.update(run)
            steady = {"state": "skipped", "end": None}
        else:
            steady = run
            ddes = {"state": "skipped", "end": None}
        steady_pp = "postProcessing"
    data = {
        "case": re.split(r"[\\/]", CASE.rstrip("\\/"))[-1] if CASE else "",
        "now": time.time(),
        "mesh": mesh, "checkMesh": chk, "steady": steady, "ddes": ddes,
        "proc": processes(),
        "single": single,
        "forces_steady": forces(steady_pp) if steady["state"] not in ("pending", "skipped") else {},
        "forces_ddes": forces("postProcessing") if ddes["state"] not in ("pending", "skipped") else {},
        "res_steady": residuals(steady_pp, "log.foamRun" if single else "log.steady")
        if steady["state"] not in ("pending", "skipped") else {},
        "res_ddes": residuals("postProcessing", "log.foamRun" if single else "log.ddes")
        if ddes["state"] not in ("pending", "skipped") else {},
    }
    # overall stage weights by expected wall time: mesh 6 %, steady 9 %, DDES 85 % (one solver stage: mesh 6 %, it 94 %)
    w = [("mesh", 0.06), ("steady", 0.09), ("ddes", 0.85)]
    if single:
        w = [("mesh", 0.06), ("ddes" if single == "transient" else "steady", 0.94)]
    total = 0.0
    for key, wt in w:
        st = data[key]
        if st["state"] == "done":
            total += wt
        else:
            total += wt * st.get("fraction", 0.0)
    data["overall"] = total
    return data


import md_api  # Mesh Doctor routes
import abtest  # batch-means force averages
from urllib.parse import urlparse, parse_qs


# ---------------- live page for a solver run on a test copy (/run) ----------------
VECF = re.compile(r"^(\S+)\s+\(\(([^)]*)\)\s+\(([^)]*)\)\)")
_run_cache = {}


def _time_files(d, name):
    ts = []
    try:
        for t in os.listdir(d):
            try:
                ts.append((float(t), os.path.join(d, t, name)))
            except ValueError:
                pass
    except OSError:
        return []
    return [f for _, f in sorted(ts) if os.path.isfile(f)]


def _thin(rows, n=1500):
    if len(rows) <= n:
        return rows
    k = len(rows) // n + 1
    return rows[::k] + [rows[-1]]


def _run_forces(case):
    return force_payload(case)


def _median(x):
    x = sorted(v for v in x if v is not None)
    return x[len(x) // 2] if x else None


def _mean_std(x):
    if not x:
        return None, None
    m = sum(x) / len(x)
    return m, (sum((v - m) ** 2 for v in x) / len(x)) ** 0.5


def _live_judge(res, frc, stage_from, now_it, avg_from=None):
    """Same thresholds as abtest.judge, on the current stage only."""
    avg_from = stage_from if avg_from is None else avg_from
    n_in = int(now_it - stage_from)
    w = max(20, min(150, n_in // 2))
    out = {"window": w}
    # averaged forces with uncertainty (batch means) since this stage's settings began
    avg = {}
    S, info = frc.get("series", {}), frc.get("info", {})
    tot, vert = info.get("total"), info.get("vertical", "downforce")
    out["verticalName"], out["total"] = vert, tot
    wanted = [(vert.capitalize(), tot, 2), ("Drag", tot, 1)]
    wanted += [(f"{g} {vert}", g, 2) for g in info.get("groups", []) if g != tot]
    for name, g, idx in wanted:
        x = [r[idx] for r in S.get(g, []) if r[0] > avg_from + 50]
        bm = abtest.batch_means(x)
        if bm:
            avg[name] = bm
    out["average"], out["avgFrom"] = avg, avg_from + 50
    if n_in < 40:
        out["verdict"] = f"collecting: needs 40 iterations in this stage, has {max(n_in, 0)}"
        return out
    rows = [r for r in res.get("rows", []) if r[0] > stage_from] if res else []
    cols = res.get("cols", []) if res else []
    if "p" in cols and rows:
        i = cols.index("p")
        last = [r[i] for r in rows if r[0] > now_it - w]
        prev = [r[i] for r in rows if now_it - 2 * w < r[0] <= now_it - w]
        a, b = _median(last), _median(prev)
        if a and b:
            out["p"] = {"median": a, "trend": a / b}
    tc = S.get(tot)
    if tc:
        for key, idx in (("vertical", 2), ("drag", 1)):
            last = [r[idx] for r in tc if r[0] > now_it - w]
            prev = [r[idx] for r in tc if now_it - 2 * w < r[0] <= now_it - w]
            m, s = _mean_std(last)
            mp, _ = _mean_std(prev)
            if m:
                out[key] = {"mean": m, "std": s, "osc": s / abs(m), "drift": abs(m - mp) / abs(m) if mp else None}
    pm = out.get("p", {}).get("median", 1)
    ptr = out.get("p", {}).get("trend", 1)
    fs = [out[k] for k in ("vertical", "drag") if k in out]
    drift = max((f["drift"] or 1 for f in fs), default=1)
    osc = max((f["osc"] for f in fs), default=1)
    if pm < 1e-4 and drift < 0.005 and osc < 0.005:
        out["verdict"], out["level"] = "converged", "ok"
    elif drift < 0.01 and osc < 0.02:
        out["verdict"], out["level"] = "statistically steady: forces stationary, window means usable", "ok"
    elif ptr < 0.9:
        out["verdict"], out["level"] = "still converging", "warn"
    else:
        out["verdict"], out["level"] = "not converged: plateau / oscillation", "err"
    # a separated steady flow can swing slowly (~300 iterations on a half-car test):
    # a shorter window can't tell a settled run from a quiet phase of the swing
    if w < 100 and out["level"] != "err":
        out["verdict"] = f"provisional ({w}-iteration window; needs 100+): " + out["verdict"]
        out["level"] = "warn"
    return out


def _settings(case):
    t = read_all(os.path.join(case, "system", "fvSolution")) or ""
    out = {}
    m = re.search(r"relaxationFactors\s*\{(.*?)\n\}", t, re.S)
    if m:
        pairs = re.findall(r'("?[\w.*|()]+"?)\s+(' + NUM + r')\s*;', m.group(1))
        out["relaxation"] = ", ".join(f"{'others' if k.strip(chr(34)) == '.*' else k.strip(chr(34))} {v}"
                                      for k, v in pairs) or " ".join(m.group(1).split())
    i = t.find("\nSIMPLE")
    blk = t[i:t.find("\n}", i)] if i >= 0 else ""
    m = re.search(r"\bconsistent\s+(\w+)\s*;", blk)
    out["consistent"] = m.group(1) if m else "no"
    sch = read_all(os.path.join(case, "system", "fvSchemes")) or ""
    m = re.search(r"ddtSchemes\s*\{\s*default\s+(\w+)", sch)
    out["ddt"] = m.group(1) if m else "?"
    return out


def _active_label():
    best, bt = None, -1
    for n in md_api.ab_list():
        st = md_api._read_json(os.path.join(md_api.md_dir(), n + "_ab", "ab_status.json")) or {}
        t = mtime(os.path.join(md_api.md_dir(), n + "_ab", "ab_status.json")) or 0
        score = t + (1e9 if st.get("step", "done") != "done" else 0)
        if score > bt:
            best, bt = n, score
    return best


def run_status(label):
    label = label or _active_label()
    if not label or not md_api.SAFE.match(label):
        return {"error": "no A/B run found"}
    c = _run_cache.get(label)
    if c and time.time() - c[0] < 15:
        return c[1]
    top = os.path.join(md_api.md_dir(), label + "_ab")
    case = os.path.join(top, "fixed")
    result = md_api._read_json(os.path.join(top, "ab_result.json")) or {}
    st = md_api._read_json(os.path.join(top, "ab_status.json")) or {}
    # stages: first A/B run, finished extensions, then the running one (from the status line)
    iters = result.get("iters", 200)
    variant = result.get("variant")
    stages = [{"name": (variant.upper() if variant else "Repaired mesh") + " run", "from": 0, "to": iters}]
    for e in result.get("extensions", []):
        v = e.get("variant")
        stages.append({"name": f"Continued with {v}" if v else "Continued, same settings",
                       "from": float(e["from"]), "to": float(e["to"])})
    m = re.match(r"extending fixed (\S+) -> (\d+)(?: with (\S+))?", st.get("step", ""))
    if m and not any(s["from"] == float(m.group(1)) for s in stages[1:]):
        stages.append({"name": f"Continued with {m.group(3)}" if m.group(3) else "Continuing",
                       "from": float(m.group(1)), "to": float(m.group(2))})
    # current solver log
    logs = []
    try:
        logs = [f for f in os.listdir(case) if f.startswith("log.foamRun")]
    except OSError:
        pass
    solver = {"state": "pending"}
    if logs:
        lp = max((os.path.join(case, f) for f in logs), key=lambda f: mtime(f) or 0)
        txt, _ = read_tail(lp, 400_000)
        txt = txt or ""
        times = re.findall(r"^Time = (" + NUM + r")s?\s*$", txt, re.M)
        execs = re.findall(r"^ExecutionTime = (" + NUM + r") s\s+ClockTime = (" + NUM + ") s", txt, re.M)
        solver = {"state": "running", "log": os.path.basename(lp)}
        if times:
            solver["iteration"] = float(times[-1])
        if len(execs) >= 3:
            n = min(len(execs), 40)
            d = sorted(float(execs[i][1]) - float(execs[i - 1][1]) for i in range(len(execs) - n + 1, len(execs)))
            solver["wall_per_it"] = d[len(d) // 2]
            solver["clock"] = float(execs[-1][1])
        if re.search(r"^End\s*$", txt, re.M):
            solver["state"] = "done"
        if "FOAM FATAL" in txt or "FOAM aborting" in txt:
            solver["state"] = "error"; solver["error"] = txt[txt.rfind("FOAM FATAL"):][:600]
        age = time.time() - (mtime(lp) or 0)
        if solver["state"] == "running" and age > 300:
            solver["state"] = "stopped"; solver["idle_s"] = age
    cd = read_all(os.path.join(case, "system", "controlDict")) or ""
    me = re.search(r"\bendTime\s+(" + NUM + r")\s*;", cd)
    solver["end"] = float(me.group(1)) if me else stages[-1]["to"]
    it = solver.get("iteration", 0)
    if solver.get("wall_per_it") and solver["state"] == "running":
        solver["eta"] = max(0, solver["end"] - it) * solver["wall_per_it"]
    for a, b in zip(stages, stages[1:]):   # a restart from an earlier write ends the stage before it
        a["to"] = min(a["to"], b["from"])
    cur = next((s for s in reversed(stages) if s["from"] <= it), stages[0])
    # back-to-back stages with the same settings form one averaging stretch
    ci = stages.index(cur)
    avg_from = cur["from"]
    while ci > 0 and stages[ci - 1]["name"] == cur["name"]:
        ci -= 1
        avg_from = stages[ci]["from"]
    res = md_api._residuals(case, maxpts=1500) or {}
    base = md_api._residuals(os.path.join(top, "base"), maxpts=400) or {}
    frc = _run_forces(case)
    data = {"label": label, "source": result.get("source"), "variant": variant, "status": st,
            "stages": stages, "current": cur, "solver": solver, "settings": _settings(case),
            "proc": processes(), "residuals": res, "baseResiduals": base, "forces": frc["series"],
            "forceInfo": frc["info"],
            "judge": _live_judge(res, frc, avg_from, it, avg_from), "savedJudge": result.get("fixedJudge"),
            "labels": md_api.ab_list(), "now": time.time()}
    _run_cache[label] = (time.time(), data)
    return data


# ---------------------------------------------------------------------------
# Security (Phase 0 of docs/mesh-doctor-package/PLAN.md)
#  - only answers requests addressed to this machine by name (Host check),
#    which blocks DNS-rebinding pages from reading the API;
#  - refuses requests that another web site's page sends (Origin check);
#  - job-starting requests (POST) need a random token made at launch; the
#    server writes it into the pages it serves, which other sites cannot read;
#  - serves only the dashboard pages and the scripts in web/js/, never the
#    other files in this folder;
#  - every page gets a Content-Security-Policy: no other site's scripts, styles,
#    images or connections, no framing.  Pages whose script is all in web/js/
#    (STRICT) run no inline script at all, so injected markup cannot run code;
#  - error details go to this server's window; the browser gets a short message;
#  - the web app (pairing.py): pages served from an address in the app_origins
#    setting may use /api/v1 (nothing else) when they send the pairing key on every
#    request (X-MD-Key).  Only they get CORS answers, so no other site can read
#    the API.  The key replaces the launch token for their job starts.
import hmac, secrets, traceback

import api_v1  # /api/v1: the versioned API (route table, error format, OpenAPI)
import pairing
api_v1.provide(abtest_live=run_status, live=status, live_case=lambda: CASE)

TOKEN = secrets.token_urlsafe(24)
HOSTS = {f"{h}:{PORT}" for h in ("localhost", "127.0.0.1", "[::1]")}
ORIGINS = {f"http://{h}" for h in HOSTS}
APP_ORIGINS = set()            # the web app's addresses (app_origins setting), set in main()
APP_KEY = b""                  # the pairing key (pairing.py), set in main()
APP_HEADERS = "Content-Type, X-MD-Key"


def _same(given, secret):
    """Constant-time compare that also copes with non-ASCII header text."""
    return bool(secret) and hmac.compare_digest(given.encode("utf-8", "replace"), secret)
PAGES = {"/": "index.html", "/index.html": "index.html",
         "/run": "run.html", "/run.html": "run.html",
         "/meshdoctor": "meshdoctor.html", "/meshdoctor.html": "meshdoctor.html",
         "/meshmap": "meshmap.html", "/meshmap.html": "meshmap.html",
         "/report": "report.html", "/report.html": "report.html"}
TOKEN_META = '<meta name="md-token" content="">'
SCRIPT = re.compile(r"^/js/([a-z0-9][a-z0-9-]{0,40}\.js)$")
STRICT = {"index.html", "run.html", "meshdoctor.html", "meshmap.html", "report.html"}   # no inline script
# The old routes still answer, but every page uses /api/v1 since 2026-11-11 (RFC 9745 header, a Unix time)
OLD_API = {"Deprecation": "@1794355200", "Link": f'<{api_v1.PREFIX}/openapi.json>; rel="successor-version"'}
CSP = ("default-src 'none'; script-src 'self'{inline}; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; "
       "frame-ancestors 'none'")


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, ctype, body, headers=None):
        if getattr(self, "_old", False):
            headers = dict(OLD_API, **(headers or {}))
        self.send_response(code)
        if getattr(self, "_cors", None):          # only ever an address from app_origins
            self.send_header("Access-Control-Allow-Origin", self._cors)
            self.send_header("Vary", "Origin")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers(); self.wfile.write(body)

    def _json(self, obj, code=200, headers=None):
        self._send(code, "application/json", json.dumps(obj).encode(), headers)

    def _v1path(self):
        p = urlparse(self.path).path
        return p == api_v1.PREFIX or p.startswith(api_v1.PREFIX + "/")

    def _error(self, code, err, msg):
        """Old routes answer {"error": msg}; /api/v1 answers {"error": {"code", "message"}}."""
        self._json(api_v1.error_doc(err, msg) if self._v1path() else {"error": msg}, code)

    def _deny(self, code, msg):
        self._error(code, {403: "forbidden", 404: "not-found"}.get(code, "bad-request"), msg)
        return False

    def _start(self):
        """Per request: the app address to answer with CORS headers, if the Origin is one."""
        self._old = False
        origin = self.headers.get("Origin")
        self._cors = origin if origin is not None and origin in APP_ORIGINS else None

    def _allowed(self, post=False):
        if self.headers.get("Host", "") not in HOSTS:
            return self._deny(403, "forbidden: unknown host")
        origin = self.headers.get("Origin")
        if self._cors:
            if not self._v1path():
                return self._deny(403, "forbidden: the web app may use /api/v1 only")
            if not _same(self.headers.get("X-MD-Key", ""), APP_KEY):
                return self._deny(403, "forbidden: missing or wrong pairing key (pair again: meshdoctor pair)")
            return True
        if origin is not None and origin not in ORIGINS:
            return self._deny(403, "forbidden: cross-site request")
        if post and not _same(self.headers.get("X-MD-Token", ""), TOKEN.encode()):
            return self._deny(403, "forbidden: missing or wrong token (reload the page)")
        return True

    def _fail(self, where):
        traceback.print_exc()
        print(f"[server] error while handling {where}", file=sys.stderr, flush=True)
        return self._error(500, "internal", "internal error; details are in the server window")

    def _page(self, name):
        try:
            with open(os.path.join(WEB, name), encoding="utf-8") as f:
                html = f.read()
        except OSError:
            return self._deny(404, "not found")
        html = html.replace(TOKEN_META, f'<meta name="md-token" content="{TOKEN}">')
        csp = CSP.format(inline="" if name in STRICT else " 'unsafe-inline'")
        self._send(200, "text/html; charset=utf-8", html.encode(), {"Content-Security-Policy": csp})

    def _script(self, name):
        try:
            with open(os.path.join(WEB, "js", name), "rb") as f:
                body = f.read()
        except OSError:
            return self._deny(404, "not found")
        self._send(200, "text/javascript; charset=utf-8", body)

    def _md(self, method):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == "/api/md/sources":
                return self._json(md_api.sources())
            if u.path == "/api/md/results":
                return self._json(md_api.results())
            if u.path == "/api/md/result":
                return self._json(md_api.result(q.get("name", "")))
            if u.path == "/api/md/cluster":
                return self._json(md_api.cluster(q.get("name", ""), q.get("tag", ""), q.get("id", "")))
            if u.path == "/api/md/log":
                return self._json({"text": md_api.log_tail(q.get("name", ""))})
            if u.path == "/api/md/map":
                return self._json(md_api.mapdata(q.get("name", "")) or {"error": "no map for this run"})
            if u.path == "/api/md/maplist":
                return self._json(md_api.map_list())
            if u.path == "/api/md/variants":
                return self._json(md_api.variants())
            if u.path == "/api/md/ablist":
                return self._json(md_api.ab_list())
            if u.path == "/api/md/ab":
                return self._json(md_api.ab(q.get("name", "")))
            if u.path == "/api/md/abstart" and method == "POST":
                return self._json(md_api.ab_start(q.get("name", ""), q.get("iters", "200"), q.get("init", "auto"), q.get("variant", "")))
            if u.path == "/api/md/abextend" and method == "POST":
                return self._json(md_api.ab_extend(q.get("label", ""), q.get("to", "0")))
            if u.path == "/api/md/start" and method == "POST":
                return self._json(md_api.start(q.get("src", ""), q.get("name", ""), q.get("profile", "openfoam")))
            return self._json({"error": "not found"}, 404)
        except Exception:
            return self._fail(u.path)

    def _v1(self, method):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        body = b""
        if method == "POST":
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                n = -1
            if n < 0:
                return self._error(400, "bad-request", "bad Content-Length")
            if n > api_v1.MAX_BODY:
                return self._error(413, "too-large", f"body over {api_v1.MAX_BODY} bytes")
            body = self.rfile.read(n)
        try:
            code, doc, headers = api_v1.handle(method, u.path, q, body, self.headers.get("Content-Type", ""))
        except Exception:
            return self._fail(u.path)
        self._json(doc, code, headers)

    def do_OPTIONS(self):
        """CORS preflight: answered for the web app's addresses on /api/v1 only.  It carries no
        key (browsers never send custom headers on a preflight); the real request needs it."""
        self._start()
        if self.headers.get("Host", "") not in HOSTS:
            return self._deny(403, "forbidden: unknown host")
        if not self._cors or not self._v1path():
            self._cors = None
            return self._deny(403, "forbidden: cross-site request")
        method = self.headers.get("Access-Control-Request-Method", "")
        if method not in ("GET", "POST"):
            return self._error(405, "method-not-allowed", "only GET and POST")
        h = {"Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": APP_HEADERS,
             "Access-Control-Max-Age": "600"}
        if self.headers.get("Access-Control-Request-Private-Network") == "true":   # older Chrome (PNA)
            h["Access-Control-Allow-Private-Network"] = "true"
        self._send(204, "text/plain", b"", h)

    def do_POST(self):
        self._start()
        if not self._allowed(post=True):
            return
        if self._v1path():
            return self._v1("POST")
        if urlparse(self.path).path.startswith("/api/md/"):
            self._old = True
            return self._md("POST")
        self._deny(404, "not found")

    def do_GET(self):
        self._start()
        if not self._allowed():
            return
        path = urlparse(self.path).path
        if self._v1path():
            return self._v1("GET")
        self._old = path.startswith("/api/md/") or path in ("/api/run", "/api/status")
        if path.startswith("/api/md/"):
            return self._md("GET")
        if path == "/api/run":
            q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            try:
                return self._json(run_status(q.get("label", "")))
            except Exception:
                return self._fail(path)
        if path == "/api/status":
            try:
                return self._json(status())
            except Exception:
                return self._fail(path)
        if path in PAGES:
            return self._page(PAGES[path])
        m = SCRIPT.match(path)
        if m:
            return self._script(m.group(1))
        self._deny(404, "not found")


def main(argv=None):
    global CASE, PORT, HOSTS, ORIGINS, APP_ORIGINS, APP_KEY
    ap = argparse.ArgumentParser(prog=prog.name() + " serve",
                                 description="Mesh Doctor dashboard (127.0.0.1 only).")
    ap.add_argument("--port", type=int, default=PORT, help="port on 127.0.0.1 (default %(default)s)")
    ap.add_argument("--case", default=None, help="live case for the transient page (default: live_case setting)")
    ap.add_argument("--open-app", action="store_true",
                    help="open the web app's pairing link in the browser (the Windows browser from WSL)")
    ap.add_argument("--container", action="store_true",
                    help="inside Docker only: listen on the container's interface so `docker run "
                         "-p 127.0.0.1:PORT:PORT` can reach it (the host still exposes it to itself only)")
    ap.add_argument("case_pos", nargs="?", help=argparse.SUPPRESS)          # old form: server.py <case>
    a = ap.parse_args(argv)
    bind = "127.0.0.1"
    if a.container:
        if not (os.path.exists("/.dockerenv") or os.path.exists("/run/.containerenv")):
            sys.exit("--container is only for running inside a Docker/Podman container")
        bind = "0.0.0.0"
    if os.name == "nt":
        sys.exit("Mesh Doctor runs on Linux. On Windows, start it inside WSL:\n"
                 "    wsl python3 -m meshdoctor serve\n"
                 "then open http://localhost:%d in the Windows browser." % a.port)
    if not 1024 <= a.port <= 65535:
        sys.exit("--port must be between 1024 and 65535")
    PORT = a.port
    HOSTS = {f"{h}:{PORT}" for h in ("localhost", "127.0.0.1", "[::1]")}
    ORIGINS = {f"http://{h}" for h in HOSTS}
    CASE = a.case or a.case_pos or config.settings().get("live_case", "")
    warn = config.ensure_workspace()
    print(f"Mesh Doctor dashboard: http://localhost:{PORT}   (listening on {bind}"
          + (" inside the container; publish it with -p 127.0.0.1:%d:%d only)" % (PORT, PORT) if a.container
             else " only)"), flush=True)
    print(f"Live case: {CASE or '(none set)'}   Workspace: {config.settings()['workspace']}", flush=True)
    if warn:
        print("WARNING: " + warn, flush=True)
    print("Security: answers only pages served from this address; job starts need the page's launch token.",
          flush=True)
    good, bad = pairing.parse_origins(config.settings().get("app_origins", ""))
    for b in bad:
        print(f"WARNING: ignored app address {b!r} (use https://host[:port] or http://localhost:port)", flush=True)
    APP_ORIGINS = set(good)
    APP_KEY = pairing.load_key().encode() if good else b""
    if good:
        url = pairing.link(good[0], PORT, APP_KEY.decode())
        print(f"Web app: {', '.join(good)} may use /api/v1 with the pairing key. Pair a browser once with:",
              flush=True)
        print(f"  {url}", flush=True)
        print("  (the link holds the key: treat it like a password; a new key: meshdoctor pair --new)", flush=True)
        if a.open_app and not pairing.open_url(url):
            print("  could not open a browser here; copy the link instead", flush=True)
    print(f"Another machine? Use an SSH tunnel: ssh -L {PORT}:localhost:{PORT} <you>@<this host>", flush=True)
    http.server.ThreadingHTTPServer((bind, PORT), H).serve_forever()


if __name__ == "__main__":
    main()
