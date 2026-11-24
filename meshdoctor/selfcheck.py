# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Is this machine ready for Mesh Doctor?   python3 -m meshdoctor check

Checks Python, numpy, the settings, the cases folder and the workspace,
OpenFOAM 14 (openfoam.org), the programs a repair, an A/B test and a solve run,
ParaView (pvbatch), which only pictures of the flow need, and memory.  Prints
one line per check, then what to do next; exits 1 if anything required is
missing.  Reads only; changes nothing.

report() is the same checks as one document, for GET /api/v1/check: each
check's id, label, state (ok, warn or fail), what it found, the fix and a
command for it, worded without this machine's folders, as every API answer is.
"""
import math, os, re, shlex, shutil, stat, subprocess, sys, time

import config
import prog
import ramguard

FAIL, WARN, OK = "fail", "warn", "ok"
LEVEL = {FAIL: "FAIL", WARN: "warn", OK: "ok"}          # as the command prints them

# OpenFOAM's own programs; MPI's, which runs a case on several cores (A/B tests and solves); and the utilities
# this repository builds (./Allwmake).
OPENFOAM = ("foamRun", "checkMesh", "decomposePar", "foamDictionary")
MPI = "mpirun"
OWN = ("foamMeshDoctor", "foamResidualHotspots", "foamCourantCells")
PROGRAMS = OPENFOAM + (MPI,) + OWN
# ParaView's batch program, which makes the pictures of the flow offscreen (skills/paraview-post); Ubuntu's finds its
# own Python modules only with them on PYTHONPATH.  A warning without it: no repair, A/B test or solve needs it.
PVBATCH = "pvbatch"
PV_PYTHONPATH = "/usr/lib/python3/dist-packages"


def foam_env(bashrc):
    """WM_PROJECT, WM_PROJECT_VERSION and where each needed program is, after sourcing bashrc."""
    cmd = (f". {shlex.quote(bashrc)} >/dev/null 2>&1; echo \"$WM_PROJECT|$WM_PROJECT_VERSION|$FOAM_USER_APPBIN\"; "
           f"for p in {' '.join(PROGRAMS)}; do echo \"$p|$(command -v $p)\"; done")
    try:
        out = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, timeout=60).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    lines = out.strip().splitlines()
    if not lines:
        return None
    proj, ver, appbin = (lines[0].split("|") + ["", "", ""])[:3]
    return {"project": proj, "version": ver, "appbin": appbin,
            "progs": dict(l.split("|", 1) for l in lines[1:] if "|" in l)}


def millions(cells):
    """Cells in millions, rounded down to 0.1 so a size is never generous: 14.49 M is "14.4"."""
    return f"{math.floor(cells / 1e5) / 10:.1f}"


def paraview():
    """(where pvbatch is, the ParaView version `pvbatch --version` gives): (None, None) when it isn't on the PATH,
    (where, None) when it doesn't start or doesn't say its version."""
    where = shutil.which(PVBATCH)
    if not where:
        return None, None
    try:
        r = subprocess.run([where, "--version"], capture_output=True, text=True, timeout=30,
                           stdin=subprocess.DEVNULL, env=dict(os.environ, PYTHONPATH=PV_PYTHONPATH))
    except (OSError, subprocess.SubprocessError):
        return where, None
    m = re.search(r"\bversion\s+(\d\S*)", r.stdout + r.stderr) if r.returncode == 0 else None
    return where, m.group(1) if m else None


def _run(paths):
    """(the checks, the free memory in MB or None).  Each check is {id, label, group, state, found, fix, command};
    fix and command are None when there is nothing to do.  paths=False words them without this machine's folders."""
    md = prog.name()
    rows = []

    def add(group, key, label, state, found, fix=None, command=None):
        rows.append({"id": key, "label": label, "group": group, "state": state, "found": found, "fix": fix,
                     "command": command})

    v = sys.version_info
    add("python", "python", "Python", OK if v >= (3, 8) else FAIL, f"{v.major}.{v.minor}.{v.micro}",
        None if v >= (3, 8) else "Mesh Doctor needs Python 3.8 or newer")
    try:
        import numpy
        add("python", "numpy", "numpy", OK, numpy.__version__)
    except ImportError:
        add("python", "numpy", "numpy", WARN, "missing", "only the repair map needs it", "sudo apt install python3-numpy")

    s = config.resolve()
    cases = s["cases"][0]
    if os.path.isdir(cases):
        add("folders", "cases", "Cases folder", OK, "found")
    elif paths:
        add("folders", "cases", "Cases folder", WARN, f"{cases} does not exist",
            f"set `cases` in {config.config_file()}")
    else:
        add("folders", "cases", "Cases folder", WARN, "does not exist",
            "set `cases` in the config file (or MESHDOCTOR_CASES) and restart the engine; this shows the folder it "
            "looks in and where each setting comes from", f"{md} config")
    ws = s["workspace"][0]
    if os.path.realpath(ws).startswith(os.path.realpath(cases) + os.sep) and \
            os.path.isfile(os.path.join(os.path.dirname(ws), "system", "controlDict")):
        add("folders", "workspace", "Workspace", FAIL, "is inside a case folder",
            "put it outside every case: set `workspace` in the config file")
    elif os.path.isdir(ws):
        mode = stat.S_IMODE(os.stat(ws).st_mode)
        if not mode & 0o077:
            add("folders", "workspace", "Workspace", OK, "private (700)")
        elif paths:
            add("folders", "workspace", "Workspace", WARN, f"open to other users (mode {mode:o})",
                f"on a shared machine run: chmod 700 '{ws}'")
        else:
            add("folders", "workspace", "Workspace", WARN, f"open to other users (mode {mode:o})",
                "on a shared machine, others could read the copied cases: make the workspace folder private with "
                "`chmod 700`; this shows where it is", f"{md} config")
    else:
        add("folders", "workspace", "Workspace", OK, "will be created, private (700)")

    bashrc = s["bashrc"][0]
    env = foam_env(bashrc) if os.path.isfile(bashrc) else None
    if not env:
        if paths:
            add("openfoam", "openfoam", "OpenFOAM", FAIL, f"no OpenFOAM environment from {bashrc}",
                "set `bashrc` (MESHDOCTOR_FOAM_BASHRC)")
        else:
            add("openfoam", "openfoam", "OpenFOAM", FAIL, "no OpenFOAM environment",
                "install OpenFOAM 14 from openfoam.org, or set `bashrc` in the config file to its etc/bashrc; this "
                "shows the one it reads", f"{md} config")
    else:
        good = env["project"] == "OpenFOAM" and env["version"] == "14"
        add("openfoam", "openfoam", "OpenFOAM", OK if good else FAIL,
            f"{env['project']} {env['version']}".strip() or "unknown",
            None if good else "Mesh Doctor needs OpenFOAM 14 from openfoam.org")
        for p in PROGRAMS:
            where = env["progs"].get(p, "")
            if where:
                add("programs", p, p, OK, where if paths else "found")
            elif p in OWN:
                add("programs", p, p, FAIL, "not built", "run ./Allwmake in the repository, with OpenFOAM 14 loaded",
                    "./Allwmake")
            elif p == MPI:
                add("programs", p, p, FAIL, "not found", "A/B tests and solves need it to run on several cores",
                    "sudo apt install openmpi-bin")
            else:
                add("programs", p, p, FAIL, "not found in the OpenFOAM environment",
                    "it comes with OpenFOAM 14: check that `bashrc` is OpenFOAM 14's")

    where, version = paraview()
    if version:
        add("pictures", "pvbatch", "ParaView", OK, f"{version}, {where}" if paths else version)
    elif where:
        add("pictures", "pvbatch", "ParaView", WARN, f"{where} found, but it doesn't start" if paths else
            "pvbatch found, but it doesn't start", "pictures of the flow need it: install ParaView again",
            "sudo apt install --reinstall paraview python3-paraview")
    else:
        add("pictures", "pvbatch", "ParaView", WARN, "pvbatch not found",
            "only pictures of the flow need it (about 600 MB)", "sudo apt install paraview python3-paraview")

    free = ramguard.available_mb()
    if free:
        add("memory", "memory", "Memory", OK, f"{free / 1024:.1f} GB available" +
            (f"; about {millions(ramguard.max_cells('repair', free))}M cells can be repaired" if paths else ""))
    else:
        add("memory", "memory", "Memory", WARN, "unknown (no /proc/meminfo)",
            "the RAM guard can't check that a job fits, so it lets every job start")
    return rows, free


