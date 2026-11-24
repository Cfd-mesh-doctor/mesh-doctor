# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Transient plan: what a transient (URANS or DES) run of a steady case would cost.

A steady run that plateaus on a physically unsteady flow (a wing-tip vortex,
a tyre wake) cannot converge; the way on is a transient run with time-averaged
forces.  Before spending days on it, this answers: which time step does the
mesh allow, how many steps is that, how many hours, and which cells set it.

The steady solution's face fluxes give each cell's Courant number per second
of time step:  Co/dt = 0.5 * sum|phi_f| / V.  With adjustTimeStep, the largest
one sets the time step:  dt = maxCo / max(Co/dt).  Mesh Doctor's own
foamCourantCells (./Allwmake builds it) works it out in one light pass, with
the fastest cells' nearest wall, speed and shape; where it isn't built,
OpenFOAM's CourantNo function on the steady result (divided by the steady
deltaT) gives it, its fields read here whole.

    python3 -m meshdoctor transient-plan <case> [--time T] [--co 1,5,20] [--outer 3]
                                         [--flow-time S | --length L] [--top 100] [-o plan.json]
                                         [--sets DIR]

The case is only read: OpenFOAM runs in a throwaway shadow case whose mesh,
settings, flux and speed are links to it, so what it writes lands in a
temporary folder.  --sets DIR writes the fastest cells as the cell set
fastestCells into DIR, in the case's layout ([processorN/]constant/polyMesh/
sets/fastestCells), for a picture, a repair or topoSet in a copy of the case.
The web app starts the same as a `tplan` job (POST /api/v1/jobs) on a case in
the cases folder, which writes the plan to <workspace>/.tplans/<case>.json and
the cell set to <workspace>/.tplans/<case>.sets; GET /api/v1/tplans/{case}
answers the plan.
"""
import argparse, array, collections, glob, gzip, json, math, os, re, shutil, statistics, sys, tempfile, time

import caseinfo, config, md_api, prog, ramguard, schema

PKG = os.path.dirname(os.path.abspath(__file__))
PLANS = ".tplans"              # in the workspace: <case>.json, the plan a tplan job made of that case, and its log

TARGETS = (1.0, 5.0, 20.0)     # max Courant numbers to plan for: DES/LES need 1; URANS runs higher
OUTER = 3                      # PIMPLE outer iterations per time step, for the cost estimate
TOP = 100                      # "the fastest cells": how much would the time step grow without them?
FLOW_THROUGHS = 8              # default flow time: 3 L/U to wash out the start, 5 L/U to average
REGION = 40                    # fastest cells closer than 40 cell sizes are one region
FUNCS = "(CourantNo writeCellCentres writeCellVolumes)"     # where foamCourantCells isn't built
TOOL = "foamCourantCells"      # Mesh Doctor's own (./Allwmake): every cell's rate, and the fastest cells' details
SET = "fastestCells"           # the cell set of the fastest cells that --sets writes
SET_MARK = ".meshdoctor-sets"  # in a folder --sets wrote: only such a folder is ever replaced
CHUNK = 1 << 20
TIME_DIR = re.compile(r"^\d+(\.\d+)?(e[-+]?\d+)?$")


# ---- reading OpenFOAM fields -------------------------------------------------------
def read_internal(path):
    """The internalField of a volScalarField or volVectorField file as a flat
    array('d') (vectors as x0 y0 z0 x1 ...).  Binary or ASCII, plain or .gz."""
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rb") as fh:
        head = fh.read(CHUNK)
        m = re.search(rb"internalField\s+nonuniform\s+List<(\w+)>\s*(\d+)\s*\(", head)
        if not m:
            raise ValueError(f"{path}: no nonuniform internalField")
        n, ncomp = int(m.group(2)), caseinfo.NCOMP.get(m.group(1), 3)
        if re.search(rb"\bformat\s+binary", head[:m.start()]):
            size = 4 if re.search(rb"scalar\s*=\s*32", head[:m.start()]) else 8
            want = n * ncomp * size
            data = head[m.end():m.end() + want]
            if len(data) < want:
                data += fh.read(want - len(data))
            out = array.array("f" if size == 4 else "d")
            out.frombytes(data)
            out = array.array("d", out) if size == 4 else out
        else:                                     # ASCII: the list ends with a ")" line, then ";"
            body = head[m.end():] + fh.read()
            end = re.search(rb"\n\)\s*;", body)
            if not end:
                raise ValueError(f"{path}: internalField list not closed")
            out = array.array("d", map(float, body[:end.start()].replace(b"(", b" ").replace(b")", b" ").split()))
    if len(out) != n * ncomp:
        raise ValueError(f"{path}: {len(out)} values, expected {n * ncomp}")
    return out


def _field(d, name):
    for f in (os.path.join(d, name), os.path.join(d, name + ".gz")):
        if os.path.isfile(f):
            return f
    return None


def _procs(case):
    """processorN folders, in N order (processor10 after processor9)."""
    ps = [p for p in glob.glob(os.path.join(case, "processor*")) if re.fullmatch(r"processor\d+", os.path.basename(p))]
    return sorted(ps, key=lambda p: int(os.path.basename(p)[9:]))


def latest_time(case):
    """(time, decomposed): the latest time that has a flux field phi, decomposed when processor0 has it."""
    for root, dec in [(p, True) for p in _procs(case)[:1]] + [(case, False)]:
        times = [t for t in os.listdir(root) if TIME_DIR.match(t) and float(t) > 0 and _field(os.path.join(root, t), "phi")]
        if times:
            return max(times, key=float), dec
    return None, False


def steady_deltaT(case):
    txt = caseinfo.read_text(os.path.join(case, "system", "controlDict")) or ""
    m = re.search(r"^\s*deltaT\s+(" + caseinfo.NUM + r")\s*;", txt, re.M)
    return float(m.group(1)) if m else 1.0


# ---- the shadow case: OpenFOAM writes there, the case is only read ------------------
def shadow(case, t, decomposed, into):
    """Build a case in `into` whose system, mesh, phi and U at time t are links to `case`."""
    for d in ("system", "constant"):
        os.symlink(os.path.join(case, d), os.path.join(into, d))
    roots = [(p, os.path.join(into, os.path.basename(p))) for p in _procs(case)] if decomposed else [(case, into)]
    for src, dst in roots:
        os.makedirs(os.path.join(dst, t))
        if decomposed:
            os.symlink(os.path.join(src, "constant"), os.path.join(dst, "constant"))
        for name in ("phi", "phi.gz", "U", "U.gz", "polyMesh"):     # a mesh written at time t goes with it
            f = os.path.join(src, t, name)
            if os.path.exists(f):
                os.symlink(f, os.path.join(dst, t, name))
    return [dst for _, dst in roots]


def courant_cells(into, t, nproc, ntop):
    """Run foamCourantCells in the shadow case, each processor's `ntop` fastest cells asked for: its answer lands in
    [processorN/]meshDoctor/courant/cells.txt there.  (exit code, log path); 127 when it isn't built."""
    import abtest                      # sh(): runs under the OpenFOAM environment from config.py
    par = f"mpirun --oversubscribe -np {nproc} " if nproc > 1 else ""
    r = abtest.sh(f"command -v {TOOL} >/dev/null || exit 127; "
                  f"{par}{TOOL} {'-parallel ' if nproc > 1 else ''}-time {t} -nTop {ntop}",
                  os.path.join(into, f"log.{TOOL}"), into)
    return r["exit"], os.path.join(into, r["log"])


