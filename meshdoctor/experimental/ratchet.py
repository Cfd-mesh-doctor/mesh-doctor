#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Skill A1: non-orthogonality ratchet (runs in WSL, stdlib only).

foamMeshDoctor stops improving a face once it meets its target (65 deg by
default), so max non-ortho lands at ~64.99.  This driver keeps lowering the
non-ortho target just below the current worst face and re-runs the repair,
pass after pass, until a pass no longer lowers the maximum.  foamMeshDoctor's
own rules guarantee no face metric gets worse than its limit in any pass, and
the final checkMesh is compared with the original.

    python3 ratchet.py <srcCase> <name> [--step 3] [--min-step 0.25]
                       [--passes 15] [--floor 30] [--no-walls]

Works on a copy in <workspace>/<name> (config.py); the source is only read.
Writes <copy>/meshDoctor/ratchet.json.
"""
import json, os, re, shutil, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import repair as md  # read-only reuse of the existing driver helpers


def backup(case, tag):
    n = 0
    for base in [case] + [os.path.join(case, d) for d in os.listdir(case)
                          if re.fullmatch(r"processor\d+", d)]:
        p = os.path.join(base, "constant/polyMesh/points")
        if os.path.isfile(p):
            shutil.copy2(p, p + "." + tag)
            n += 1
    return n


def restore(case, tag):
    for base in [case] + [os.path.join(case, d) for d in os.listdir(case)
                          if re.fullmatch(r"processor\d+", d)]:
        p = os.path.join(base, "constant/polyMesh/points")
        if os.path.isfile(p + "." + tag):
            shutil.copy2(p + "." + tag, p)


def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    src, name = argv[0], argv[1]
    opt = {"step": 3.0, "min-step": 0.25, "passes": 15, "floor": 30.0}
    walls = True
    i = 2
    while i < len(argv):
        a = argv[i]
        if a == "--no-walls":
            walls = False; i += 1; continue
        opt[a.lstrip("-")] = float(argv[i + 1]); i += 2

    case = md.copy_case(src, name)
    mdir = os.path.join(case, "meshDoctor")
    lay = md.layout(case)
    extra = "-slideFlat -slideCurved -slideEdges" if walls else "-slideFlat"
    t = dict(md.PROFILES["openfoam"])
    t0 = time.time()

    r, cb = md.checkmesh(case, lay, "before")
    backup(case, "original")
    cur = cb.get("maxNonOrtho")
    print(f"start: max non-ortho {cur:.3f}  ({lay})", flush=True)
    step = opt["step"]
    passes = []
    k = 0
    while k < int(opt["passes"]) and step >= opt["min-step"]:
        k += 1
        target = max(opt["floor"], min(md.PROFILES["openfoam"]["nonOrthTarget"], cur - step))
        t["nonOrthTarget"] = round(target, 3)
        backup(case, "pass")
        log = os.path.join(mdir, f"log.ratchet{k}")
        r = md.sh(md.par(lay, f"foamMeshDoctor -fix -tagBefore r{k}b -tagAfter r{k}a "
                              f"{md.doctor_args(t, extra)}"), log, case)
        s = md.parse_summary(os.path.join(mdir, f"summary_r{k}a.txt"))
        new = s.get("maxNonOrtho")
        ok = r["exit"] == 0 and new is not None and new < cur - 0.02
        passes.append({"pass": k, "target": target, "maxBefore": cur, "maxAfter": new,
                       "accepted": ok, "seconds": r["seconds"], "exit": r["exit"],
                       "facesAboveTarget": s.get("nFacesAboveTarget")})
        print(f"pass {k}: target {target:.2f}  max {cur:.3f} -> {new}  "
              f"{'kept' if ok else 'no gain'}  ({r['seconds']} s)", flush=True)
        if ok:
            cur = new
        else:
            restore(case, "pass")
            step /= 2

    r, ca = md.checkmesh(case, lay, "ratchet")
    v = md.verdict(cb, ca)
    res = {"source": src, "case": case, "layout": lay, "options": opt, "walls": walls,
           "checkMeshBefore": cb, "checkMeshAfter": ca, "verdict": v,
           "passes": passes, "seconds": round(time.time() - t0, 1)}
    if v["regressions"]:
        res["note"] = "checkMesh regressions present: review before using this mesh"
    json.dump(res, open(os.path.join(mdir, "ratchet.json"), "w"), indent=1)
    print(json.dumps({"maxNonOrtho": [cb.get("maxNonOrtho"), ca.get("maxNonOrtho")],
                      "verdict": v, "seconds": res["seconds"]}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
