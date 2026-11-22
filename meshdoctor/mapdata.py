#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Mesh Doctor map: where the mesh was repaired vs where the flow will not settle.

    python3 mapdata.py <mdCase> [--hot "Label=<case dir>"]... [--note "text"]... [--bin 0.004]

<mdCase> is a Mesh Doctor run in the workspace (config.py); its result.json holds
the defect clusters before/after repair, and its repaired copy gives the mesh.
Each --hot case holds [processorN/]meshDoctor/hotspots/hot.txt written by
foamResidualHotspots (one-iteration residual, or a slow swing between two
written times).

Writes <mdCase>/meshDoctor/map.json for the dashboard page /meshmap:
  - side (x-up) and top (x-across) views of the model surface (density of
    wall-face centres of the repaired copy, decomposed or not; the ground plane
    is found geometrically and excluded, and its normal is "up");
  - defect clusters before and after repair;
  - the top hotspot cells of each --hot layer.
Read-only on every case it touches.
"""
import base64, glob, json, os, re, sys
import numpy as np

import config
import schema

ROOT = config.settings()["workspace"]          # Mesh Doctor runs live here (config.py)


def read_points(poly):
    raw = open(os.path.join(poly, "points"), "rb").read()
    head = raw[:3000]
    m = re.search(rb"\n(\d+)\s*\n\(", raw)
    n, start = int(m.group(1)), m.end()
    if re.search(rb"format\s+binary", head):
        return np.frombuffer(raw, dtype="<f8", count=3 * n, offset=start).reshape(n, 3)
    body = raw[start:].replace(b"(", b" ").replace(b")", b" ")
    return np.array(body.split()[:3 * n], dtype=float).reshape(n, 3)


def patches(text):
    """[(name, type, nFaces, startFace)] from a polyMesh/boundary file.  Patch names
    may hold any non-blank characters (CAD exports give names such as
    `part_frt-fairing:001%1`), and the entries may come in any order."""
    out = []
    for name, body in re.findall(r"([^\s{}();]+)\s*\{([^{}]*)\}", text):
        t = re.search(r"\btype\s+(\w+)\s*;", body)
        n = re.search(r"\bnFaces\s+(\d+)\s*;", body)
        s = re.search(r"\bstartFace\s+(\d+)\s*;", body)
        if t and n and s:
            out.append((name, t.group(1), int(n.group(1)), int(s.group(1))))
    return out


def wall_centres(poly, pts):
    """Centres of the wall faces of one polyMesh, as {patch name: (n, 3) array}."""
    bnd = open(os.path.join(poly, "boundary"), encoding="utf-8", errors="replace").read()
    walls = [(name, s, n) for name, t, n, s in patches(bnd) if t == "wall"]
    raw = open(os.path.join(poly, "faces"), "rb").read()
    m = re.compile(rb"\n(\d+)\s*\n\(").search(raw)
    n1, s1 = int(m.group(1)), m.end()
    if not re.search(rb"format\s+binary", raw[:3000]):
        raise SystemExit("faces file is ascii; convert with foamFormatConvert first")
    off = np.frombuffer(raw, dtype="<i4", count=n1, offset=s1)
    m2 = re.compile(rb"(\d+)\s*\n\(").search(raw, s1 + 4 * n1)
    lab = np.frombuffer(raw, dtype="<i4", count=int(m2.group(1)), offset=m2.end())
    out = {}
    for name, start, n in walls:
        if n == 0:
            continue
        a, b = off[start], off[start + n]
        fid = np.repeat(np.arange(n), np.diff(off[start:start + n + 1]))
        cnt = np.bincount(fid, minlength=n)
        P = pts[lab[a:b]]
        out[name] = np.stack([np.bincount(fid, weights=P[:, k], minlength=n) / cnt for k in range(3)], 1)
    return out


def mesh_dirs(md):
    """polyMesh folders of the (repaired) copy: per processor if decomposed."""
    procs = sorted(glob.glob(os.path.join(md, "processor*", "constant", "polyMesh")),
                   key=lambda d: int(re.search(r"processor(\d+)", d).group(1)))
    return procs or [os.path.join(md, "constant", "polyMesh")]


def surface(md):
    """Wall-face centres of the model with the ground plane removed, plus the up axis.

    The ground is a wall patch that is thin along one axis (spread < 0.1 % of
    its size: snapped ground faces are not exactly flat, e.g. 2 mm of spread over
    31 m), sits on the lowest plane of the whole mesh along that axis, and covers
    at least half the domain floor; that axis is up.  Works whatever the patch is
    called (CAD exports often give the ground a generated name)."""
    walls, lo, hi = {}, np.full(3, np.inf), np.full(3, -np.inf)
    for poly in mesh_dirs(md):
        pts = read_points(poly)
        lo, hi = np.minimum(lo, pts.min(0)), np.maximum(hi, pts.max(0))
        for k, c in wall_centres(poly, pts).items():
            walls.setdefault(k, []).append(c)
    walls = {k: np.concatenate(v) for k, v in walls.items()}
    dom = hi - lo
    ground, up = [], None
    for k, c in walls.items():
        span = c.max(0) - c.min(0)
        ax = int(np.argmin(span))
        plan = [i for i in range(3) if i != ax]
        if span[ax] < 1e-3 * span.max() and c[:, ax].min() - lo[ax] < 0.01 * dom[ax] \
                and all(span[i] > 0.5 * dom[i] for i in plan):
            ground.append(k); up = ax
    if up is None:
        up = 1
    model = [c for k, c in walls.items() if k not in ground]
    if not model:
        raise SystemExit("no wall patches besides the ground in " + md + ": nothing to draw")
    C = np.concatenate(model)
    return C, up, ground, float(lo[up])


def density(pts, a, b, lo, hi, step):
    nx = int((hi[0] - lo[0]) / step) + 1
    ny = int((hi[1] - lo[1]) / step) + 1
    H, _, _ = np.histogram2d(pts[:, a], pts[:, b], bins=[nx, ny],
                             range=[[lo[0], hi[0]], [lo[1], hi[1]]])
    L = np.log1p(H)
    top = np.percentile(L[L > 0], 99.5) if (L > 0).any() else 1
    img = (255 * L / top).clip(0, 255).astype(np.uint8).T[::-1]   # rows: high b first
    return {"nx": nx, "ny": ny, "lo": lo, "hi": hi,
            "data": base64.b64encode(img.tobytes()).decode()}


def read_hot(case, n=3000):
    rows = []
    files = glob.glob(os.path.join(case, "processor*", "meshDoctor", "hotspots", "hot.txt")) \
        or glob.glob(os.path.join(case, "meshDoctor", "hotspots", "hot.txt"))
    for f in files:
        for line in open(f):
            t = line.split()
            if t and t[0] == "H":
                rows.append([float(t[5]), float(t[6]), float(t[7]), float(t[2])])
    rows.sort(key=lambda r: -r[3])
    summ = {}
    sf = os.path.join(case, "meshDoctor", "hotspots_summary.txt")
    if os.path.isfile(sf):
        for line in open(sf):
            k, *v = line.split()
            summ[k] = v[0] if v else ""
    return [[round(x, 4) for x in r] for r in rows[:n]], summ


def view_box(interest, model, pad=0.12):
    """The part of the model the map shows: every point of interest (the defect clusters before the repair, the
    strongest cells of each heat layer), padded by `pad` metres.  A run with no defect clusters and no heat layer
    shows the whole model (its wall-face centres) instead."""
    P = np.asarray(interest, dtype=float).reshape(-1, 3) if len(interest) else np.asarray(model, dtype=float)
    return P.min(0) - pad, P.max(0) + pad


def main(a):
    md = os.path.join(ROOT, a[0])
    res = schema.read(os.path.join(md, "meshDoctor", "result.json"), "repair")
    step = float(a[a.index("--bin") + 1]) if "--bin" in a else 0.004
    hot = [x.split("=", 1) for i, x in enumerate(a) if i and a[i - 1] == "--hot"]

    def cl(lst):
        return [{"c": [round(v, 4) for v in c["centroid"]], "n": c["nFaces"], "sev": c["severity"],
                 "kinds": c["kinds"], "patches": c.get("patches", [])[:3],
                 "nonOrtho": round(c["worst"]["nonOrtho"], 1), "skew": round(c["worst"]["skew"], 2)}
                for c in lst]
    layers = []
    for label, case in hot:
        rows, summ = read_hot(os.path.join(ROOT, case))
        layers.append({"label": label, "case": case, "cells": rows, "summary": summ})
    src = res["source"]
    pts, up, ground, glevel = surface(md)
    interest = [c["centroid"] for c in res["clustersBefore"]] + [r[:3] for L in layers for r in L["cells"][:1500]]
    lo, hi = view_box(interest, pts)
    lat = 3 - up          # x is always streamwise; the other horizontal axis is across
    lo[up] = min(lo[up], glevel - 0.01)
    sel = np.all((pts >= lo) & (pts <= hi), axis=1)
    pts = pts[sel]
    print("wall faces in view:", len(pts), "; up axis", "xyz"[up], "; ground patches", ground)
    S, T = (0, up), (0, lat)
    out = {"name": a[0], "source": src, "bin": step, "nCells": res.get("layout", {}).get("nCells"),
           "axes": {"side": list(S), "top": list(T)}, "ground": ground,
           "notes": [x for i, x in enumerate(a) if i and a[i - 1] == "--note"],
           "side": density(pts, *S, [float(lo[S[0]]), float(lo[S[1]])], [float(hi[S[0]]), float(hi[S[1]])], step),
           "top": density(pts, *T, [float(lo[T[0]]), float(lo[T[1]])], [float(hi[T[0]]), float(hi[T[1]])], step),
           "defectsBefore": cl(res["clustersBefore"]), "defectsAfter": cl(res["clustersAfter"]),
           "checkMeshBefore": res["checkMeshBefore"], "checkMeshAfter": res["checkMeshAfter"],
           "hot": layers}
    dst = os.path.join(md, "meshDoctor", "map.json")
    out = schema.write(dst, out, "map")
    print(dst, os.path.getsize(dst), "bytes;", len(out["defectsBefore"]), "->", len(out["defectsAfter"]),
          "defect clusters;", [(L["label"], len(L["cells"])) for L in layers])


if __name__ == "__main__":
    main(sys.argv[1:])
