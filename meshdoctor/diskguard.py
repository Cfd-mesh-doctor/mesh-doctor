# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Disk guard: refuse to start a job that would fill the disk.

A solve that makes a new case first writes it into the cases folder: a copy of a case you made (its mesh and
settings), a transient run of a solved steady run (its mesh, settings and latest result), or a case made from a
template (its mesh).  A copy is measured file by file, as the copy will walk it; a template's mesh, which isn't made
yet, is worked out from its cells.  Then the solve writes as it goes, from the size of its mesh: its split onto its
processes, and its written times.  Measured after 2,000 iterations of the Ahmed body's three meshes (0.48, 0.84 and
1.57 million cells, written in binary as the templates write them, OpenFOAM 14, 6 processes):

  the mesh (constant/polyMesh)                          0.14 KB per cell
  its split onto the processes                          1.05 times the mesh
  a written time, split onto the processes              0.8 times the mesh (each one's fields, and the faces they share)
  a written time, joined (or solved on one process)     0.6 times the mesh

A stretch writes about four times (solve.write_interval) and keeps as many as its controlDict's purgeWrite says (the
templates keep 2; 0 keeps every one); on several processes, its latest time is joined at its end.  A transient run's
stretch writes as many times as it asks for (4 unless it says), and keeps every one (transient.py).  So a solve from
the start of a template's case writes 3.25 times its mesh on several processes, as measured (3.2 for all three), and
1.2 times on one.  A continuation adds its latest time, joined, and only when every written time is kept, its own.
A transient run's written times hold its averages too, once its forces have settled (transient.py): UMean, pMean,
UPrime2Mean and pPrime2Mean, 11 values a cell, 1.1 times a written time's own fields (U, p, k, omega and nut, and the
flux on about 3 faces a cell: about 10), worked out from those fields' sizes; the guard counts them in each one.

The other jobs that write a case of their own are checked the same way, each against the free space of the folder it
writes in.  A new case made from a template (templates.py) takes its mesh, and the sets snappyHexMesh writes of its
layers: 0.022 to 0.026 times the mesh, measured on both templates' meshes (SETS: 0.03).  A repair (repair.py) writes
its copy into the workspace, measured as the copy walks it, then a backup of each mesh's points, the sets checkMesh and
the repair write of the mesh's faults (SETS), and while it collapses faces, a backup of the mesh it repairs and the new
mesh, before the old one goes (COLLAPSE: 2 times that mesh).  An A/B test (abtest.py) solves two copies of a case in
the workspace: each its settings, mesh and start fields, split onto its processes, and two written times, split, never
joined: the one it ends at, and the one after it that maps where the solution moves (AB_TIMES).  Measured: 3.3 times
the mesh a run, on the Ahmed body's 0.48 and 0.84 million cell meshes from 0, on 6 processes; the guard counts its copy
and 2.65 times the mesh.  A test that reuses an earlier one's first run makes one copy.  Running its second run longer
writes that run's own times, split.
1 GB is kept free for everything else.

