# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""RAM guard: refuse to start a job that would not fit in free memory.

The need is estimated from the cell count, with figures measured on an
11.1-million-cell steady half-car case (Linux, OpenFOAM 14):

  repair (foamMeshDoctor, serial)   15.7 GB   -> 1.5 KB per cell
  solve (foamRun, 6 ranks, total)   ~14 GB    -> 1.35 KB per cell
  post (transient-plan: foamPostProcess CourantNo, cell centres and volumes, 6 ranks,
        plus reading the fields in Python): ~5 GB at peak   -> 0.5 KB per cell

plus 0.5 GB of headroom.  Free memory is MemAvailable from /proc/meminfo,
capped by the optional `ram_limit_mb` setting (config.py).  On a cluster,
heavy jobs belong in the scheduler (cluster/slurm), not on the login node.
"""
import glob, gzip, os, re

import config

KB_PER_CELL = {"repair": 1.5, "solve": 1.35, "post": 0.5}
HEADROOM_MB = 512


def _owner_cells(path):
    opener = gzip.open if path.endswith(".gz") else open
    try:
        with opener(path, "rb") as f:
            head = f.read(4096)
    except OSError:
        return None
    m = re.search(rb"nCells:\s*(\d+)", head)
    return int(m.group(1)) if m else None


def mesh_cells(case):
    """Cell count from the polyMesh owner header (serial, else summed over processors)."""
    for name in ("owner", "owner.gz"):
        n = _owner_cells(os.path.join(case, "constant", "polyMesh", name))
        if n:
            return n
    total = 0
    for d in glob.glob(os.path.join(case, "processor*", "constant", "polyMesh")):
        n = _owner_cells(os.path.join(d, "owner")) or _owner_cells(os.path.join(d, "owner.gz"))
        if not n:
            return None
        total += n
    return total or None


def available_mb():
    try:
        mem = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                mem[k] = int(v.split()[0]) // 1024
        free = mem.get("MemAvailable", mem.get("MemFree"))
    except (OSError, ValueError):
        return None
    limit = config.settings().get("ram_limit_mb")
    try:
        return min(free, int(limit)) if limit else free
    except ValueError:
        return free


def check(case, kind):
    """(ok, message).  kind: "repair", "solve" or "post".  Unknown sizes are let through."""
    cells = mesh_cells(case)
    free = available_mb()
    if not cells or free is None:
        return True, "RAM guard: mesh size or free memory unknown; not checked"
    need = int(cells * KB_PER_CELL[kind] / 1024) + HEADROOM_MB
    msg = f"{kind} of {cells:,} cells needs about {need / 1024:.1f} GB; {free / 1024:.1f} GB free"
    if need > free:
        return False, ("not enough memory: " + msg +
                       ". Close other programs (ParaView, another solver) or run it on a bigger machine.")
    return True, msg