def read_cells(roots, decomposed):
    """foamCourantCells' answer, every processor's together: {"cells", "zero" (cells with no flux), "within2x", "lo"
    and "bin" (its histogram's first edge and width, in decades), "hist" ({bin: cells}), "rows"}; rows are each
    processor's fastest cells, fastest first, as {"proc", "cell" (its label there), "score" (Co per second of time
    step), "c", "h" (cube root of its volume), "aspect", "nonOrtho", "speed", "wallDist", "wall"}, the last three
    None where it couldn't tell (no U written; no wall on that processor)."""
    out = {"cells": 0, "zero": 0, "within2x": 0, "lo": 0.0, "bin": 1.0, "hist": {}, "rows": []}
    keys = {"N": "cells", "Z": "zero", "W": "within2x"}
    for r in roots:
        proc = int(os.path.basename(r)[9:]) if decomposed else 0
        f = os.path.join(r, "meshDoctor", "courant", "cells.txt")
        if not os.path.isfile(f):
            raise ValueError(f"{TOOL} wrote no answer for {os.path.basename(r) if decomposed else 'the case'}")
        with open(f) as fh:
            for line in fh:
                k, *v = line.split() or ("",)
                if k == "L" and len(v) == 2:
                    out["lo"], out["bin"] = float(v[0]), float(v[1])
                elif k in keys and len(v) == 1:
                    out[keys[k]] += int(v[0])
                elif k == "B" and len(v) == 2:
                    out["hist"][int(v[0])] = out["hist"].get(int(v[0]), 0) + int(v[1])
                elif k == "T" and len(v) == 11:
                    x = [float(s) for s in v[1:10]]
                    out["rows"].append({"proc": proc, "cell": int(v[0]), "score": x[0], "c": x[1:4],
                                        "h": max(x[4], 0.0) ** (1 / 3), "aspect": x[5], "nonOrtho": x[6],
                                        "speed": x[7] if x[7] >= 0 else None,
                                        "wallDist": x[8] if x[8] >= 0 else None,
                                        "wall": v[10] if v[10] != "-" else None})
    out["rows"].sort(key=lambda row: -row["score"])
    return out


