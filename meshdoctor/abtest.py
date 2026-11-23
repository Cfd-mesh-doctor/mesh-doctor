#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""A/B solver test: does the repaired mesh converge better than the original?

    python3 abtest.py <srcCase> <fixedName> [--iters 200] [--np 6] [--init <folder>]
    python3 abtest.py hotspots <abDir>      # residual hotspot map for both runs
    python3 abtest.py mode <case> <t1> <t2> [--defects <mdCase>]
                                            # where the solution moves between two
                                            # written times (slow oscillation shape)
    python3 abtest.py extend <abDir> <endIter> [--variant P]
                                            # continue the second run to iteration
                                            # endIter (optionally with another
                                            # preset), judge it
    python3 abtest.py judge <case> [window|auto] [--to N]   # convergence verdict for any case
    <abDir>               an A/B test's folder, or the name of the repaired run it
                          tested (its test in the workspace, <name>_ab)
    --init <folder>       the case's folder both runs start from (default: 0.warm
                          when the case has one, else 0)
    --variant simplec|relax|lts   solver-setting variant on the second run
    --extend <N>          after the A/B, continue the second run to N iterations
    --base-from <abDir>   reuse the original-mesh run of an earlier A/B
                          (same source, iterations, start fields, ranks)

Runs the SAME case setup twice on copies: once on the original mesh
(srcCase/constant/polyMesh) and once with the points that Mesh Doctor
corrected (<workspace>/<fixedName>/constant/polyMesh/points).
Topology is identical, so the decomposition, initial fields and settings are
identical too; only the point positions differ.

Writes <workspace>/<fixedName>_ab/ab_result.json with residual levels, force
means/oscillation and seconds per iteration for both runs, plus a checksum
proving the source case was only read.  <workspace> comes from config.py.
Serial-mesh sources only (the root polyMesh must be the real mesh). A case without a
system/decomposeParDict (run in serial) gets a scotch one in both copies.
"""
import bisect, gzip, json, os, re, shutil, statistics, subprocess, sys, time

import caseinfo
import config
import ramguard
import schema

HOME = os.path.expanduser("~")
_S = config.settings()
ROOT = _S["workspace"]                 # where A/B copies are made (config.py)
BASHRC = _S["bashrc"]                  # OpenFOAM environment (config.py)


def sh(cmd, log, cwd):
    full = f"source {BASHRC} >/dev/null 2>&1; {cmd}"
    t0 = time.time()
    with open(log, "w") as f:
        r = subprocess.run(["bash", "-c", full], cwd=cwd, stdout=f, stderr=subprocess.STDOUT)
    return {"cmd": cmd, "log": os.path.basename(log), "exit": r.returncode,
            "seconds": round(time.time() - t0, 1)}


def _must_pass(run, case):
    """Stop the A/B with the log's name when an OpenFOAM step fails."""
    if run["exit"] != 0:
        sys.exit(f"{run['cmd'].split()[0] if 'mpirun' not in run['cmd'] else 'foamRun'} failed "
                 f"(exit {run['exit']}); see {os.path.join(case, run['log'])}")


def status(top, **kw):
    kw["time"] = time.strftime("%Y-%m-%d %H:%M:%S")
    json.dump(kw, open(os.path.join(top, "ab_status.json"), "w"))


# The decomposition a case run in serial gets in its copies: the A/B test solves in parallel, and run_one sets the
# rank count (scotch splits by mesh topology only, so both copies get the same split).
DECOMPOSE_PAR_DICT = """FoamFile
{
    format      ascii;
    class       dictionary;
    location    "system";
    object      decomposeParDict;
}

// Written by Mesh Doctor's A/B test: the case has no decomposeParDict.

numberOfSubdomains 1;
decomposer      scotch;
"""


def make_case(src, dst, init, points=None):
    if os.path.exists(dst):
        shutil.rmtree(dst)
    os.makedirs(dst)
    shutil.copytree(os.path.join(src, "system"), os.path.join(dst, "system"))
    shutil.copytree(os.path.join(src, "constant"), os.path.join(dst, "constant"))
    shutil.copytree(os.path.join(src, init), os.path.join(dst, "0"))
    if points:
        shutil.copy2(points, os.path.join(dst, "constant/polyMesh/points"))
    dpd = os.path.join(dst, "system", "decomposeParDict")
    if not os.path.isfile(dpd):                # a case run in serial has none: these runs are parallel
        with open(dpd, "w") as f:
            f.write(DECOMPOSE_PAR_DICT)
    open(os.path.join(dst, ".meshDoctorCopy"), "w").write(src + "\n")


def start_fields(src, init=None):
    """The folder of the source case both runs start from: --init as given, else 0.warm when the case has one (a
    solution you already have), else its own 0. Stops with a plain message, before anything is copied or solved,
    when the case has no such folder."""
    if init is None:
        init = "0.warm" if os.path.isdir(os.path.join(src, "0.warm")) else "0"
    if not os.path.isdir(os.path.join(src, init)):
        sys.exit(f"no start fields: {src} has no {init}/ folder. Pass --init with the folder both runs should "
                 "start from.")
    return init


