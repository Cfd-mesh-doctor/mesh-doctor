#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Will this case fit, how long will it take, what will it cost? Rough answers from measured runs.

    python3 size_estimate.py CELLS_MILLIONS [--iters 1000] [--ram 26] [--cores 6] [--gcp-price 0.84]

CELLS_MILLIONS  mesh size in millions of cells (e.g. 5.1)
--iters         steady iterations (default 1000)
--ram           memory available to OpenFOAM on your machine, GB (WSL default on a 32 GB PC: 26)
--cores         solver ranks you will use locally (physical cores, not threads)
--gcp-price     $/hour for the cloud VM (default: 12 vCPU / 96 GB custom N2, us-central1, list price)

Every coefficient below comes from a real run (OpenFOAM 14, incompressible steady k-omega SST, snappyHexMesh meshes,
or SimScale's Community plan). Treat the answers as +-30 %: the wall-clock time depends on the CPU, the mesh quality
and the function objects. Python 3 standard library only.
"""
import sys

# memory, GB per million cells (measured; see the openfoam-wsl skill)
SNAPPY_GB, SOLVE_GB, CHECK_GB = 2.1, 1.75, 0.67
MD_GB = 1.5                             # Mesh Doctor: about 1.5 KB per cell = 1.5 GB per million (+0.5 GB)
DECOMPOSE_GB = 1.9                      # serial decomposePar peak (55-60 GB for 31M cells)
# solver cost in rank-seconds per million cells per iteration (cells * iterations / ranks scale)
LAPTOP_RS = 9.5                         # Intel Core Ultra 7 laptop, 6 ranks (0.84M-cell Ahmed body: ~1.3 s/iteration)
CLOUD_RS = 13.0                         # GCP N2 12 vCPU, 6 ranks (31M-cell car: 67 s/iteration)
# SimScale Community plan
SIMSCALE_COREH = 2.6                    # core hours per million cells per 1000 iterations (3.8-10M-cell runs)
SIMSCALE_MAX_M = 13                     # solver ran out of memory at ~14M cells; ~20M crashed at start
SIMSCALE_MESH_COREH = 0.3               # meshing, core hours per million cells (typical)


def opt(name, default):
    return float(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv[:-1] else default


def hours(s):
    return '%.1f h' % (s / 3600) if s >= 5400 else '%.0f min' % (s / 60)


def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith('-'):
        sys.exit(__doc__)
    m = float(sys.argv[1])
    iters, ram, cores, price = opt('--iters', 1000), opt('--ram', 26), opt('--cores', 6), opt('--gcp-price', 0.84)

    need = {'snappyHexMesh (serial)': SNAPPY_GB * m, 'solver (all ranks together)': SOLVE_GB * m,
            'decomposePar (serial)': DECOMPOSE_GB * m, 'checkMesh (serial)': CHECK_GB * m,
            'Mesh Doctor repair (serial)': MD_GB * m + 0.5}
    print('%.2f million cells, %d iterations\n' % (m, iters))
    print('Memory (your machine: %g GB)' % ram)
    for k, v in need.items():
        print('  %-30s %6.1f GB   %s' % (k, v, 'fits' if v < 0.9 * ram else 'TOO BIG for %g GB' % ram))

    t_local = LAPTOP_RS * m * iters / cores
    print('\nLocal solve on %d ranks: about %s (laptop-class CPU)' % (cores, hours(t_local)))
    if SOLVE_GB * m > 0.9 * ram:
        print('  -> does not fit in memory here: use the cloud (cloud-solve-gcp skill) or a smaller mesh')

    vm_ram, vm_ranks = 96, 6
    t_cloud = CLOUD_RS * m * iters / vm_ranks + 15 * 60          # + install, download, decompose, upload
    print('\nGoogle Cloud, 12 vCPU / 96 GB VM (6 ranks): about %s, about $%.0f at $%.2f/h'
          % (hours(t_cloud), t_cloud / 3600 * price, price))
    if DECOMPOSE_GB * m > 0.9 * vm_ram:
        print('  -> decomposePar needs ~%.0f GB: decompose locally first, or use a bigger VM (needs an upgraded account)'
              % (DECOMPOSE_GB * m))

    ch = SIMSCALE_COREH * m * iters / 1000 + SIMSCALE_MESH_COREH * m
    print('\nSimScale Community: about %.0f core hours (mesh + %d iterations)' % (ch, iters))
    if m > SIMSCALE_MAX_M:
        print('  -> above ~%d M cells the Community solver ran out of memory: trim the mesh' % SIMSCALE_MAX_M)
    print('\nRough numbers (+-30 %). Steady car/wheel cases needed 1000-1500+ iterations to settle.')


if __name__ == '__main__':
    main()
