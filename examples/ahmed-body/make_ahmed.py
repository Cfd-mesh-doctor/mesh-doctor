#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Write the Ahmed body (Ahmed, Ramm & Faltin 1984) as an ASCII STL, from its published dimensions.

    python3 make_ahmed.py [--slant 25] [--stilts] [-o constant/geometry/ahmed.stl]

Dimensions (mm): length 1044, width 389, height 288, front edges rounded with radius 100, ground clearance 50,
slanted rear surface 222 long (measured along the slant) at --slant degrees. --stilts adds four 30 mm cylindrical
supports down to the ground, like the wind-tunnel model's; their positions (STILTS below) are approximate, so the
default case leaves them out (as many CFD studies do) and the comparison with measurements says so.

Axes (the toolkit's convention): x forward, so the nose faces +x and the air flows toward -x; z up, ground at
z = 0; y to the side, centreline y = 0. The nose is at x = 0, the base at x = -1.044 m. Units: metres.

The body is exactly the intersection of the side-view and top-view profiles (the front edges are cylinders of
radius 100 mm, the long edges are sharp), so every cross-section is a rectangle and the surface is built from
quads between stations along the length. Python 3 standard library only.
"""
import math
import sys

L, W, H, R, C, LS = 1.044, 0.389, 0.288, 0.100, 0.050, 0.222
STILTS = [(-0.163, 0.1635), (-0.163, -0.1635), (-0.633, 0.1635), (-0.633, -0.1635)]   # (x, y) of the 4 supports
STILT_R = 0.015


def opt(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv[:-1] else default


def section(d, phi):
    """Half-width, bottom and top of the cross-section at distance d behind the nose."""
    if d < R:
        inset = R - math.sqrt(max(0.0, R * R - (R - d) ** 2))
    else:
        inset = 0.0
    lp = LS * math.cos(phi)                    # horizontal length of the slant
    top = C + H - inset
    if d > L - lp:
        top = C + H - (d - (L - lp)) * math.tan(phi)
    return W / 2 - inset, C + inset, top


def stations(phi):
    ds = [R * (1 - math.cos(a)) for a in [i * (math.pi / 2) / 48 for i in range(49)]]   # fine on the rounded nose
    ds += [R + (L - LS * math.cos(phi) - R) * i / 30 for i in range(1, 31)]             # straight part
    ds += [L - LS * math.cos(phi) + LS * math.cos(phi) * i / 12 for i in range(1, 13)]  # slant
    return ds


def quad(tris, a, b, c, d):
    tris.append((a, b, c))
    tris.append((a, c, d))


def body(phi):
    tris = []
    ds = stations(phi)
    secs = [section(d, phi) for d in ds]
    for (d0, (w0, b0, t0)), (d1, (w1, b1, t1)) in zip(zip(ds, secs), zip(ds[1:], secs[1:])):
        x0, x1 = -d0, -d1
        # corners of the rectangle at each station, counter-clockwise seen from the front (+x)
        p0 = [(x0, -w0, b0), (x0, w0, b0), (x0, w0, t0), (x0, -w0, t0)]
        p1 = [(x1, -w1, b1), (x1, w1, b1), (x1, w1, t1), (x1, -w1, t1)]
        for k in range(4):                     # bottom, right side, top, left side; normals point outwards
            quad(tris, p0[k], p1[k], p1[(k + 1) % 4], p0[(k + 1) % 4])
    w, b, t = secs[0]                          # flat front face, normal +x
    quad(tris, (0.0, -w, b), (0.0, w, b), (0.0, w, t), (0.0, -w, t))
    w, b, t = secs[-1]                         # vertical base, normal -x
    quad(tris, (-L, -w, b), (-L, -w, t), (-L, w, t), (-L, w, b))
    return tris


def stilt(x, y, n=24):
    tris = []
    ring = [(x + STILT_R * math.cos(2 * math.pi * i / n), y + STILT_R * math.sin(2 * math.pi * i / n)) for i in range(n)]
    top = C + 0.002                            # 2 mm into the body, so the mesher sees one closed fluid region
    for i in range(n):
        (xa, ya), (xb, yb) = ring[i], ring[(i + 1) % n]
        quad(tris, (xa, ya, 0.0), (xb, yb, 0.0), (xb, yb, top), (xa, ya, top))
        tris.append(((x, y, 0.0), (xb, yb, 0.0), (xa, ya, 0.0)))     # bottom cap, normal -z
        tris.append(((x, y, top), (xa, ya, top), (xb, yb, top)))     # top cap (inside the body), normal +z
    return tris


def normal(a, b, c):
    u = [b[i] - a[i] for i in range(3)]
    v = [c[i] - a[i] for i in range(3)]
    n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    m = math.sqrt(sum(x * x for x in n)) or 1.0
    return [x / m for x in n]


def write(path, solids):
    with open(path, 'w') as f:
        for name, tris in solids:
            f.write('solid %s\n' % name)
            for a, b, c in tris:
                if a == b or b == c or a == c:
                    continue
                f.write('  facet normal %.6e %.6e %.6e\n    outer loop\n' % tuple(normal(a, b, c)))
                for p in (a, b, c):
                    f.write('      vertex %.7e %.7e %.7e\n' % p)
                f.write('    endloop\n  endfacet\n')
            f.write('endsolid %s\n' % name)


def main():
    phi = math.radians(float(opt('--slant', 25)))
    out = opt('-o', 'ahmed.stl')
    solids = [('body', body(phi))]
    if '--stilts' in sys.argv:
        solids.append(('stilts', [t for x, y in STILTS for t in stilt(x, y)]))
    write(out, solids)
    n = sum(len(t) for _, t in solids)
    print('wrote %s: %d triangles, slant %g deg, frontal area %.4f m2 (half model %.4f m2), length %.3f m'
          % (out, n, math.degrees(phi), W * H, W * H / 2, L))


if __name__ == '__main__':
    main()