def checks(paths=True):
    """The checks, in order (see _run)."""
    return _run(paths)[0]


def report():
    """GET /api/v1/check: the checks without this machine's folders; ready when none failed (a warning doesn't stop
    a job); the memory free now and the largest mesh the RAM guard lets a repair or a solve take in it."""
    rows, free = _run(paths=False)
    return {"ready": not any(r["state"] == FAIL for r in rows), "checks": rows,
            "memory": {"availableMb": free, "limitMb": ramguard.limit_mb(),
                       "cells": {k: ramguard.max_cells(k, free) if free else None for k in ("repair", "solve")}},
            "checked": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


def _detail(row):
    """A check's line as the command prints it: what was found; the fix, then its command where the fix doesn't
    already give it."""
    text = row["found"]
    if row.get("fix"):
        text += "; " + row["fix"]
    if row.get("command") and row["command"] not in (row.get("fix") or ""):
        text += ": " + row["command"]
    return text


def main(argv=None):
    rows = checks(paths=True)
    s = config.resolve()
    shown = [{"label": "setting " + k, "state": OK, "found": f"{s[k][0] or '(none)'}   [{s[k][1]}]"}
             for k in ("cases", "workspace", "bashrc", "live_case")]
    at = next(i for i, r in enumerate(rows) if r["group"] != "python")      # the settings, before the folders
    lines = rows[:at] + shown + rows[at:]
    w = max(len(r["label"]) for r in lines)
    for r in lines:
        print(f"{LEVEL[r['state']]:4s}  {r['label']:{w}s}  {_detail(r)}")
    bad = sum(1 for r in rows if r["state"] == FAIL)
    md = prog.name()
    if bad:
        print(f"\n{bad} problem(s) to fix before using Mesh Doctor; then run {md} check again")
        return 1
    print(f"\nready\nNext: try a repair on OpenFOAM's motorBike tutorial (the README's \"First run\"), or start the "
          f"engine and\nits dashboard with {md} serve; for the web app, run {md} pair --open in a second terminal.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
