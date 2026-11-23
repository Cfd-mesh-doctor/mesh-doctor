#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Skills A2/A3: gradient cluster polish of the worst non-orthogonal faces.

    python3 -m meshdoctor experimental polish <srcCase> <name> [--fix] [--faces 200]
        [--sweeps 10] [--steps 20] [--rings 1] [--maxpts 80] [--tau 1] [--tet-cap 4]
        [--disp 1] [--no-walls]

--tet-cap F lets face-tet decomposition failures (checkMesh "bad tets") grow up
to F x the starting count, and cells may turn concave as long as the total
concave count never rises (user decision 2026-11-11). --tet-cap 1 = strict.

Copies <srcCase> to <workspace>/<name> (source only read; see config.py), runs
checkMesh, foamMeshPolish -polish (optionally after the greedy -fix), checkMesh
again, and rolls the points back if checkMesh shows any regression other
than bad tets within the budget.
Writes <copy>/meshDoctor/polish.json.
"""
import json, os, re, shutil, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import repair as md  # read-only reuse of the existing driver helpers
import prog


def point_files(case):
    out = []
    for base in [case] + [os.path.join(case, d) for d in os.listdir(case)
                          if re.fullmatch(r"processor\d+", d)]:
        p = os.path.join(base, "constant/polyMesh/points")
        if os.path.isfile(p):
            out.append(p)
    return out


def main(argv):
    if len(argv) < 2:
        sys.exit(prog.text(__doc__))
    src, name = argv[0], argv[1]
    o = {"faces": 200, "sweeps": 10, "steps": 20, "rings": 1, "maxpts": 80, "tau": 1.0, "tet-cap": 4.0, "disp": 1.0}
    greedy, walls = False, True
    i = 2
    while i < len(argv):
        a = argv[i]
        if a == "--fix": greedy = True; i += 1; continue
        if a == "--no-walls": walls = False; i += 1; continue
        o[a.lstrip("-")] = float(argv[i + 1]); i += 2

    case = md.copy_case(src, name)
    mdir = os.path.join(case, "meshDoctor")
    lay = md.layout(case)
    t = dict(md.PROFILES["openfoam"])
    extra = "-slideFlat -slideCurved -slideEdges" if walls else "-slideFlat"
    t0 = time.time()

    r, cb = md.checkmesh(case, lay, "before")
    for p in point_files(case):
        shutil.copy2(p, p + ".beforePolish")
    print(f"start: max non-ortho {cb.get('maxNonOrtho')}  ({lay})", flush=True)

    cmd = ("foamMeshPolish " + ("-fix " if greedy else "") + "-polish "
           f"-polishFaces {int(o['faces'])} -polishSweeps {int(o['sweeps'])} "
           f"-polishSteps {int(o['steps'])} -polishRings {int(o['rings'])} "
           f"-polishMaxPts {int(o['maxpts'])} -polishTau {o['tau']} -maxDispFrac {o['disp']} "
           + (f"-polishTetCap {o['tet-cap']} -polishNetConcave " if o["tet-cap"] > 1 else "") +
           f"-tagBefore pol_b -tagAfter pol_a {md.doctor_args(t, extra)}")
    run = md.sh(md.par(lay, cmd), os.path.join(mdir, "log.polish"), case)
    log = md.read_log(os.path.join(mdir, "log.polish"))
    for l in log.splitlines():
        if "polish sweep" in l or "Polish:" in l or "sweep " in l:
            print(l.strip(), flush=True)

    r, ca = md.checkmesh(case, lay, "polish")
    v = md.verdict(cb, ca)
    regs = list(v["regressions"])
    budget = None
    if o["tet-cap"] > 1 and "nBadTets" in regs:
        b0, b1 = cb.get("nBadTets", 0), ca.get("nBadTets", 0)
        budget = {"before": b0, "after": b1, "cap": o["tet-cap"] * max(b0, 1) + 1}
        if b1 <= budget["cap"]:
            regs.remove("nBadTets")
    rolled = False
    if run["exit"] != 0 or regs:
        for p in point_files(case):
            shutil.copy2(p + ".beforePolish", p)
        rolled = True
    res = {"source": src, "case": case, "layout": lay, "options": o, "greedyFirst": greedy,
           "walls": walls, "exit": run["exit"], "checkMeshBefore": cb, "checkMeshAfter": ca,
           "verdict": v, "badTetBudget": budget, "blockingRegressions": regs, "rolledBack": rolled,
           "maxDisplacement_m": re.findall(r"Max point displacement ([\d.eE+-]+)", log),
           "wallDeviation_m": re.findall(r"original wall ([\d.eE+-]+)", log),
           "seconds": round(time.time() - t0, 1)}
    with open(os.path.join(mdir, "polish.json"), "w") as f:
        json.dump(res, f, indent=1)
    print(json.dumps({"maxNonOrtho": [cb.get("maxNonOrtho"), ca.get("maxNonOrtho")],
                      "regressions": v["regressions"], "blocking": regs, "badTets": budget, "improved": v["improved"],
                      "rolledBack": rolled, "seconds": res["seconds"],
                      "maxDisp": res["maxDisplacement_m"], "wallDev": res["wallDeviation_m"]}))


if __name__ == "__main__":
    main(sys.argv[1:])