The free space is that of the cases folder's disk.  Inside WSL 2, Linux's own disk is a file on a Windows drive (C:,
unless the distribution was moved), which grows as Linux fills it: Linux can say more is free than the drive has.
There, for a folder on Linux's own disk, the smaller of the two counts; a folder on a Windows drive (/mnt/d, say) has
that drive's own.
"""
import math, os, platform, re, shutil, stat

MB = 1024 * 1024
MESH_KB_PER_CELL = 0.14                         # a mesh written as the templates write theirs
SPLIT = 1.05                                    # the mesh's split onto the processes, times the mesh
WRITTEN = {"split": 0.8, "joined": 0.6}         # a written time, times the mesh
AVERAGED = 1.1                                  # a transient run's averages, times a written time's own fields
STRETCH = 4                                     # the times a stretch writes (solve.write_interval)
SETS = 0.03                                     # the sets beside a mesh (snappyHexMesh's of its layers, checkMesh's
                                                # and a repair's of its faults), times the mesh
COLLAPSE = 2                                    # a repair collapsing faces: its mesh's backup, and the new mesh
AB_TIMES = 2                                    # the times an A/B test's run writes: its end, and the one after it
PICTURE_MB = 0.3                                # a picture: ParaView's 1920 x 1080 PNGs of the coarse Ahmed body
                                                # were 0.08 to 0.14 MB, and a car's are busier
PICTURES_MB = 1                                 # a set's list and log, and the self test's picture
KEEP_MB = 1024                                  # kept free for everything else
WINDOWS_DRIVE = "/mnt/c"                        # inside WSL 2: the Windows drive that holds Linux's own disk
DEPTH = 40                                      # folders deep through links, as the system's own limit on links


def size(folder, ignore=None, links=True):
    """The bytes shutil.copytree(folder, ...) writes: each file's own size, links followed as copytree follows them,
    without what `ignore` (copytree's) leaves out and without dangling links (ignore_dangling_symlinks).  links=False
    counts as copytree(..., symlinks=True) copies: a link in the folder is copied as a link, which takes no room.  0
    when the folder can't be read."""
    def walk(d, depth):
        try:
            names = os.listdir(d)
            skip = set(ignore(d, names)) if ignore else set()
        except OSError:
            return 0
        total = 0
        for n in names:
            if n in skip:
                continue
            p = os.path.join(d, n)
            try:
                st = os.stat(p) if links else os.lstat(p)
            except OSError:                     # a dangling link
                continue
            if stat.S_ISDIR(st.st_mode):
                total += walk(p, depth + 1) if depth < DEPTH else 0
            elif stat.S_ISREG(st.st_mode):
                total += st.st_size
        return total
    return walk(folder, 0)


def mb(nbytes):
    """Bytes in MB, rounded up: a byte or more is 1 MB."""
    return -(-nbytes // MB)


def mesh_mb(cells):
    """The MB a mesh of `cells` cells takes, written as the templates write theirs (MESH_KB_PER_CELL)."""
    return _up(cells * MESH_KB_PER_CELL / 1024)


def solve_mb(mesh, purge, nproc, first=True, averaged=False, writes=STRETCH):
    """The MB a stretch of a solve writes as it goes, from the MB of its mesh, on `nproc` processes, writing `writes`
    times and keeping `purge` (its controlDict's purgeWrite; 0: every one).  From the start (`first`): its split and
    the times it keeps; a continuation: the times it adds, none when it keeps only the latest few (each new one takes
    an older one's place), as its split is there already.  On several processes, its latest time joined too.  A
    transient run's written times hold its averages too (`averaged`: AVERAGED more)."""
    several = nproc > 1
    grow = 1 + AVERAGED if averaged else 1
    kept = purge if 0 < purge < writes else writes
    added = kept if first else (0 if purge > 0 else writes)
    times = (SPLIT if several and first else 0) + added * WRITTEN["split" if several else "joined"] * grow
    return _up(mesh * (times + (WRITTEN["joined"] * grow if several else 0)))


def made_mb(cells):
    """The MB a case made from a template takes once meshed, from the `cells` it makes: its mesh (mesh_mb's) and the
    sets snappyHexMesh writes of its layers (SETS)."""
    return _up(cells * MESH_KB_PER_CELL / 1024 * (1 + SETS))


def repair_mb(copy, points, mesh):
    """The MB a repair writes into the workspace: its copy (`copy` bytes) and a backup of its meshes' points (`points`
    bytes), and from the MB of the mesh it repairs (`mesh`), the sets it writes (SETS) and room to collapse faces in it
    (COLLAPSE)."""
    return mb(copy + points) + _up(mesh * (SETS + COLLAPSE))


def ab_mb(copy, mesh, runs=2):
    """The MB an A/B test writes into the workspace: `runs` runs (2; 1 when it reuses an earlier test's first run),
    each a copy of the case (`copy` bytes: its settings, mesh and start fields) and, from the MB of its mesh (`mesh`),
    its split onto its processes and AB_TIMES written times, split."""
    return runs * (mb(copy) + _up(mesh * (SPLIT + AB_TIMES * WRITTEN["split"])))


def extend_mb(mesh, times):
    """The MB an A/B test's second run writes when it is run longer: `times` more written times, split, of its mesh of
    `mesh` MB (it keeps every one)."""
    return _up(mesh * times * WRITTEN["split"])


def pictures_mb(pictures):
    """The MB a set of this many pictures takes (pictures.py), with its list and log."""
    return _up(pictures * PICTURE_MB + PICTURES_MB)


def _up(x):
    """x rounded up to a whole MB once the float's own error is gone: 100 x 3.25 comes out 325.00000000000006, which
    is 325, not 326."""
    return math.ceil(round(x, 6))


def _wsl():
    """Inside WSL (whose kernel names Microsoft)?"""
    return "microsoft" in platform.uname().release.lower()


def _windows_free(path):
    """Inside WSL, for folder `path` on Linux's own disk: the free bytes of the Windows drive that holds that disk
    (WINDOWS_DRIVE), or None (not WSL, a folder on a Windows drive, or no such drive)."""
    if not _wsl() or re.match(r"/mnt/[a-z](/|$)", os.path.realpath(path)) or not os.path.ismount(WINDOWS_DRIVE):
        return None
    try:
        return shutil.disk_usage(WINDOWS_DRIVE).free
    except OSError:
        return None


def free_mb(path):
    """The free MB for a new folder in folder `path` (or the nearest folder above it that is there): its disk's, at
    most the Windows drive's inside WSL (_windows_free); None when it can't be read."""
    while not os.path.isdir(path):
        up = os.path.dirname(path)
        if up == path:
            return None
        path = up
    try:
        free = shutil.disk_usage(path).free
    except OSError:
        return None
    windows = _windows_free(path)
    return (free if windows is None else min(free, windows)) // MB


def text(mb_):
    """An amount of disk space as the app shows it: "70 MB" under a GB, "2.4 GB" under 100 GB, then "412 GB"."""
    if mb_ < 1024:
        return f"{max(mb_, 1):,} MB"
    gb = mb_ / 1024
    return f"{gb:.1f} GB" if gb < 100 else f"{gb:,.0f} GB"


def check(need, folder, what):
    """(ok, message) for a job that writes about `need` MB into `folder`: refused when that and KEEP_MB are more than
    the free space.  `what` names what needs it, with its verb ("the copy of wing and its solve need").  An unknown
    need or free space lets it through."""
    free = free_mb(folder)
    if need is None or free is None:
        return True, "disk guard: the space needed or free unknown; not checked"
    msg = f"{what} about {text(need)}, and the disk has {text(free)} free"
    if need + KEEP_MB > free:
        return False, (f"not enough disk space: {msg} (the engine keeps {text(KEEP_MB)} free). Delete runs or "
                       "results you no longer need, then try again.")
    return True, msg
