# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""RAM guard: refuse to start a job that would not fit in free memory.

The need is estimated from the cell count, with figures measured on an
11.1-million-cell steady half-car case (Linux, OpenFOAM 14):

  repair (foamMeshDoctor, serial)   15.7 GB   -> 1.5 KB per cell
  solve (foamRun, 6 ranks, total)   ~14 GB    -> 1.35 KB per cell
  post (transient-plan: foamPostProcess CourantNo, cell centres and volumes, 6 ranks,
        plus reading the fields in Python): ~5 GB at peak   -> 0.5 KB per cell

and for a mesh, from the templates' own (templates.py): snappyHexMesh, serial, 1.5 GB for the
Ahmed body's 0.84 million cells and 1.7 GB for the wheel and wing's 0.92 million (1.8 KB per
cell)   -> 2.2 KB per cell, as the app's size estimator (2.1 GB per million cells)

plus 0.5 GB of headroom.  Free memory is MemAvailable from /proc/meminfo,
capped by the optional `ram_limit_mb` setting (config.py).  On a cluster,
heavy jobs belong in the scheduler (cluster/slurm), not on the login node.
"""
import glob, gzip, os, re

import config

# pictures: ParaView reading a case with its cell data made point data, as the picture scripts do (18 GB at 31M
# cells, 7 GB at 12M: skills/paraview-post); pictures-split: reading a time still split onto the processes as it is
# (Decomposed Case), 1.5 times as much (the coarse Ahmed body's 0.48M cells on 6 processes: 0.97 GB at its peak, and
# 0.81 GB read joined; reconstructPar, which joins one, took 0.38 GB); pictures-times, -times-split: a set with a cut
# over time, which steps ParaView through the written times and holds a time's fields twice as it moves on to the next
# (the same 0.48M cells, its 4 times pictured 4 times over: 1.17 GB at its peak read joined, 1.39 GB read split; it
# levels off by the fifth picture, so it doesn't grow with the times pictured)
KB_PER_CELL = {"repair": 1.5, "solve": 1.35, "post": 0.5, "mesh": 2.2, "pictures": 0.6, "pictures-split": 0.9,
               "pictures-times": 1.4, "pictures-times-split": 1.9}
LABEL = {"pictures-split": "pictures read split", "pictures-times": "pictures over time",
         "pictures-times-split": "pictures over time read split"}   # a kind as the guard's message says it (else its name)
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


def owner_cells(poly):
    """The cell count in a polyMesh folder's owner header (owner or owner.gz), or None."""
    for name in ("owner", "owner.gz"):
        n = _owner_cells(os.path.join(poly, name))
        if n:
            return n
    return None


def mesh_cells(case):
    """Cell count from the polyMesh owner header (serial, else summed over processors)."""
    n = owner_cells(os.path.join(case, "constant", "polyMesh"))
    if n:
        return n
    total = 0
    for d in glob.glob(os.path.join(case, "processor*", "constant", "polyMesh")):
        n = owner_cells(d)
        if not n:
            return None
        total += n
    return total or None


def _meminfo():
    """/proc/meminfo in MB; {} where there is none (not Linux) or it can't be read."""
    mem = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                mem[k] = int(v.split()[0]) // 1024
    except (OSError, ValueError, IndexError):
        return {}
    return mem


def limit_mb():
    """The ram_limit_mb setting (config.py), or None when it is unset or not a number."""
    limit = config.settings().get("ram_limit_mb")
    try:
        return int(limit) if limit else None
    except ValueError:
        return None


def available_mb():
    mem = _meminfo()
    free = mem.get("MemAvailable", mem.get("MemFree"))
    if free is None:
        return None
    limit = limit_mb()
    return free if limit is None else min(free, limit)


def physical_cores(cpuinfo):
    """Physical cores in /proc/cpuinfo text: its distinct (physical id, core id) pairs, as lscpu counts them, so
    the threads of one core count once.  None when it names no core ids (some ARM and virtual machines)."""
    cores, cur = set(), {}
    for line in cpuinfo.splitlines() + [""]:
        if not line.strip():
            if "core id" in cur:
                cores.add((cur.get("physical id"), cur["core id"]))
            cur = {}
            continue
        k, _, v = line.partition(":")
        cur[k.strip()] = v.strip()
    return len(cores) or None


def machine():
    """The computer as Linux sees it (inside WSL: what WSL was given), for the app's size estimator:
    processors, physical cores, all the memory in MB, and the ram_limit_mb setting."""
    try:
        with open("/proc/cpuinfo") as f:
            cores = physical_cores(f.read())
    except OSError:
        cores = None
    return {"cpus": os.cpu_count(), "cores": cores, "memoryMb": _meminfo().get("MemTotal"), "ramLimitMb": limit_mb()}


def max_cells(kind, free_mb):
    """The largest mesh, in cells, that check() lets a job of this kind take in free_mb of memory (0 if none)."""
    return max(0, int((free_mb - HEADROOM_MB) * 1024 / KB_PER_CELL[kind]))


def check(case, kind):
    """(ok, message).  kind: "repair", "solve" or "post".  Unknown sizes are let through."""
    return check_cells(mesh_cells(case), kind)


def check_cells(cells, kind):
    """check() for a mesh of this many cells, as one a job is about to make ("mesh")."""
    free = available_mb()
    if not cells or free is None:
        return True, "RAM guard: mesh size or free memory unknown; not checked"
    need = int(cells * KB_PER_CELL[kind] / 1024) + HEADROOM_MB
    msg = f"{LABEL.get(kind, kind)} of {cells:,} cells needs about {need / 1024:.1f} GB; {free / 1024:.1f} GB free"
    if need > free:
        return False, ("not enough memory: " + msg +
                       ". Close other programs (ParaView, another solver) or run it on a bigger machine.")
    return True, msg