def ab_dir(arg):
    """The A/B test a follow-up (extend, hotspots) names, as an absolute path: the folder as given (from where you
    are), else, for a plain name, the A/B test of the repaired run of that name in the workspace (<name>_ab), so
    `ab extend wing-fix 400` works from any folder, the workspace too (where wing-fix is the repaired copy itself).
    Stops with a plain message when neither has a result."""
    import repair                              # PLAIN (same folder)
    path = os.path.abspath(os.path.expanduser(arg))
    if os.path.isfile(os.path.join(path, "ab_result.json")):
        return path
    ws = os.path.abspath(ROOT)
    if repair.PLAIN.fullmatch(arg):
        named = os.path.join(ws, arg if arg.endswith("_ab") else arg + "_ab")
        if os.path.isfile(os.path.join(named, "ab_result.json")):
            print(f"using the A/B test {os.path.basename(named)} in {ws}", file=sys.stderr, flush=True)
            return named
    sys.exit(f"no A/B test result for {arg!r}: it is not an A/B test's folder here, nor a repaired run whose A/B "
             f"test is in the workspace {ws} (meshdoctor config shows that folder). Start one with meshdoctor ab "
             "<case> <name>.")


def extend_to(top, arg, end):
    """The iteration `ab extend` continues the repaired run to, checked before anything runs: the test has finished
    that run and kept its decomposed fields, and end is a whole number past the iteration the run is at now."""
    if not schema.read(os.path.join(top, "ab_result.json"), "abtest").get("fixed"):
        sys.exit(f"the A/B test in {top} has not finished its repaired run yet: let it finish, then extend it")
    if not os.path.isdir(os.path.join(top, "fixed", "processor0")):
        sys.exit(f"the repaired run in {top} has no decomposed fields (processor0/) to continue from")
    now = float(latest_time(os.path.join(top, "fixed")))
    if not re.fullmatch(r"[0-9]+", end) or int(end) <= now:
        sys.exit(f"extend to which iteration? The repaired run is at iteration {now:g}: give a whole number past "
                 f"it, e.g. meshdoctor ab extend {arg} {int(now) + 200}")
    return int(end)


def parse_residuals(case, logs=None):
    """{field: [...], "Time": [...]} from a residuals function object, else from the solver logs."""
    return _fo_residuals(case) or caseinfo.log_residuals(logs or caseinfo.solver_logs(case))


def _fo_residuals(case):
    pp = os.path.join(case, "postProcessing")
    out = {}
    if not os.path.isdir(pp):
        return out
    for d in os.listdir(pp):
        if not d.startswith("residuals"):
            continue
        cols, byt = None, {}
        for f in time_files(os.path.join(pp, d), "residuals.dat"):
            for line in open(f):
                if line.startswith("#"):
                    if "Time" in line:
                        cols = line[1:].split()
                    continue
                t = line.split()
                if cols and len(t) == len(cols):
                    try:
                        r = [float(x) if x != "N/A" else None for x in t]
                    except ValueError:
                        continue
                    if any(v is not None for v in r[1:]):
                        byt[r[0]] = r
        if cols and byt:
            rows = [byt[t] for t in sorted(byt)]
            for i, c in enumerate(cols[1:], 1):
                out[c] = [r[i] for r in rows]
            out["Time"] = [r[0] for r in rows]
    return out


def time_files(d, name):
    """<d>/<time>/<name> for every restart folder, in time order."""
    ts = []
    for t in os.listdir(d) if os.path.isdir(d) else []:
        try:
            ts.append((float(t), os.path.join(d, t, name)))
        except ValueError:
            pass
    return [f for _, f in sorted(ts) if os.path.isfile(f)]


VEC = re.compile(r"^(\S+)\s+\(\(([^)]*)\)\s+\(([^)]*)\)\)")


def parse_forces(case):
    """Every force group the case writes (both OpenFOAM file layouts); see caseinfo.py."""
    out = caseinfo.parse_forces(case)
    return out


def stats(x):
    x = [v for v in x if v is not None]
    if not x:
        return None
    return {"mean": statistics.fmean(x), "std": statistics.pstdev(x) if len(x) > 1 else 0.0,
            "min": min(x), "max": max(x), "median": statistics.median(x), "n": len(x)}