def post_process(into, t, nproc):
    """Run CourantNo + cell centres + cell volumes in the shadow case, where foamCourantCells isn't built; (exit
    code, log path)."""
    import abtest                      # sh(): runs under the OpenFOAM environment from config.py
    par = f"mpirun --oversubscribe -np {nproc} " if nproc > 1 else ""
    r = abtest.sh(f"{par}foamPostProcess {'-parallel ' if nproc > 1 else ''}-funcs '{FUNCS}' -time {t}",
                  os.path.join(into, "log.foamPostProcess"), into)
    return r["exit"], os.path.join(into, r["log"])


def read_shadow(roots, t):
    """(Co, C, V) over every root, in processor order."""
    co, c, v = array.array("d"), array.array("d"), array.array("d")
    for r in roots:
        d = os.path.join(r, t)
        files = [_field(d, n) for n in ("Co", "C", "Vc")]
        if not all(files):
            raise ValueError(f"OpenFOAM wrote no {', '.join(n for n, f in zip(('Co', 'C', 'Vc'), files) if not f)} in {d}")
        a, b, w = (read_internal(f) for f in files)
        if not (len(a) == len(w) == len(b) // 3):
            raise ValueError(f"{d}: Co, C and Vc differ in length")
        co.extend(a); c.extend(b); v.extend(w)
    return co, c, v


# ---- the plan -------------------------------------------------------------------------
def analyse(rates, centres, volumes, top=TOP):
    """Distribution of Co per second of time step, and where the fastest cells are."""
    s = sorted(rates)
    n = len(s)
    q = lambda f: s[min(n - 1, int(f * n))]
    k = min(top, n - 1)
    dist = {"median": q(0.5), "p99": q(0.99), "p999": q(0.999), "p9999": q(0.9999), "max": s[-1],
            "withoutTop": s[-1 - k] if n > 1 else s[-1]}
    thr = s[max(0, n - k)]
    rows = [{"score": rates[i], "c": [centres[3 * i], centres[3 * i + 1], centres[3 * i + 2]],
             "h": max(volumes[i], 0.0) ** (1 / 3), "nonOrtho": 0.0}       # nonOrtho: unused here
            for i in range(n) if rates[i] >= thr]
    rows = sorted(rows, key=lambda r: -r["score"])[:k]
    import abtest
    # fast cells sit in refinement zones a few cm across: group within REGION cell sizes
    regions = [{"nCells": g["nCells"], "centre": g["centroid"], "bbox": g["bbox"], "h": g["h"],
                "maxRate": g["maxScoreAll"]} for g in abtest.cluster_points(rows, REGION)]
    regions.sort(key=lambda g: -g["maxRate"])
    return {"cells": n, "courantPerSecond": dist, "top": k,
            "cellsWithin2x": n - _bisect(s, s[-1] / 2), "regions": regions[:8]}


def _bisect(s, x):
    import bisect
    return bisect.bisect_left(s, x)


def analyse_cells(a, top=TOP):
    """analyse()'s answer from foamCourantCells': exact for the fastest cells (each processor gave its top + 1 of
    them, so the top + 1 of the whole mesh are all there), and below them from its histogram, placed within a
    bin (4.7 % wide) by rank as if its cells were spread evenly over it in log scale.  Each
    region also says its nearest wall (the one most of its cells are nearest), its cells' median distance from it,
    and the largest speed, aspect ratio and non-orthogonality there; fastestCells lists the fastest cells,
    [processor, cell], fastest first: the cell set --sets writes."""
    n, rows = a["cells"], a["rows"]
    if n < 1 or not rows:
        raise ValueError(f"{TOOL} found no cells with a flux")
    k = min(top, n - 1)
    exact = min(len(rows), top + 1)

    def q(f):
        i = min(n - 1, int(f * n))            # as analyse(): the i-th smallest, which is ...
        j = n - 1 - i                         # ... the j-th largest, from 0
        if j < exact:
            return rows[j]["score"]
        if i < a["zero"]:
            return 0.0
        seen = a["zero"]
        for b in sorted(a["hist"]):
            c = a["hist"][b]
            if seen + c > i:
                at = b + (i - seen + 0.5) / c
                return min(10 ** (a["lo"] + at * a["bin"]), rows[exact - 1]["score"])
            seen += c
        return rows[exact - 1]["score"]
    dist = {"median": q(0.5), "p99": q(0.99), "p999": q(0.999), "p9999": q(0.9999), "max": rows[0]["score"],
            "withoutTop": rows[k]["score"]}
    import abtest
    regions = []
    for g in abtest.cluster_points(rows[:k], REGION, members=True):
        m = g["members"]
        walls = collections.Counter(r["wall"] for r in m if r["wall"])
        wall = walls.most_common(1)[0][0] if walls else None          # a tie: the fastest cell's
        d = sorted(r["wallDist"] for r in m if wall and r["wall"] == wall and r["wallDist"] is not None)
        u = [r["speed"] for r in m if r["speed"] is not None]
        regions.append({"nCells": g["nCells"], "centre": g["centroid"], "bbox": g["bbox"], "h": g["h"],
                        "maxRate": g["maxScoreAll"], "wall": wall, "wallDist": d[len(d) // 2] if d else None,
                        "speed": max(u) if u else None, "aspectRatio": max(r["aspect"] for r in m),
                        "maxNonOrtho": g["maxNonOrtho"]})
    regions.sort(key=lambda g: -g["maxRate"])
    return {"cells": n, "courantPerSecond": dist, "top": k, "cellsWithin2x": a["within2x"], "regions": regions[:8],
            "fastestCells": [[r["proc"], r["cell"]] for r in rows[:k]]}


def seconds_per_iteration(case):
    """Wall seconds per steady iteration: the median over 10-iteration spans of the
    newest solver log's last 200 iterations (so one long pause does not count)."""
    for log in reversed(caseinfo.solver_logs(case)):
        if log.endswith("_hot"):
            continue
        try:
            with open(log, errors="replace") as f:
                t = [float(x) for x in re.findall(r"ClockTime = (" + caseinfo.NUM + r") s", f.read())]
        except OSError:
            continue
        t = t[-201:]
        spans = [(t[i + 10] - t[i]) / 10 for i in range(0, len(t) - 10, 10)]
        if spans:
            return statistics.median(spans)
    return None


def ref_length(case):
    """lRef of a forceCoeffs function in system/, if there is one."""
    for f in sorted(glob.glob(os.path.join(case, "system", "*"))):
        txt = caseinfo.read_text(f) if os.path.isfile(f) else None
        m = re.search(r"\blRef\s+(" + caseinfo.NUM + r")\s*;", txt or "")
        if m:
            return float(m.group(1))
    return None


def options(dist, targets, flow_time, sec_per_iter, outer):
    out = []
    for c in targets:
        dt, dt2 = c / dist["max"], c / dist["withoutTop"]
        o = {"maxCo": c, "deltaT": dt, "deltaTWithoutTop": dt2, "stepsPerSecond": 1 / dt}
        if sec_per_iter:
            o["hoursPerFlowSecond"] = outer * sec_per_iter / dt / 3600
        if flow_time:
            o["steps"] = math.ceil(flow_time / dt)
            if sec_per_iter:
                o["hours"] = o["steps"] * outer * sec_per_iter / 3600
                o["hoursWithoutTop"] = math.ceil(flow_time / dt2) * outer * sec_per_iter / 3600
        out.append(o)
    return out


def plan(case, t=None, targets=TARGETS, outer=OUTER, flow_time=None, length=None, top=TOP, keep=None):
    """The transient plan for `case` (a dict in the tplan schema).  keep: a folder to
    leave the shadow case in (for debugging); by default it is removed."""
    case = os.path.abspath(case)
    if t is None:
        t, dec = latest_time(case)
        if t is None:
            raise ValueError(f"{case}: no time with a flux field (phi) to plan from")
    else:
        if not TIME_DIR.match(t):               # it goes into the foamPostProcess command line
            raise ValueError(f"not a time: {t!r}")
        dec = bool(_procs(case)) and bool(_field(os.path.join(_procs(case)[0], t), "phi"))
        if not dec and not _field(os.path.join(case, t), "phi"):
            raise ValueError(f"{case}: no phi at time {t}")
    ok, msg = ramguard.check(case, "post")
    if not ok:
        raise MemoryError(msg)
    into = keep or tempfile.mkdtemp(prefix="meshdoctor_tplan_")
    t0 = time.time()
    try:
        roots = shadow(case, t, dec, into)
        tool = TOOL
        code, log = courant_cells(into, t, len(roots), top + 1)
        if code == 127:                         # not built: OpenFOAM's CourantNo, its fields read here whole
            tool = "foamPostProcess"
            code, log = post_process(into, t, len(roots))
        if code != 0:
            tail = (caseinfo.read_text(log) or "").strip().splitlines()[-6:]
            raise RuntimeError("%s failed (exit %d): %s" % (tool, code, " / ".join(tail)))
        got = read_cells(roots, dec) if tool == TOOL else read_shadow(roots, t)
    finally:
        if not keep:
            shutil.rmtree(into, ignore_errors=True)
    if tool == TOOL:                            # its rates are per second of time step already
        out = analyse_cells(got, top)
    else:
        co, c, v = got
        dts = steady_deltaT(case)
        rates = array.array("d", (x / dts for x in co)) if dts != 1 else co
        out = analyse(rates, c, v, top)
    u = caseinfo.freestream(case)
    speed = math.sqrt(sum(x * x for x in u)) if u else None
    length = length or ref_length(case)
    src = "given" if flow_time else None
    if not flow_time and length and speed:
        flow_time, src = FLOW_THROUGHS * length / speed, f"{FLOW_THROUGHS} L/U"
    spi = seconds_per_iteration(case)
    doc = {"case": os.path.basename(case), "time": t, "processors": len(roots) if dec else 1, "decomposed": dec,
           "tool": tool, **out, "speed": speed, "length": length, "flowTime": flow_time, "flowTimeSource": src,
           "secondsPerIteration": spi, "outerCorrectors": outer,
           "options": options(out["courantPerSecond"], targets, flow_time, spi, outer),
           "seconds": round(time.time() - t0, 1),
           "notes": ["Courant numbers come from the steady flow; in the transient run the velocity "
                     "fluctuates, so the real max Co is usually somewhat higher.",
                     "Hours assume one PIMPLE outer iteration costs about one steady iteration.",
                     "DES/LES need max Co <= 1; URANS with enough outer correctors usually runs higher."]}
    if tool != TOOL:
        doc["notes"].append(f"Mesh Doctor's {TOOL} isn't built (./Allwmake in its folder), so OpenFOAM's CourantNo made "
                            "this plan: the fastest places come without their nearest wall, speed and shape.")
    return schema.stamp(doc, "tplan")


def cell_set(labels, name=SET):
    """An OpenFOAM cellSet file of these cell labels."""
    return ("FoamFile\n{\n    format      ascii;\n    class       cellSet;\n"
            f'    location    "constant/polyMesh/sets";\n    object      {name};\n}}\n\n'
            f"{len(labels)}\n(\n" + "".join(f"{c}\n" for c in labels) + ")\n")


def write_sets(dest, p):
    """Write the plan's fastest cells as the cell set SET into folder `dest`, in the case's layout: constant/polyMesh/
    sets/SET, or processorN/constant/polyMesh/sets/SET on every processor of a decomposed case (empty where it has
    none, as OpenFOAM reads a set on each).  Written whole beside `dest`, then put in place; a `dest` already there
    is replaced only if this wrote it (its SET_MARK file), so no folder of yours is ever removed."""
    dest = os.path.abspath(dest)
    if os.path.islink(dest) or (os.path.lexists(dest) and not os.path.isfile(os.path.join(dest, SET_MARK))):
        raise ValueError(f"{os.path.basename(dest)} is there already and isn't a folder of cell sets this wrote: "
                         "not replacing it")
    by = {}
    for proc, cell in p["fastestCells"]:
        by.setdefault(proc, []).append(cell)
    procs = [f"processor{n}" for n in range(p["processors"])] if p.get("decomposed") else [""]
    tmp, old = f"{dest}.{os.getpid()}.tmp", f"{dest}.{os.getpid()}.old"
    shutil.rmtree(tmp, ignore_errors=True)
    try:
        for n, sub in enumerate(procs):
            d = os.path.join(tmp, sub, "constant", "polyMesh", "sets")
            os.makedirs(d)
            with open(os.path.join(d, SET), "w") as f:
                f.write(cell_set(sorted(by.get(n, []))))
        with open(os.path.join(tmp, SET_MARK), "w") as f:
            f.write(f"The cell set {SET}: the {len(p['fastestCells'])} fastest cells of the transient plan of "
                    f"{p['case']} at {p['time']}, which set its time step.\n")
        if os.path.lexists(dest):
            os.replace(dest, old)
        os.replace(tmp, dest)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        shutil.rmtree(old, ignore_errors=True)


def summary(p):
    """A few lines for people."""
    d = p["courantPerSecond"]
    lines = [f"{p['case']} at {p['time']}: {p['cells']:,} cells; Co per second of time step: "
             f"median {d['median']:.3g}, 99.99 % {d['p9999']:.3g}, max {d['max']:.3g}"]
    lines.append(f"the time step is set by {p['cellsWithin2x']:,} cells within 2x of the max; "
                 f"without the {p['top']} fastest it could be {d['max'] / d['withoutTop']:.2g}x larger")
    for g in p["regions"][:3]:
        s = (f"  {g['nCells']} of the fastest cells near ({', '.join(f'{x:.3g}' for x in g['centre'])}), "
             f"size {g['h']:.2g} m")
        if g.get("wall"):
            s += f", {g['wallDist']:.2g} m from {g['wall']}" if g.get("wallDist") is not None else f", by {g['wall']}"
        if g.get("speed") is not None:
            s += f", flow up to {g['speed']:.3g} m/s"
        lines.append(s)
    ft = p["flowTime"]
    lines.append(f"flow time {ft:.3g} s ({p['flowTimeSource']})" if ft else
                 "flow time unknown: pass --flow-time, or --length when the freestream speed is known"
                 + ("" if p["speed"] else " (no freestream U found in 0/)"))
    h = lambda x: f"{x:.2g}" if x < 10 else f"{x:,.0f}"
    for o in p["options"]:
        s = f"max Co {o['maxCo']:g}: dt {o['deltaT']:.3g} s"
        if "steps" in o:
            s += f", {o['steps']:,} steps"
        if "hours" in o:
            s += (f", about {h(o['hours'])} h at {p['outerCorrectors']} outer iterations per step"
                  f" ({h(o['hoursWithoutTop'])} h without the fastest cells)")
        elif "hoursPerFlowSecond" in o:
            s += f", about {h(o['hoursPerFlowSecond'] / 10)} h per 0.1 s of flow at {p['outerCorrectors']} outer iterations per step"
        lines.append(s)
    return "\n".join(lines)


# ---- the plan as a job (POST /api/v1/jobs, kind "tplan") and its answer (GET /api/v1/tplans/{name}) -----------
def plan_file(name):
    return os.path.join(config.settings()["workspace"], PLANS, name + ".json")


def sets_dir(name):
    """Where a tplan job writes the cell set of case `name`'s fastest cells (--sets)."""
    return os.path.join(config.settings()["workspace"], PLANS, name + ".sets")


def _case(name):
    """Case `name` in the cases folder, as GET /judge?case= takes one: a folder with system/controlDict that
    doesn't hold the workspace; else None."""
    case = os.path.join(md_api.run_dir(), name)
    ws = md_api.md_dir().rstrip("/")
    if not os.path.isfile(os.path.join(case, "system", "controlDict")) or \
            (ws + "/").startswith(case.rstrip("/") + "/"):
        return None
    return case


def refusal(name):
    """Why case `name` can't be planned now, as (code, message) with no paths, or None."""
    if not md_api.SAFE.match(name):
        return "bad-request", "bad case name"
    case = _case(name)
    if case is None:
        return "not-found", f"no case {name} in the cases folder"
    if latest_time(case)[0] is None:
        return "not-ready", (f"{name} has no solved result to plan from (a written time with its face flux, phi): "
                             "solve it first")
    return None


def start(name):
    """Start a tplan job (POST /jobs, kind "tplan"): the job, or a refusal, as md_api's other starts answer.  It plans
    from the case's latest result, only reads the case, and writes the plan to <workspace>/.tplans/<name>.json and
    the cell set of its fastest cells to <workspace>/.tplans/<name>.sets; a plan made before stays until the new
    one is whole."""
    why = refusal(name)
    if why:
        return md_api._refuse(*why)
    ws = config.settings()["workspace"]
    config.ensure_workspace(ws)
    os.makedirs(os.path.join(ws, PLANS), mode=0o700, exist_ok=True)
    case = _case(name)
    cmd = [sys.executable, os.path.join(PKG, "tplan.py"), case, "-o", plan_file(name), "--sets", sets_dir(name)]
    return md_api._submit("tplan", {"name": name}, name, cmd, log=f"{PLANS}/{name}.log",
                          result=f"{PLANS}/{name}.json", ram=(case, "post"))


def of(name):
    """GET /tplans/{name}: (the plan a tplan job made of case `name`, None), or (None, (code, message))."""
    if not md_api.SAFE.match(name):
        return None, ("bad-request", "bad case name")
    try:
        return schema.read(plan_file(name), "tplan"), None
    except schema.SchemaError as e:
        return None, ("schema-version", f"the transient plan of {name}: {getattr(e, 'why', 'newer file version')}")
    except (OSError, ValueError):
        return None, ("not-found", f"no transient plan of {name}: a tplan job makes one")


def main(argv=None):
    ap = argparse.ArgumentParser(prog=prog.name() + " transient-plan", description=__doc__.split("\n\n")[0])
    ap.add_argument("case", help="a steady case with a written result (only read)")
    ap.add_argument("--time", help="result time to plan from (default: the latest with phi)")
    ap.add_argument("--co", default=",".join(f"{c:g}" for c in TARGETS), help="max Courant numbers (default %(default)s)")
    ap.add_argument("--outer", type=int, default=OUTER, help="PIMPLE outer iterations per step (default %(default)s)")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--flow-time", type=float, help="seconds of flow to simulate")
    g.add_argument("--length", type=float, help=f"body length in m: flow time = {FLOW_THROUGHS} L/U")
    ap.add_argument("--top", type=int, default=TOP, help="the fastest cells to locate (default %(default)s)")
    ap.add_argument("-o", "--out", help="write the plan here (JSON) instead of printing it")
    ap.add_argument("--sets", help=f"also write the fastest cells as the cell set {SET} into this folder, in the "
                                   "case's layout ([processorN/]constant/polyMesh/sets): a new folder, or one this "
                                   "wrote before")
    a = ap.parse_args(argv)
    try:
        targets = tuple(float(x) for x in a.co.split(","))
        if not all(math.isfinite(x) and x > 0 for x in targets):
            raise ValueError
    except ValueError:
        sys.exit("--co: positive numbers, comma-separated")
    for name in ("flow_time", "length"):
        v = getattr(a, name)
        if v is not None and not (math.isfinite(v) and v > 0):
            sys.exit(f"--{name.replace('_', '-')}: a positive number")
    if a.outer < 1 or a.top < 1:
        sys.exit("--outer and --top: at least 1")
    try:
        p = plan(a.case, a.time, targets, a.outer, a.flow_time, a.length, a.top)
        if a.sets and p.get("fastestCells") is not None:     # foamCourantCells' plans know their cells
            write_sets(a.sets, p)
            p["cellSet"] = {"name": SET, "cells": len(p["fastestCells"])}
    except (ValueError, RuntimeError, MemoryError) as e:
        sys.exit(f"transient-plan: {e}")
    except OSError as e:
        sys.exit(f"transient-plan: couldn't write the cell set: {e.strerror or e}")
    print(summary(p), file=sys.stderr)
    if a.out:                   # written whole, then put in place: a reader never sees half a plan
        tmp = f"{a.out}.{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            json.dump(p, f, indent=1)
        os.replace(tmp, a.out)
    else:
        json.dump(p, sys.stdout, indent=1)
        print()


if __name__ == "__main__":
    main()
