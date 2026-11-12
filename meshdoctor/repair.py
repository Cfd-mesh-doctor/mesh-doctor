#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Mesh Doctor repair driver (Linux or WSL, system python3, standard library only).

    python3 -m meshdoctor copy    <srcCase> <name>        # isolated test copy
    python3 -m meshdoctor inspect <case>                  # detect + highlight
    python3 -m meshdoctor fix     <case> [--profile P]    # correct in-mesh
    python3 -m meshdoctor full    <srcCase> <name> [--profile P]
                                   # copy -> checkMesh -> fix -> checkMesh -> report

Copies live in <workspace>/<name> (see config.py); the source case is only
ever read, and a checksum taken before and after proves it.  Every step writes
a log and the final result.json records commands, versions, before/after
numbers and verdicts.
"""
import hashlib, json, math, os, re, shutil, subprocess, sys, time

import config
import ramguard
import schema

HOME = os.path.expanduser("~")
_S = config.settings()
ROOT = _S["workspace"]                 # where copies are made (config.py)
BASHRC = _S["bashrc"]                  # OpenFOAM environment (config.py)

# Target profiles.  "openfoam" = OpenFOAM/snappy default limits;
# "strict" pushes toward a cleaner-than-default mesh.
PROFILES = {
    "openfoam": dict(nonOrthTarget=65, skewTarget=4, bSkewTarget=4,
                     weightTarget=0.05, volRatioTarget=0.01),
    "strict":   dict(nonOrthTarget=60, skewTarget=3, bSkewTarget=4,
                     weightTarget=0.1, volRatioTarget=0.05),
}


# --------------------------------------------------------------------------
def sh(cmd, log, cwd):
    """Run a command with the OpenFOAM environment, logging to file."""
    full = f"source {BASHRC} >/dev/null 2>&1; {cmd}"
    t0 = time.time()
    with open(log, "w") as f:
        r = subprocess.run(["bash", "-c", full], cwd=cwd, stdout=f,
                           stderr=subprocess.STDOUT)
    return {"cmd": cmd, "log": os.path.basename(log), "exit": r.returncode,
            "seconds": round(time.time() - t0, 1)}


def status(case, step, **kw):
    s = {"step": step, "time": time.strftime("%Y-%m-%d %H:%M:%S"), **kw}
    with open(os.path.join(case, "meshDoctor", "status.json"), "w") as f:
        json.dump(s, f)


def owner_note(poly):
    try:
        with open(os.path.join(poly, "owner"), "rb") as f:
            head = f.read(2000).decode("latin-1")
        m = re.search(r"nCells:\s*(\d+)", head)
        return int(m.group(1)) if m else None
    except OSError:
        return None


def layout(case):
    """Decide serial vs parallel: use processor dirs if the root mesh is
    missing or stale (e.g. root = blockMesh, processors = snappy)."""
    procs = sorted(d for d in os.listdir(case)
                   if re.fullmatch(r"processor\d+", d)
                   and os.path.isfile(os.path.join(case, d, "constant/polyMesh/owner")))
    root = owner_note(os.path.join(case, "constant/polyMesh"))
    psum = sum(owner_note(os.path.join(case, p, "constant/polyMesh")) or 0 for p in procs)
    if procs and (root is None or root != psum):
        return {"parallel": True, "nProcs": len(procs), "nCells": psum,
                "rootCells": root}
    return {"parallel": False, "nProcs": 1, "nCells": root, "rootCells": root}


def par(lay, cmd):
    if lay["parallel"]:
        return f"mpirun --oversubscribe -np {lay['nProcs']} {cmd} -parallel"
    return cmd


# --------------------------------------------------------------------------
def plain_name(name, what="copy name"):
    """Folders under ROOT are deleted and re-made, so their names must be plain
    folder names: never ".", "..", a path, or anything that leaves ROOT."""
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}", name or ""):
        sys.exit(f"refusing: {what} must be a plain folder name (letters, digits, _ . -)")
    return name


def source_fingerprint(src):
    """SHA-256 of the source case's mesh and setup: constant/, system/ and
    processor*/constant/polyMesh. Taken before and after every run, it proves
    the run never wrote to the original case (~4 s for an 11M-cell, 1.3 GB mesh)."""
    h, nbytes, nfiles = hashlib.sha256(), 0, 0
    roots = [os.path.join(src, "constant"), os.path.join(src, "system")] + sorted(
        os.path.join(src, d, "constant", "polyMesh") for d in os.listdir(src)
        if re.fullmatch(r"processor\d+", d))
    for r in roots:
        for dirpath, dirs, files in os.walk(r):
            dirs.sort()
            for f in sorted(files):
                p = os.path.join(dirpath, f)
                if os.path.islink(p) or not os.path.isfile(p):
                    continue
                h.update(os.path.relpath(p, src).encode() + b"\0")
                with open(p, "rb") as fh:
                    for chunk in iter(lambda: fh.read(1 << 22), b""):
                        h.update(chunk)
                nbytes += os.path.getsize(p); nfiles += 1
    return {"sha256": h.hexdigest(), "files": nfiles, "bytes": nbytes,
            "time": time.strftime("%Y-%m-%d %H:%M:%S")}


def source_check(before, src):
    """Compare a fingerprint taken at the start with one taken now."""
    after = source_fingerprint(src)
    ok = before["sha256"] == after["sha256"]
    if not ok:
        print("!" * 72 + "\nSOURCE CASE CHANGED DURING THIS RUN: " + src +
              "\nMesh Doctor only reads it; check what else edited it (constant/, system/ or"
              " processor*/constant/polyMesh).\n" + "!" * 72, file=sys.stderr, flush=True)
    return {"unchanged": ok, "before": before, "after": after}


def copy_case(src, name):
    src = os.path.abspath(os.path.expanduser(src))
    plain_name(name)
    dst = os.path.join(ROOT, name)
    if os.path.dirname(os.path.realpath(dst)) != os.path.realpath(ROOT):
        sys.exit("refusing: copy must be a folder directly inside " + ROOT)
    if os.path.realpath(dst).startswith(os.path.realpath(src) + os.sep) or \
       os.path.realpath(dst) == os.path.realpath(src):
        sys.exit("refusing: destination inside source")
    if os.path.exists(dst):
        shutil.rmtree(dst)
    os.makedirs(dst)
    for d in ("system", "constant"):
        s = os.path.join(src, d)
        if os.path.isdir(s):
            shutil.copytree(s, os.path.join(dst, d), symlinks=True)
    for d in os.listdir(src):
        if re.fullmatch(r"processor\d+", d):
            s = os.path.join(src, d, "constant", "polyMesh")
            if os.path.isdir(s):
                shutil.copytree(s, os.path.join(dst, d, "constant", "polyMesh"))
    open(os.path.join(dst, ".meshDoctorCopy"), "w").write(src + "\n")
    os.makedirs(os.path.join(dst, "meshDoctor"), exist_ok=True)
    return dst


# --------------------------------------------------------------------------
def parse_summary(path):
    out = {}
    try:
        for line in open(path):
            k, *v = line.split()
            if not v:
                continue
            if len(v) == 1:
                try:
                    out[k] = float(v[0]) if re.search(r"[.eE]", v[0]) else int(v[0])
                except ValueError:
                    out[k] = v[0]
            else:
                out[k] = [float(x) for x in v]
    except OSError:
        pass
    return out


CM_PATTERNS = {
    "maxNonOrtho": r"non-orthogonality Max:\s*([\d.eE+-]+)",
    "avgNonOrtho": r"non-orthogonality Max:.*average:\s*([\d.eE+-]+)",
    "nSevereNonOrtho": r"severely non-orthogonal.*faces:\s*(\d+)",
    "maxSkewness": r"Max skewness = ([\d.eE+-]+)",
    "nSkew": r"Max skewness = .*?, (\d+) highly skew",
    "nWrongPyramids": r"Error in face pyramids: (\d+)",
    "nBadTets": r"face tets: (\d+)",
    "nSmallDeterminant": r"small determinant .*cells: (\d+)",
    "nConcaveCells": r"Concave cells .*cells: (\d+)",
    "nLowWeight": r"small interpolation weight .*faces: (\d+)",
    "nLowVolRatio": r"small volume ratio .*faces: (\d+)",
    "failedChecks": r"Failed (\d+) mesh checks",
    "minWeight": r"Face interpolation weight : minimum: ([\d.eE+-]+)",
    "minVolRatio": r"Face volume ratio : minimum: ([\d.eE+-]+)",
}


def parse_checkmesh(log):
    try:
        txt = open(log, errors="replace").read()
    except OSError:
        return {}
    out = {}
    for k, pat in CM_PATTERNS.items():
        m = re.search(pat, txt)
        if m:
            v = m.group(1)
            out[k] = float(v) if re.search(r"[.eE]", v) else int(v)
    out["meshOK"] = "Mesh OK" in txt
    out["errors"] = [l.strip() for l in txt.splitlines() if l.strip().startswith("***")]
    for k in ("nSkew", "nWrongPyramids", "nBadTets", "nSmallDeterminant",
              "nConcaveCells", "nLowWeight", "nLowVolRatio", "failedChecks",
              "nSevereNonOrtho"):
        out.setdefault(k, 0)
    return out


# --------------------------------------------------------------------------
def read_lines(case, tag, fname, prefix):
    rows = []
    dirs = [d for d in os.listdir(case) if re.fullmatch(r"processor\d+", d)]
    bases = [(int(d[9:]), os.path.join(case, d)) for d in dirs] or [(0, case)]
    if os.path.isdir(os.path.join(case, "meshDoctor", tag)):
        bases = [(0, case)] + [b for b in bases if b[1] != case]
    for proc, base in bases:
        p = os.path.join(base, "meshDoctor", tag, fname)
        if not os.path.isfile(p):
            continue
        for line in open(p):
            if line.startswith(prefix):
                rows.append((proc, line.split()))
    return rows


def kinds_of(b, t):
    k = []
    if b["minPyrRel"] <= 0:
        k.append("inverted face pyramid")
    elif 50 <= b["badness"] < 100:
        k.append("invalid tet decomposition")
    if b["nonOrtho"] > t["nonOrthTarget"]:
        k.append("non-orthogonal")
    lim = t["skewTarget"] if b["patch"] == "internal" else t["bSkewTarget"]
    if b["skew"] > lim:
        k.append("skewed")
    if b["patch"] == "internal" and b["weight"] < t["weightTarget"]:
        k.append("low interpolation weight")
    if b["patch"] == "internal" and b["volRatio"] < t["volRatioTarget"]:
        k.append("abrupt size change")
    return k or ["above target"]


def severity(k):
    if "inverted face pyramid" in k:
        return 3
    if "invalid tet decomposition" in k:
        return 2
    return 1


def polys(tok, start):
    n = int(tok[start]); xyz = [float(x) for x in tok[start + 1:start + 1 + 3 * n]]
    return xyz


def cluster(case, tag, targets):
    """Group bad faces into problem regions and write viewer geometry."""
    B = []
    for proc, t in read_lines(case, tag, "badFaces.txt", "B "):
        B.append({"proc": proc, "face": int(t[1]), "patch": t[2],
                  "badness": float(t[3]), "nonOrtho": float(t[4]),
                  "skew": float(t[5]), "weight": float(t[6]),
                  "volRatio": float(t[7]), "minPyrRel": float(t[8]),
                  "c": [float(t[9]), float(t[10]), float(t[11])],
                  "h": float(t[12]), "own": int(t[13]), "nei": int(t[14])})
    n = len(B)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i

    if n:
        g = max(1e-9, 3 * sorted(b["h"] for b in B)[n // 2])
        grid = {}
        for i, b in enumerate(B):
            key = tuple(int(math.floor(x / g)) for x in b["c"])
            grid.setdefault(key, []).append(i)
        for i, b in enumerate(B):
            key = tuple(int(math.floor(x / g)) for x in b["c"])
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        for j in grid.get((key[0]+dx, key[1]+dy, key[2]+dz), ()):
                            if j <= i:
                                continue
                            r = 3 * max(b["h"], B[j]["h"])
                            if sum((b["c"][k] - B[j]["c"][k]) ** 2 for k in range(3)) < r * r:
                                parent[find(i)] = find(j)
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    clusters = []
    for idx in groups.values():
        faces = [B[i] for i in idx]
        worst = max(faces, key=lambda b: b["badness"])
        ks = sorted({k for b in faces for k in kinds_of(b, targets)})
        lo = [min(b["c"][k] - 2 * b["h"] for b in faces) for k in range(3)]
        hi = [max(b["c"][k] + 2 * b["h"] for b in faces) for k in range(3)]
        clusters.append({
            "nFaces": len(faces), "kinds": ks, "severity": severity(ks),
            "worst": {k: worst[k] for k in ("proc", "face", "patch", "badness",
                                           "nonOrtho", "skew", "weight",
                                           "volRatio", "minPyrRel", "c")},
            "centroid": [sum(b["c"][k] for b in faces) / len(faces) for k in range(3)],
            "bbox": [lo, hi], "h": worst["h"],
            "patches": sorted({b["patch"] for b in faces if b["patch"] != "internal"}),
            "members": [(b["proc"], b["face"], b["own"], b["nei"]) for b in faces],
        })
    clusters.sort(key=lambda c: (-c["severity"], -c["worst"]["badness"], -c["nFaces"]))
    for i, c in enumerate(clusters):
        c["id"] = i

    # geometry per cluster (cells around bad faces + nearby walls)
    cell2cl = {}
    face2cl = {}
    for c in clusters:
        for proc, f, o, nb in c["members"]:
            face2cl[(proc, f)] = c["id"]
            cell2cl.setdefault((proc, o), c["id"])
            if nb >= 0:
                cell2cl.setdefault((proc, nb), c["id"])
    geo = {c["id"]: {"cells": [], "ctx": []} for c in clusters}
    for proc, t in read_lines(case, tag, "badCells.txt", "F "):
        cid = cell2cl.get((proc, int(t[1])))
        if cid is None:
            continue
        g = geo[cid]
        if len(g["cells"]) < 6000:
            g["cells"].append({"cell": int(t[1]), "face": int(t[2]),
                               "bad": float(t[3]), "hot": (proc, int(t[2])) in face2cl,
                               "xyz": polys(t, 4)})
    boxes = [(c["id"], [c["bbox"][0][k] - 4 * c["h"] for k in range(3)],
              [c["bbox"][1][k] + 4 * c["h"] for k in range(3)]) for c in clusters[:200]]
    for proc, t in read_lines(case, tag, "context.txt", "W "):
        xyz = polys(t, 3)
        m = len(xyz) // 3
        cen = [sum(xyz[3 * i + k] for i in range(m)) / m for k in range(3)]
        for cid, lo, hi in boxes:
            if all(lo[k] <= cen[k] <= hi[k] for k in range(3)):
                if len(geo[cid]["ctx"]) < 8000:
                    geo[cid]["ctx"].append({"patch": t[2], "xyz": xyz})
                break
    gdir = os.path.join(case, "meshDoctor", "clusters_" + tag)
    if os.path.isdir(gdir):
        shutil.rmtree(gdir)
    os.makedirs(gdir)
    for c in clusters:
        c.pop("members")
        with open(os.path.join(gdir, f"{c['id']}.json"), "w") as f:
            json.dump(geo[c["id"]], f, separators=(",", ":"))
    return clusters


# --------------------------------------------------------------------------
def doctor_args(targets, extra=""):
    return " ".join(f"-{k} {v}" for k, v in targets.items()) + " " + extra


def inspect(case, profile="openfoam"):
    case = os.path.abspath(case)
    os.makedirs(os.path.join(case, "meshDoctor"), exist_ok=True)
    lay = layout(case)
    t = PROFILES[profile]
    status(case, "inspect", layout=lay)
    run = sh(par(lay, f"foamMeshDoctor {doctor_args(t)} -tag report"),
             os.path.join(case, "meshDoctor", "log.inspect"), case)
    cl = cluster(case, "report", t)
    rep = {"case": case, "layout": lay, "profile": profile, "targets": t,
           "summary": parse_summary(os.path.join(case, "meshDoctor", "summary_report.txt")),
           "clusters": cl, "runs": [run]}
    json.dump(rep, open(os.path.join(case, "meshDoctor", "report_report.json"), "w"), indent=1)
    status(case, "done", layout=lay)
    return rep


def checkmesh(case, lay, tag):
    log = os.path.join(case, "meshDoctor", f"log.checkMesh_{tag}")
    run = sh(par(lay, "checkMesh -noFunctionObjects -allGeometry -allTopology"), log, case)
    return run, parse_checkmesh(log)


def verdict(cb, ca):
    """Compare checkMesh before/after; 'regressions' must be empty."""
    keys = ["nWrongPyramids", "nBadTets", "nSkew", "nSevereNonOrtho",
            "nSmallDeterminant", "nLowWeight", "nLowVolRatio", "failedChecks",
            "nConcaveCells"]
    better, worse, same = [], [], []
    for k in keys:
        b, a = cb.get(k, 0), ca.get(k, 0)
        (better if a < b else worse if a > b else same).append(k)
    for k, sign in (("maxNonOrtho", 1), ("maxSkewness", 1), ("minWeight", -1),
                    ("minVolRatio", -1)):
        if k in cb and k in ca:
            d = (ca[k] - cb[k]) * sign
            (worse if d > 1e-9 else better if d < -1e-9 else same).append(k)
    return {"improved": better, "regressions": worse, "unchanged": same}


COLLAPSE_DICT = """FoamFile { format ascii; class dictionary; location "system"; object collapseDict; }
// Mesh Doctor: collapse ONLY the faces in faceSet mdCollapse (inverted
// pyramids that point moves cannot fix); no global edge merging.
collapseEdgesCoeffs { minimumEdgeLength 1e-12; maximumMergeAngle 0.001; }
collapseFacesCoeffs
{
    initialFaceLengthFactor 0.5;
    maxCollapseFaceToPointSideLengthCoeff 0.3;
    allowEarlyCollapseToPoint on;
    allowEarlyCollapseCoeff 0.2;
    guardFraction 0.1;
}
// OpenFOAM-14: a 'controlMeshQuality on;' switch hides the coefficients
// (typeOrEmptyDict finds the switch first), so it is left out; Mesh Doctor
// checks the result with checkMesh and rolls back on any regression.
controlMeshQualityCoeffs
{
    maxNonOrtho 65; maxBoundarySkewness 20; maxInternalSkewness 4; maxConcave 80;
    minVol -1e30; minTetQuality -1e30; minArea -1; minTwist -1; minDeterminant -1;
    minFaceWeight -1; minVolRatio -1; minTriangleTwist -1; nSmoothScale 4; errorReduction 0.75;
    edgeReductionFactor 0.5; faceReductionFactor 0.5; maximumSmoothingIterations 2;
    maximumIterations 10; maxPointErrorCount 5;
}
"""


def mesh_bases(case, lay):
    if lay["parallel"]:
        return [os.path.join(case, d) for d in sorted(os.listdir(case))
                if re.fullmatch(r"processor\d+", d)]
    return [case]


def collapse_stage(case, lay, t, extra, cm_prev):
    """Topology repair for faces point moves cannot fix: collapse the
    inverted-pyramid faces (faceSet mdCollapse) with collapseEdges, smooth
    with a second Mesh Doctor pass, keep only if checkMesh does not regress."""
    md = os.path.join(case, "meshDoctor")
    bases = mesh_bases(case, lay)
    for b in bases:
        src = os.path.join(b, "constant/polyMesh")
        bak = src + ".beforeCollapse"
        if os.path.isdir(bak):
            shutil.rmtree(bak)
        shutil.copytree(src, bak)
    with open(os.path.join(case, "system/collapseDict"), "w") as f:
        f.write(COLLAPSE_DICT)
    cd = os.path.join(case, "system/controlDict")
    created = not os.path.isfile(cd)
    if created:                     # OpenFOAM falls back to controlDict.orig
        shutil.copy2(cd + ".orig", cd)
    shutil.copy2(cd, cd + ".mdkeep")
    runs = []
    try:
        # collapseEdges has no -noFunctionObjects: strip them from the copy
        txt = open(cd).read()
        txt = "\n".join(l for l in txt.splitlines() if not l.strip().startswith("#include"))
        open(cd, "w").write(txt + "\n")
        runs.append(sh("foamDictionary system/controlDict -entry functions -remove",
                       os.path.join(md, "log.collapse_dict"), case))
        runs.append(sh(par(lay, "collapseEdges -collapseFaceSet mdCollapse"),
                       os.path.join(md, "log.collapse"), case))
    finally:
        shutil.copy2(cd + ".mdkeep", cd)
        os.remove(cd + ".mdkeep")
        if created:
            os.remove(cd)
    for b in bases:
        w = os.path.join(b, "0", "polyMesh")
        if os.path.isdir(w):
            dst = os.path.join(b, "constant/polyMesh")
            shutil.rmtree(dst)
            shutil.move(w, dst)
            try:
                os.rmdir(os.path.join(b, "0"))
            except OSError:
                pass
    log = open(os.path.join(md, "log.collapse"), errors="replace").read()
    m = re.findall(r"Collapsing (\d+) faces \(to point = (\d+), to edge = (\d+)\)", log)
    nColl = sum(int(x[0]) for x in m)
    ok = runs[-1]["exit"] == 0 and nColl > 0
    cc = {}
    if ok:
        # smooth around the collapsed faces (no-worse rules, fresh limits)
        runs.append(sh(par(lay, f"foamMeshDoctor -fix -tagBefore collapsed {doctor_args(t, extra)}"),
                       os.path.join(md, "log.fix2"), case))
        r, cc = checkmesh(case, lay, "collapse"); runs.append(r)
        v = verdict(cm_prev, cc)
        ok = (r["exit"] == 0 and not v["regressions"]
              and cc.get("nWrongPyramids", 0) < cm_prev.get("nWrongPyramids", 0))
    else:
        v = None
    if not ok:
        for b in bases:
            dst = os.path.join(b, "constant/polyMesh")
            shutil.rmtree(dst)
            shutil.copytree(dst + ".beforeCollapse", dst)
    return {"accepted": ok, "facesCollapsed": nColl, "checkMesh": cc, "verdict": v, "runs": runs}


def fix(case, profile="openfoam", extra="-slideFlat -slideCurved -slideEdges", collapse=True, max_passes=3,
        fp_before=None):
    case = os.path.abspath(case)
    if not os.path.isfile(os.path.join(case, ".meshDoctorCopy")):
        sys.exit("refusing: not a Mesh Doctor copy")
    src = open(os.path.join(case, ".meshDoctorCopy")).read().strip()
    if fp_before is None and os.path.isdir(src):
        status(case, "fingerprinting the source case (read only)")
        fp_before = source_fingerprint(src)
    md = os.path.join(case, "meshDoctor")
    os.makedirs(md, exist_ok=True)
    lay = layout(case)
    t = PROFILES[profile]
    runs = []
    status(case, "checkMesh (before)", layout=lay)
    r, cb = checkmesh(case, lay, "before"); runs.append(r)

    # back up points of every mesh being changed
    for base in [case] + [os.path.join(case, d) for d in os.listdir(case)
                          if re.fullmatch(r"processor\d+", d)]:
        pts = os.path.join(base, "constant/polyMesh/points")
        if os.path.isfile(pts) and not os.path.isfile(pts + ".beforeFix"):
            shutil.copy2(pts, pts + ".beforeFix")

    status(case, "correcting (foamMeshDoctor -fix)", layout=lay)
    r = sh(par(lay, f"foamMeshDoctor -fix -writeCollapseSet {doctor_args(t, extra)}"),
           os.path.join(md, "log.fix"), case); runs.append(r)
    sweeps = [l.strip() for l in open(os.path.join(md, "log.fix"), errors="replace")
              if l.strip().startswith("sweep")]
    disp = re.findall(r"Max point displacement ([\d.eE+-]+)",
                      open(os.path.join(md, "log.fix"), errors="replace").read())

    # More passes while they still help: each pass starts from the current
    # mesh with fresh no-worse limits, so it can never undo the last one.
    prev = parse_summary(os.path.join(md, "summary_after.txt")).get("nFacesAboveTarget", 0)
    npass = 1
    for k in range(2, max_passes + 1):
        if not prev:
            break
        status(case, f"correcting, pass {k}", layout=lay)
        log = os.path.join(md, f"log.fix{k}")
        r = sh(par(lay, f"foamMeshDoctor -fix -writeCollapseSet -tagBefore pass{k} {doctor_args(t, extra)}"),
               log, case); runs.append(r)
        if r["exit"] != 0:
            break
        npass = k
        txt = open(log, errors="replace").read()
        sweeps += [f"pass {k}: " + l.strip() for l in txt.splitlines() if l.strip().startswith("sweep")]
        disp += re.findall(r"Max point displacement ([\d.eE+-]+)", txt)
        now = parse_summary(os.path.join(md, "summary_after.txt")).get("nFacesAboveTarget", 0)
        if now > 0.98 * prev:
            break
        prev = now

    status(case, "checkMesh (after)", layout=lay)
    r, ca = checkmesh(case, lay, "after"); runs.append(r)

    coll = None
    if collapse and ca.get("nWrongPyramids", 0) > 0:
        status(case, "collapsing faces point moves cannot fix (collapseEdges)", layout=lay)
        coll = collapse_stage(case, lay, t, extra, ca)
        runs += coll.pop("runs")
        if coll["accepted"]:
            ca = coll["checkMesh"]
            shutil.copy2(os.path.join(md, "log.checkMesh_collapse"), os.path.join(md, "log.checkMesh_after"))

    status(case, "grouping problem regions", layout=lay)
    res = {
        "case": case, "source": open(os.path.join(case, ".meshDoctorCopy")).read().strip(),
        "layout": lay, "profile": profile, "targets": t, "options": extra,
        "doctorBefore": parse_summary(os.path.join(md, "summary_before.txt")),
        "doctorAfter": parse_summary(os.path.join(md, "summary_after.txt")),
        "checkMeshBefore": cb, "checkMeshAfter": ca, "verdict": verdict(cb, ca),
        "collapse": coll,
        "sweeps": sweeps, "passes": npass,
        "maxDisplacement_m": sum(float(x) for x in disp) if disp else None,
        "clustersBefore": cluster(case, "before", t),
        "clustersAfter": cluster(case, "after", t),
        "runs": runs, "finished": time.strftime("%Y-%m-%d %H:%M:%S"),
        "sourceCheck": source_check(fp_before, src) if fp_before else None,
        "openfoam": subprocess.run(["bash", "-c", f"source {BASHRC}; echo $WM_PROJECT_VERSION"],
                                   capture_output=True, text=True).stdout.strip(),
    }
    res = schema.write(os.path.join(md, "result.json"), res, "repair", indent=1)
    sc = res["sourceCheck"]
    status(case, "done" if not sc or sc["unchanged"] else "done, but the SOURCE CASE CHANGED during the run",
           layout=lay, verdict=res["verdict"])
    return res


def exit_code(res):
    """3 when the source case changed during the run (it must never happen)."""
    sc = res.get("sourceCheck")
    return 3 if sc and not sc["unchanged"] else 0


def main(a):
    if len(a) < 2:
        print(__doc__); return
    prof = "openfoam"
    if "--profile" in a:
        prof = a[a.index("--profile") + 1]
    if a[0] == "copy":
        print(copy_case(a[1], a[2]))
    elif a[0] == "inspect":
        r = inspect(a[1], prof); print(json.dumps(r["summary"], indent=1))
    elif a[0] == "fix":
        r = fix(a[1], prof); print(json.dumps(r["verdict"], indent=1))
        sys.exit(exit_code(r))
    elif a[0] == "full":
        src = os.path.abspath(os.path.expanduser(a[1]))
        plain_name(a[2])
        if "--no-ram-check" not in a:
            ok, msg = ramguard.check(src, "repair")
            print(msg, flush=True)
            if not ok:
                sys.exit(4)
        fp0 = source_fingerprint(src)          # before the copy: covers every step
        dst = copy_case(src, a[2])
        r = fix(dst, prof, fp_before=fp0); print(json.dumps(r["verdict"], indent=1))
        sys.exit(exit_code(r))
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