def summarise(case, window):
    res = parse_residuals(case)
    frc = parse_forces(case)
    log = os.path.join(case, "log.foamRun")
    txt = open(log, errors="replace").read() if os.path.isfile(log) else ""
    et = [float(x) for x in re.findall(r"ExecutionTime = ([\d.]+) s", txt)]
    spi = (et[-1] - et[min(10, len(et) - 1)]) / max(1, len(et) - 1 - min(10, len(et) - 1)) if len(et) > 12 else None
    s = {"iterations": len(et), "secondsPerIteration": spi,
         "bounding": len(re.findall(r"bounding", txt)),
         "residuals": {k: stats(v[-window:]) for k, v in res.items() if k != "Time"},
         "forces": {g: {k: stats(v[k][-window:]) for k in ("Fx", "Fy", "Fz")}
                    for g, v in frc.items()},
         "residualHistory": {k: v[::max(1, len(v) // 400)] for k, v in res.items()}}
    return s


# Solver-setting variants (applied to the second run instead of / besides
# repaired points).  Each entry: (file, foamDictionary entry, value).
PRESETS = {
    "simplec": [("system/fvSolution", "SIMPLE/consistent", "yes"),
                ("system/fvSolution", "relaxationFactors",
                 '{ fields { p 1; } equations { U 0.9; ".*" 0.7; } }')],
    # SIMPLEC with heavier momentum/turbulence under-relaxation: tests whether
    # damping shrinks a slow SIMPLE oscillation (e.g. continue a plateaued run)
    "simplec2": [("system/fvSolution", "SIMPLE/consistent", "yes"),
                 ("system/fvSolution", "relaxationFactors",
                  '{ fields { p 1; } equations { U 0.7; ".*" 0.5; } }')],
    "relax": [("system/fvSolution", "relaxationFactors",
               '{ fields { p 0.2; } equations { U 0.5; ".*" 0.5; } }')],
    # pseudo-transient local time stepping: each cell marches at its own
    # Courant-limited time step, which damps the slow SIMPLE oscillation
    # that a separated steady flow can lock into
    "lts": [("system/fvSchemes", "ddtSchemes", "{ default localEuler; }"),
            ("system/fvSolution", "PIMPLE",
             "{ nOuterCorrectors 1; nCorrectors 2; nNonOrthogonalCorrectors 1; "
             "maxCo 5; rDeltaTSmoothingCoeff 0.1; rDeltaTDampingCoeff 0.5; maxDeltaT 1; "
             "pRefCell 0; pRefValue 0; consistent yes; }"),
            ("system/fvSolution", "solvers/pFinal",
             "{ solver GAMG; smoother GaussSeidel; nPreSweeps 2; nPostSweeps 1; "
             "cacheAgglomeration on; agglomerator faceAreaPair; nCellsInCoarsestLevel 100; "
             "mergeLevels 1; tolerance 1e-06; relTol 0.01; minIter 1; maxIter 1000; }"),
            *[("system/fvSolution", f"solvers/{f}Final",
               "{ solver PBiCGStab; preconditioner DILU; tolerance 1e-08; relTol 0.01; "
               "minIter 1; maxIter 1000; }") for f in ("U", "k", "omega")],
            ("system/fvSolution", "relaxationFactors",
             '{ fields { p 1; } equations { ".*" 1; } }')],
}

# what the dashboard shows for each preset (one list: the API checks against PRESETS)
PRESET_LABELS = {
    "simplec": "SIMPLEC (consistent yes, U 0.9)",
    "simplec2": "SIMPLEC, heavier relaxation (U 0.7, turbulence 0.5)",
    "relax": "SIMPLE, low relaxation (p 0.2, U 0.5)",
    "lts": "pseudo-transient local time stepping (localEuler)",
}


def apply_settings(case, settings):
    runs = []
    for i, (f, entry, val) in enumerate(settings):
        v = val.replace("'", r"'\''")
        runs.append(sh(f"foamDictionary {f} -entry '{entry}' -set '{v}'",
                       os.path.join(case, f"log.variant_{i}"), case))
    return runs


def run_one(case, iters, nproc):
    runs = []
    for k, v in (("startFrom", "startTime"), ("startTime", "0"), ("endTime", str(iters)),
                 ("writeInterval", str(iters)), ("purgeWrite", "0")):
        runs.append(sh(f"foamDictionary system/controlDict -entry {k} -set {v}",
                       os.path.join(case, f"log.dict_{k}"), case))
    runs.append(sh(f"foamDictionary system/decomposeParDict -entry numberOfSubdomains -set {nproc}",
                   os.path.join(case, "log.dict_np"), case))
    # scotch splits by mesh topology only: any rank count works (a case's own
    # simple/hierarchical split is tied to its count), and the original and the
    # repaired mesh (same topology, moved points) get exactly the same split
    # OpenFOAM 14 reads `decomposer`; older dictionaries say `method`: set both
    for key in ("decomposer", "method"):
        runs.append(sh(f"foamDictionary system/decomposeParDict -entry {key} -set scotch",
                       os.path.join(case, f"log.dict_{key}"), case))
    runs.append(sh("decomposePar -force", os.path.join(case, "log.decomposePar"), case))
    _must_pass(runs[-1], case)
    runs.append(sh(f"nice -n 5 mpirun --oversubscribe -np {nproc} foamRun -parallel",
                   os.path.join(case, "log.foamRun"), case))
    _must_pass(runs[-1], case)
    # free the disk: processor dirs are not needed for the comparison
    return runs


# --------------------------------------------------------------------------
# Residual hotspots: one more iteration, then map where the solution moves
def read_hot(case):
    rows = []
    files = [os.path.join(case, d, "meshDoctor/hotspots/hot.txt") for d in sorted(os.listdir(case))
             if re.fullmatch(r"processor\d+", d)]
    files = [f for f in files if os.path.isfile(f)] or [os.path.join(case, "meshDoctor/hotspots/hot.txt")]
    for f in files:
        if os.path.isfile(f):
            for line in open(f):
                t = line.split()
                if t and t[0] == "H":
                    rows.append({"score": float(t[2]), "dp": float(t[3]), "dU": float(t[4]),
                                 "c": [float(t[5]), float(t[6]), float(t[7])],
                                 "h": float(t[8]) ** (1 / 3), "nonOrtho": float(t[9])})
    rows.sort(key=lambda r: -r["score"])
    return rows


def cluster_points(rows, rfac=4.0, members=False):
    """Group rows ({"c", "h", "score", "nonOrtho"}) closer than rfac cell sizes; members=True
    also returns each group's rows."""
    n = len(rows)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    if not n:
        return []
    g = max(1e-9, rfac * sorted(r["h"] for r in rows)[n // 2])
    grid = {}
    for i, r in enumerate(rows):
        grid.setdefault(tuple(int(x // g) for x in r["c"]), []).append(i)
    for i, r in enumerate(rows):
        k = tuple(int(x // g) for x in r["c"])
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for j in grid.get((k[0] + dx, k[1] + dy, k[2] + dz), ()):
                        if j > i:
                            rr = rfac * max(r["h"], rows[j]["h"])
                            if sum((r["c"][q] - rows[j]["c"][q]) ** 2 for q in range(3)) < rr * rr:
                                parent[find(i)] = find(j)
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(rows[i])
    out = []
    for m in groups.values():
        out.append({"nCells": len(m), "maxScore": m[0]["score"] if m else 0,
                    "maxScoreAll": max(x["score"] for x in m),
                    "sumScore2": sum(x["score"] ** 2 for x in m),
                    "centroid": [sum(x["c"][q] for x in m) / len(m) for q in range(3)],
                    "bbox": [[min(x["c"][q] for x in m) for q in range(3)],
                             [max(x["c"][q] for x in m) for q in range(3)]],
                    "h": sorted(x["h"] for x in m)[len(m) // 2],
                    "maxNonOrtho": max(x["nonOrtho"] for x in m),
                    "meanNonOrtho": sum(x["nonOrtho"] for x in m) / len(m)})
        if members:
            out[-1]["members"] = m
    out.sort(key=lambda c: -c["sumScore2"])
    return out


def box_dist(p, lo, hi):
    return sum(max(lo[q] - p[q], 0, p[q] - hi[q]) ** 2 for q in range(3)) ** 0.5


def hot(case, iters, nproc, defects):
    """defects: Mesh Doctor problem regions (list with bbox, h) for this mesh."""
    runs = []
    for k, v in (("startFrom", "startTime"), ("startTime", str(iters)),
                 ("endTime", str(iters + 1)), ("writeInterval", "1")):
        runs.append(sh(f"foamDictionary system/controlDict -entry {k} -set {v}",
                       os.path.join(case, f"log.dict_hot_{k}"), case))
    runs.append(sh(f"nice -n 5 mpirun --oversubscribe -np {nproc} foamRun -parallel",
                   os.path.join(case, "log.foamRun_hot"), case))
    return hotspot_map(case, str(iters), str(iters + 1), nproc, defects, runs)


def hotspot_map(case, t_from, t_to, nproc, defects, runs=None, out="hotspots.json"):
    """Map where the solution changes between two written times.  With
    consecutive iterations this is the local residual; with times a few
    hundred iterations apart it is the shape of a slow oscillation."""
    runs = runs if runs is not None else []
    par = f"nice -n 5 mpirun --oversubscribe -np {nproc} " if nproc > 1 else ""
    runs.append(sh(f"{par}foamResidualHotspots {'-parallel ' if nproc > 1 else ''}"
                   f"-from {t_from} -to {t_to} -nHot 3000",
                   os.path.join(case, f"log.hotspots_{t_from}_{t_to}"), case))
    summ = {}
    sf = os.path.join(case, "meshDoctor/hotspots_summary.txt")
    if os.path.isfile(sf):
        for line in open(sf):
            k, *v = line.split()
            if v:
                try:
                    summ[k] = float(v[0])
                except ValueError:
                    summ[k] = v[0]
    rows = read_hot(case)[:5000]
    cl = cluster_points(rows)
    for c in cl:
        d = min((box_dist(c["centroid"], b["bbox"][0], b["bbox"][1]) / max(b.get("h", 1e-3), 1e-6)
                 for b in defects), default=None)
        c["distToMeshDefect_h"] = d
        c["nearMeshDefect"] = d is not None and d < 5
    tot = sum(c["sumScore2"] for c in cl) or 1
    near = sum(c["sumScore2"] for c in cl if c["nearMeshDefect"])
    res = {"summary": summ, "clusters": cl[:60], "nHotCells": len(rows),
           "shareOfTopChangeNearMeshDefects": near / tot, "runs": runs,
           "from": t_from, "to": t_to}
    os.makedirs(os.path.join(case, "meshDoctor"), exist_ok=True)
    with open(os.path.join(case, "meshDoctor", out), "w") as f:
        json.dump(res, f, indent=1)
    return res


def defects_of(fixed_name):
    r = os.path.join(ROOT, fixed_name, "meshDoctor/result.json")
    try:
        res = json.load(open(r))
        return res.get("clustersBefore", []), res.get("clustersAfter", [])
    except (OSError, ValueError):
        return [], []


def hot_both(top):
    result = schema.read(os.path.join(top, "ab_result.json"), "abtest")
    name = result.get("fixedName")
    db, da = defects_of(name) if name else ([], [])
    for tag, defects in (("base", db), ("fixed", da)):
        if tag == "base" and result.get("baseReusedFrom") and result.get("baseHotspots"):
            continue
        case = os.path.join(top, tag)
        status(top, step=f"hotspots {tag}")
        h = hot(case, result["iters"], result["nProcs"], defects)
        result[tag + "Hotspots"] = {k: h[k] for k in ("summary", "nHotCells",
                                                     "shareOfTopChangeNearMeshDefects")}
        result[tag + "Hotspots"]["top"] = h["clusters"][:15]
        schema.write(os.path.join(top, "ab_result.json"), result, indent=1)
    status(top, step="done")
    return result


# --------------------------------------------------------------------------
# Convergence judge: residual trend + force drift/oscillation over windows
T95 = {2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262}


def batch_means(x, nb=5):
    """Mean of a force history with an honest uncertainty: split into nb
    batches; 95 % CI from the spread of batch means (Student t), and half the
    max-min spread of batch means.  If batches are shorter than the slow
    oscillation, the CI is optimistic, so the larger of the two is reported."""
    n = len(x) // nb
    if n < 5:
        return None
    bm = [statistics.fmean(x[i * n:(i + 1) * n]) for i in range(nb)]
    ci = T95.get(nb - 1, 2.0) * statistics.stdev(bm) / nb ** 0.5
    half = (max(bm) - min(bm)) / 2
    return {"mean": statistics.fmean(x[:n * nb]), "ci95": ci, "halfSpread": half,
            "u": max(ci, half), "batchLen": n, "nBatches": nb}


STEP_TOL = 1e-3       # p initial residual at the last outer iteration of a converged time step
CO_LIMIT = 1.0        # max Courant number that scale-resolving runs (DES/LES) should stay under


def transient_verdict(out, steps, window):
    """Verdict for a transient run, from three separate questions:
    - are the forces statistically stationary (mean drift < 2 % between the last two windows)?
    - did each time step converge (p below STEP_TOL by the last PIMPLE outer iteration)?
    - is the time step sane (max Courant <= CO_LIMIT, fields not being bounded)?
    Oscillating forces are expected in a transient run and do not count against it."""
    last = steps[-window:]
    if last:
        n = len(last)
        ok = [s for s in last if s["last"] is not None and s["last"] <= STEP_TOL]
        drops = sorted(s["last"] / s["first"] for s in last if s["first"] and s["last"] is not None)
        co = [s["coMax"] for s in last if s["coMax"] is not None]
        bounded = [s for s in last if s["bounded"]]
        out["steps"] = {
            "n": n, "outerIterations": max(s["outer"] for s in last),
            "converged": len(ok) / n,
            "medianLastOuterP": statistics.median([s["last"] for s in last if s["last"] is not None] or [0]),
            "medianOuterDrop": drops[len(drops) // 2] if drops else None,
            "maxCourant": max(co) if co else None,
            "medianMaxCourant": statistics.median(co) if co else None,
            "aboveCourantLimit": sum(c > CO_LIMIT for c in co) / len(co) if co else None,
            "bounded": len(bounded) / n,
            "boundedFields": sorted({f for s in bounded for f in s["bounded"]})}
    f = out.get("forces", {})
    drift = max((v["drift"] for v in f.values()), default=None)
    flags = []
    st = out.get("steps")
    if st:
        if st["converged"] < 0.9:
            flags.append(f"time steps not converged: only {st['converged']:.0%} reach p < {STEP_TOL:g} "
                         f"by outer iteration {st['outerIterations']} (median {st['medianLastOuterP']:.2g}); "
                         "add outer correctors or a smaller time step")
        if st["aboveCourantLimit"]:
            flags.append(f"max Courant {st['maxCourant']:.3g} (above {CO_LIMIT:g} in "
                         f"{st['aboveCourantLimit']:.0%} of steps); a scale-resolving run needs it <= {CO_LIMIT:g}")
        if st["bounded"] > 0.05:
            flags.append(f"{', '.join(st['boundedFields'])} bounded in {st['bounded']:.0%} of steps")
    else:
        flags.append("no per-step data in the log (pass --log)")
    out["flags"] = flags
    if drift is None:
        out["verdict"] = "too short"
    elif drift >= 0.02:
        out["verdict"] = ("still developing (force means still drifting; average later)"
                          + ("; also check: " + "; ".join(flags) if flags else ""))
    elif flags:
        out["verdict"] = "statistically stationary, but check: " + "; ".join(flags)
    else:
        out["verdict"] = "converged (statistically stationary, every time step converged)"
    return out


def upto(table, t_max):
    """The rows of a {"Time": [...], column: [...]} table with Time <= t_max."""
    t = table.get("Time") or []
    n = bisect.bisect_right(t, t_max)
    return {k: v[:n] if isinstance(v, list) else v for k, v in table.items()}


def auto_window(n):
    """The judge window for a run of n iterations: half of it, 10 to 200."""
    return max(10, min(200, n // 2))


def judge(case, window=200, group=None, avg_from=None, logs=None, to=None):
    """Convergence verdict + averaged forces.  Groups and directions come from
    the case (caseinfo.describe); `group` defaults to the group with the
    largest drag, normally the whole model.  `window` counts iterations, or
    time steps for a transient case, which gets its own verdict (see
    transient_verdict); None picks one from the run's length (auto_window).
    `to` judges the run as it was at that iteration (or time): residuals and
    forces after it are left out, so two runs can be judged over the same
    iterations.  `logs`: solver logs, default log.foamRun*."""
    res, frc = parse_residuals(case, logs), parse_forces(case)
    if to is not None:
        res, frc = upto(res, to), {g: upto(F, to) for g, F in frc.items()}
    if window is None:
        window = auto_window(len(res.get("Time") or []))
    unsteady = caseinfo.transient(case)
    d = caseinfo.describe(case, frc)
    group = group or d["total"]
    vert = d["vertical"]
    out = {"schemaVersion": schema.VERSIONS["judge"], "transient": unsteady, "window": window, "group": group,
           "axes": {"flow": ("-" if d["flowSign"] < 0 else "+") + "xyz"[d["flowAxis"]],
                    "up": "xyz"[d["upAxis"]], "vertical": vert, "source": d["source"]}}
    if to is not None:
        out["to"] = to
    # averaged forces with uncertainty over [avg_from, end] (default: last 2 windows):
    # main group's vertical force and drag, then every other group's vertical force
    avg = {}
    wanted = [(group, "vertical", vert), (group, "drag", "drag")] + \
             [(g, "vertical", f"{g} {vert}") for g in d["groups"] if g != group]
    for g, what, name in wanted:
        s = caseinfo.series(frc, d, g, what)
        if not s:
            continue
        if avg_from is not None:
            t0 = avg_from
        elif unsteady:                     # last 2 windows of time steps (t > t0), in seconds
            t0 = s[max(0, len(s) - 2 * window - 1)][0]
        else:
            t0 = s[-1][0] - 2 * window
        bm = batch_means([v for t, v in s if t > t0])
        if bm:
            bm["from"], bm["to"] = t0, s[-1][0]
            avg[name] = bm
    out["average"] = avg
    t = res.get("Time", [])
    if len(t) < 2 * window:
        out["verdict"] = "too short"
        return out
    wins = []
    for k in ("p", "Ux", "Uy", "Uz", "k", "omega"):
        v = res.get(k)
        if v:
            last, prev = stats(v[-window:]), stats(v[-2 * window:-window])
            out.setdefault("residuals", {})[k] = {"median": last["median"],
                                                  "trend": last["median"] / max(prev["median"], 1e-30)}
    for what in ("drag", "vertical"):
        v = [x for _, x in caseinfo.series(frc, d, group, what)]
        if len(v) >= 2 * window:
            last, prev = stats(v[-window:]), stats(v[-2 * window:-window])
            m = abs(last["mean"]) or 1e-30
            out.setdefault("forces", {})[what] = {"mean": last["mean"], "std": last["std"],
                                                  "osc": last["std"] / m,
                                                  "drift": abs(last["mean"] - prev["mean"]) / m}
    # running residual medians in blocks, for the trend plot
    blk = max(10, window // 5)
    out["pBlocks"] = [[t[i], statistics.median([x for x in res["p"][i:i + blk] if x is not None])]
                      for i in range(0, len(t) - blk + 1, blk)] if res.get("p") else []
    if unsteady:
        return transient_verdict(out, caseinfo.step_stats(logs or caseinfo.solver_logs(case)), window)
    r, f = out.get("residuals", {}), out.get("forces", {})
    pm, ptr = r.get("p", {}).get("median", 1), r.get("p", {}).get("trend", 1)
    drift = max((v["drift"] for v in f.values()), default=1)
    osc = max((v["osc"] for v in f.values()), default=1)
    if pm < 1e-4 and drift < 0.005 and osc < 0.005:
        out["verdict"] = "converged"
    elif drift < 0.01 and osc < 0.02:
        out["verdict"] = "statistically steady (forces stationary; use window means)"
    elif ptr < 0.9:
        out["verdict"] = "still converging"
    else:
        out["verdict"] = "not converged (plateau/oscillation)"
    return out


def latest_time(case):
    ts = []
    for t in os.listdir(os.path.join(case, "processor0")):
        try:
            ts.append(float(t))
        except ValueError:
            pass
    m = max(ts)
    return str(int(m)) if m == int(m) else str(m)


def end_write_interval(start, end):
    """OpenFOAM writes when iteration % writeInterval == 0, and does not write
    the end time otherwise: pick the largest divisor of end that still gives an
    intermediate write (so a later restart starts from end, not from the last
    multiple of 200).  Few writes: a large case write can be over 1 GB."""
    for d in range(max(1, end - start), 0, -1):
        if end % d == 0:
            return d
    return 1


def extend(top, end_iter, nproc=None, variant=None):
    """Continue the second run of an A/B to end_iter (optionally switching to
    another solver preset first), then judge convergence."""
    result = schema.read(os.path.join(top, "ab_result.json"), "abtest")
    case = os.path.join(top, "fixed")
    nproc = nproc or result["nProcs"]
    t0 = latest_time(case)
    status(top, step=f"extending fixed {t0} -> {end_iter}" + (f" with {variant}" if variant else ""), case=case)
    runs = apply_settings(case, PRESETS[variant]) if variant else []
    for k, v in (("startFrom", "latestTime"), ("endTime", str(end_iter)),
                 ("writeInterval", str(end_write_interval(int(float(t0)), end_iter))),
                 ("purgeWrite", "0"), ("stopAt", "endTime")):
        runs.append(sh(f"foamDictionary system/controlDict -entry {k} -set {v}",
                       os.path.join(case, f"log.dict_ext_{k}"), case))
    runs.append(sh(f"nice -n 5 mpirun --oversubscribe -np {nproc} foamRun -parallel",
                   os.path.join(case, f"log.foamRun_ext_{end_iter}"), case))
    result.setdefault("extensions", []).append({"from": t0, "to": end_iter, "variant": variant,
                                                "variantSettings": PRESETS.get(variant), "runs": runs})
    # average over the whole stretch run with these settings (back-to-back
    # extensions with the same preset), skipping 50 iterations after the switch
    first = float(t0)
    for e in reversed(result.get("extensions", [])[:-1]):
        if e.get("variant") != variant:
            break
        first = float(e["from"])
    result["fixedJudge"] = judge(case, window=min(200, max(40, (end_iter - int(float(t0))) // 2)),
                                 avg_from=first + 50)
    result["fixedFull"] = {"residualHistory": summarise(case, 200)["residualHistory"]}
    schema.write(os.path.join(top, "ab_result.json"), result, indent=1)
    status(top, step="done")
    return result


def _topology(poly):
    """(nPoints, nCells, nFaces, nInternalFaces) from the owner header, or None."""
    for name in ("owner", "owner.gz"):
        path = os.path.join(poly, name)
        if os.path.isfile(path):
            opener = gzip.open if name.endswith(".gz") else open
            with opener(path, "rb") as f:
                head = f.read(4096).decode("latin-1")
            m = re.search(r"nPoints:\s*(\d+)\s+nCells:\s*(\d+)\s+nFaces:\s*(\d+)\s+nInternalFaces:\s*(\d+)", head)
            return m.groups() if m else None
    return None


def main(a):
    if len(a) < 2:
        print(__doc__); return
    if a[0] == "judge":
        # judge <case> [window|auto] [avgFrom] [--log <file or glob>] [--to <iteration or time>]
        logs = to = None
        if "--log" in a:
            i = a.index("--log")
            case_dir = os.path.abspath(os.path.expanduser(a[1]))
            logs = caseinfo.solver_logs(case_dir, (a[i + 1],))
            if not logs:
                sys.exit(f"no log matches {a[i + 1]} in {case_dir}")
            a = a[:i] + a[i + 2:]
        if "--to" in a:
            i = a.index("--to")
            to = float(a[i + 1])
            a = a[:i] + a[i + 2:]
        window = None if len(a) > 2 and a[2] == "auto" else int(a[2]) if len(a) > 2 else 200
        print(json.dumps(judge(os.path.abspath(os.path.expanduser(a[1])), window,
                               avg_from=float(a[3]) if len(a) > 3 else None, logs=logs, to=to), indent=1))
        return
    if a[0] == "extend":
        # abtest.py extend <abDir or the repaired run's name> <endIter>
        v = a[a.index("--variant") + 1] if "--variant" in a else None
        if v and v not in PRESETS:
            sys.exit("unknown variant " + v)
        top = ab_dir(a[1])
        end = extend_to(top, a[1], a[2] if len(a) > 2 else "")
        if "--no-ram-check" not in a:
            ok, msg = ramguard.check(os.path.join(top, "fixed"), "solve")
            print(msg, flush=True)
            if not ok:
                sys.exit(4)
        r = extend(top, end, variant=v)
        print(json.dumps({k: v for k, v in r["fixedJudge"].items() if k != "pBlocks"}, indent=1))
        return
    if a[0] == "hotspots":
        r = hot_both(ab_dir(a[1]))
        print(json.dumps({t: r.get(t + "Hotspots", {}).get("summary") for t in ("base", "fixed")}, indent=1))
        return
    if a[0] == "mode":
        # abtest.py mode <case> <from> <to> [--np 6] [--defects <meshDoctor case name>]
        opt = lambda k, d: a[a.index(k) + 1] if k in a else d
        case = os.path.abspath(os.path.expanduser(a[1]))
        db, _ = defects_of(opt("--defects", "")) if "--defects" in a else ([], [])
        h = hotspot_map(case, a[2], a[3], int(opt("--np", 6)), db, out=f"mode_{a[2]}_{a[3]}.json")
        print(json.dumps({"summary": h["summary"], "nearDefects": h["shareOfTopChangeNearMeshDefects"],
                          "top": [{k: c[k] for k in ("nCells", "sumScore2", "centroid", "maxNonOrtho")}
                                  for c in h["clusters"][:10]]}, indent=1))
        return
    if a[0] == "resummarise":
        top = os.path.abspath(os.path.expanduser(a[1]))
        r = schema.read(os.path.join(top, "ab_result.json"), "abtest")
        for t in ("base", "fixed"):
            if os.path.isdir(os.path.join(top, t, "postProcessing")):
                r[t] = summarise(os.path.join(top, t), r["window"])
        schema.write(os.path.join(top, "ab_result.json"), r, indent=1)
        return
    import repair                              # plain_name, source_case + fingerprint (same folder)
    src = repair.source_case(a[0])
    fixed_name = a[1]
    if "--no-ram-check" not in a:
        ok, msg = ramguard.check(src, "solve")
        print(msg, flush=True)
        if not ok:
            sys.exit(4)
    if fixed_name != "-":
        repair.plain_name(fixed_name, "repaired run name")
    opt = lambda k, d: a[a.index(k) + 1] if k in a else d
    iters, nproc = int(opt("--iters", 200)), int(opt("--np", 6))
    init = start_fields(src, opt("--init", None))
    variant = opt("--variant", None)
    if variant and variant not in PRESETS:
        sys.exit("unknown variant " + variant)
    if fixed_name == "-":
        fixed_pts = None                       # solver variant on the original mesh
        if not variant:
            sys.exit("'-' (original mesh) needs --variant")
    else:
        fixed_pts = os.path.join(ROOT, fixed_name, "constant/polyMesh/points")
        if not os.path.isfile(fixed_pts):
            sys.exit("no repaired points for " + fixed_name)
        same = _topology(os.path.join(src, "constant/polyMesh")) == _topology(os.path.dirname(fixed_pts))
        if not same:
            sys.exit(f"{fixed_name} has a different mesh topology from {src} (the repair collapsed "
                     "faces, or the copy is of another mesh). The A/B test only compares moved "
                     "points; compare the two cases with separate runs instead.")
    label = opt("--label", fixed_name if not variant else f"{os.path.basename(src)}_{variant}")
    repair.plain_name(label, "label")      # <label>_ab/base and /fixed get deleted and re-made
    fp0 = repair.source_fingerprint(src)   # proves at the end that the source was only read
    top = os.path.join(ROOT, label + "_ab")
    os.makedirs(top, exist_ok=True)
    window = max(20, iters // 4)
    result = {"schemaVersion": schema.VERSIONS["abtest"], "source": src, "fixedName": None if fixed_name == "-" else fixed_name,
              "variant": variant, "variantSettings": PRESETS.get(variant), "label": label,
              "iters": iters, "nProcs": nproc,
              "init": init, "window": window, "started": time.strftime("%Y-%m-%d %H:%M:%S")}
    base_from = opt("--base-from", None)
    if base_from:
        # reuse an earlier original-mesh run with identical settings
        base_from = os.path.abspath(os.path.expanduser(base_from))
        prev = schema.read(os.path.join(base_from, "ab_result.json"), "abtest")
        if (prev.get("source"), prev.get("iters"), prev.get("init"), prev.get("nProcs")) != (src, iters, init, nproc):
            sys.exit("--base-from run used different settings")
        for k in ("base", "baseRuns", "baseHotspots"):
            if k in prev:
                result[k] = prev[k]
        result["baseReusedFrom"] = base_from
        dst = os.path.join(top, "base")
        if os.path.exists(dst):
            shutil.rmtree(dst)
        os.makedirs(os.path.join(dst, "meshDoctor"))
        shutil.copytree(os.path.join(base_from, "base", "postProcessing"), os.path.join(dst, "postProcessing"))
        hj = os.path.join(base_from, "base", "meshDoctor", "hotspots.json")
        if os.path.isfile(hj):
            shutil.copy2(hj, os.path.join(dst, "meshDoctor", "hotspots.json"))
    for tag, pts in (("base", None), ("fixed", fixed_pts)):
        if tag == "base" and base_from:
            continue
        case = os.path.join(top, tag)
        status(top, step=f"copying {tag}")
        make_case(src, case, init, pts)
        if tag == "fixed" and variant:
            result["variantRuns"] = apply_settings(case, PRESETS[variant])
        status(top, step=f"solving {tag}", case=case)
        result[tag + "Runs"] = run_one(case, iters, nproc)
        result[tag] = summarise(case, window)
        schema.write(os.path.join(top, "ab_result.json"), result, indent=1)
    # verdict: lower plateau residuals and smaller force oscillation = better
    cmp = {}
    for k, b in result["base"]["residuals"].items():
        f = result["fixed"]["residuals"].get(k)
        if b and f and b["median"]:
            cmp[k] = f["median"] / b["median"]
    result["residualRatioFixedOverBase"] = cmp
    result["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    result["sourceCheck"] = repair.source_check(fp0, src)
    schema.write(os.path.join(top, "ab_result.json"), result, indent=1)
    if "--no-hotspots" not in a:
        hot_both(top)
    if "--extend" in a:
        extend(top, int(opt("--extend", 0)), nproc)
    if not result["sourceCheck"]["unchanged"]:
        status(top, step="done, but the SOURCE CASE CHANGED during the run")
        sys.exit(3)
    status(top, step="done")
    print(json.dumps(cmp, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
