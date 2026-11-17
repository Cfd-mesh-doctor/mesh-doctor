#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Geometry for the wheel-and-wing template: a racing-car front wheel and a front wing in ground effect.

    python3 make_wheel_wing.py [-o constant/geometry/model.stl] [--aoa 6] [--clearance 0.05] [--sink 0.005]

Writes one STL with two solids, `wing` and `wheel`, which snappyHexMesh turns into the patches `model_wing` and
`model_wheel`. Replace this file with your own STL (same solid names, or rename them in the case) to use the template
for your car.

- Wheel: 18 inch (0.457 m) diameter, 0.20 m wide, a plain cylinder, sunk `--sink` into the ground (default 5 mm) so
  the contact patch is a flat face instead of a zero-thickness wedge the mesher can't fill. Centre (0, 0.45, R - sink).
- Wing: NACA 4412 turned upside down (downforce), chord 0.28 m, span 0.55 m (y = 0 .. 0.55), trailing edge raised by
  `--aoa` degrees, lowest point `--clearance` above the ground, leading edge at x = 0.64 (0.13 m ahead of the tyre).
Axes (the toolkit's convention): x forward, the air flows toward -x, z up, ground at z = 0. Units: metres.
Python 3 standard library only.
"""
import math
import sys

R, WIDTH, YC = 0.2286, 0.20, 0.45            # wheel radius, width, centre y
CHORD, Y0, Y1, XLE = 0.28, 0.0, 0.55, 0.64   # wing chord, span ends, leading edge x


def opt(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv[:-1] else default


def sub(a, b):
    return [a[i] - b[i] for i in range(3)]


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def tri(out, a, b, c, hint):
    """Append triangle a, b, c with its normal turned toward `hint` (an outward direction); skip slivers."""
    n = cross(sub(b, a), sub(c, a))
    area = math.sqrt(sum(x * x for x in n))
    if area < 1e-14:
        return
    if sum(n[i] * hint[i] for i in range(3)) < 0:
        b, c = c, b
        n = [-x for x in n]
    out.append(([x / area for x in n], a, b, c))


def naca4412(n=80):
    """Closed NACA 4412 loop (chord 1): upper surface trailing edge -> leading edge, then lower back; (s, t) pairs."""
    m, p, th = 0.04, 0.4, 0.12
    up, lo = [], []
    for i in range(n + 1):
        s = 0.5 * (1 - math.cos(math.pi * i / n))          # cosine spacing: fine at both edges
        yt = 5 * th * (0.2969 * math.sqrt(s) - 0.1260 * s - 0.3516 * s ** 2 + 0.2843 * s ** 3 - 0.1036 * s ** 4)
        yc, dy = (m / p ** 2 * (2 * p * s - s * s), 2 * m / p ** 2 * (p - s)) if s < p else \
                 (m / (1 - p) ** 2 * (1 - 2 * p + 2 * p * s - s * s), 2 * m / (1 - p) ** 2 * (p - s))
        a = math.atan(dy)
        up.append((s - yt * math.sin(a), yc + yt * math.cos(a)))
        lo.append((s + yt * math.sin(a), yc - yt * math.cos(a)))
    up[0] = lo[0] = (0.0, 0.0)                              # one leading-edge point
    up[-1] = lo[-1] = (1.0, 0.0)                            # closed trailing edge (the -0.1036 coefficient)
    return up, lo


def wing(aoa, clearance):
    up, lo = naca4412()
    a = math.radians(aoa)

    def world(s, t):
        # chord direction (-cos a, sin a): from the leading edge toward -x, trailing edge raised by aoa;
        # normal (sin a, cos a); upside down: t -> -t, so the camber bulges toward the ground
        s, t = s * CHORD, -t * CHORD
        return (-s * math.cos(a) + t * math.sin(a), s * math.sin(a) + t * math.cos(a))

    U = [world(*q) for q in up]
    L = [world(*q) for q in lo]
    zmin = min(z for _, z in U + L)
    shift = clearance - zmin
    U = [(XLE + x, z + shift) for x, z in U]
    L = [(XLE + x, z + shift) for x, z in L]
    loop = U[::-1][:-1] + L                                 # TE -> LE on top, LE -> TE below (TE not repeated)
    loop = loop[:-1]
    cx = sum(x for x, _ in loop) / len(loop)
    cz = sum(z for _, z in loop) / len(loop)
    # polygon orientation in (x, z): outward normal of edge (dx, dz) is (dz, -dx) when the loop turns positively
    area = sum(loop[i][0] * loop[(i + 1) % len(loop)][1] - loop[(i + 1) % len(loop)][0] * loop[i][1]
               for i in range(len(loop)))
    sgn = 1 if area > 0 else -1
    out = []
    for i in range(len(loop)):
        (x0, z0), (x1, z1) = loop[i], loop[(i + 1) % len(loop)]
        hint = [sgn * (z1 - z0), 0.0, -sgn * (x1 - x0)]
        p0, p1, q0, q1 = [x0, Y0, z0], [x1, Y0, z1], [x0, Y1, z0], [x1, Y1, z1]
        tri(out, p0, p1, q1, hint)
        tri(out, p0, q1, q0, hint)
    for y, hy in ((Y0, -1.0), (Y1, 1.0)):                   # end caps: strips between the upper and lower surfaces
        for i in range(len(U) - 1):
            a0, a1 = [U[i][0], y, U[i][1]], [U[i + 1][0], y, U[i + 1][1]]
            b0, b1 = [L[i][0], y, L[i][1]], [L[i + 1][0], y, L[i + 1][1]]
            tri(out, a0, a1, b1, [0, hy, 0])
            tri(out, a0, b1, b0, [0, hy, 0])
    return out, (cx, cz)


def wheel(sink, n=120):
    zc = R - sink
    ya, yb = YC - WIDTH / 2, YC + WIDTH / 2
    ring = [(R * math.cos(2 * math.pi * i / n), R * math.sin(2 * math.pi * i / n)) for i in range(n)]
    out = []
    for i in range(n):
        (x0, z0), (x1, z1) = ring[i], ring[(i + 1) % n]
        hint = [x0 + x1, 0.0, z0 + z1]
        a0, a1 = [x0, ya, zc + z0], [x1, ya, zc + z1]
        b0, b1 = [x0, yb, zc + z0], [x1, yb, zc + z1]
        tri(out, a0, a1, b1, hint)
        tri(out, a0, b1, b0, hint)
        tri(out, [0.0, ya, zc], a0, a1, [0, -1.0, 0])
        tri(out, [0.0, yb, zc], b0, b1, [0, 1.0, 0])
    return out, zc


def write(path, solids):
    with open(path, 'w') as f:
        for name, tris in solids:
            f.write('solid %s\n' % name)
            for n, a, b, c in tris:
                f.write('  facet normal %g %g %g\n    outer loop\n' % tuple(n))
                for p in (a, b, c):
                    f.write('      vertex %.7f %.7f %.7f\n' % tuple(p))
                f.write('    endloop\n  endfacet\n')
            f.write('endsolid %s\n' % name)


def main():
    path = opt('-o', 'constant/geometry/model.stl')
    aoa, clear, sink = float(opt('--aoa', 6)), float(opt('--clearance', 0.05)), float(opt('--sink', 0.005))
    w, _ = wing(aoa, clear)
    h, zc = wheel(sink)
    write(path, [('wing', w), ('wheel', h)])
    print('wrote %s: wing %d triangles (chord %.2f m, span %.2f m, aoa %g deg, clearance %g m), wheel %d triangles '
          '(centre z %.4f m, rolling radius for the rotation: %.4f m)' % (path, len(w), CHORD, Y1 - Y0, aoa, clear,
                                                                         len(h), zc, zc))


if __name__ == '__main__':
    main()
