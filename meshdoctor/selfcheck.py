# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Is this machine ready for Mesh Doctor?   python3 -m meshdoctor check

Checks Python, numpy, the settings, OpenFOAM 14 (openfoam.org), the built
utilities, the workspace and memory.  Prints one line per check; exits 1 if
anything required is missing.  Reads only; changes nothing.
"""
import os, shlex, subprocess, sys

import config
import ramguard

FAIL, WARN, OK = "FAIL", "warn", "ok"


def foam_env(bashrc):
    """WM_PROJECT, WM_PROJECT_VERSION and where each needed program is, after sourcing bashrc."""
    progs = "foamRun checkMesh decomposePar foamDictionary foamMeshDoctor foamResidualHotspots foamCourantCells"
    cmd = (f". {shlex.quote(bashrc)} >/dev/null 2>&1; echo \"$WM_PROJECT|$WM_PROJECT_VERSION|$FOAM_USER_APPBIN\"; "
           f"for p in {progs}; do echo \"$p|$(command -v $p)\"; done")
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


def main(argv=None):
    rows = []
    add = lambda level, what, detail: rows.append((level, what, detail))
    v = sys.version_info
    add(OK if v >= (3, 8) else FAIL, "Python", f"{v.major}.{v.minor}.{v.micro}" + ("" if v >= (3, 8) else "; needs 3.8+"))
    try:
        import numpy
        add(OK, "numpy", numpy.__version__)
    except ImportError:
        add(WARN, "numpy", "missing: only the repair map needs it (apt install python3-numpy)")
    s = config.resolve()
    for k in ("cases", "workspace", "bashrc", "live_case"):
        add(OK, "setting " + k, f"{s[k][0] or '(none)'}   [{s[k][1]}]")
    cases = s["cases"][0]
    add(OK if os.path.isdir(cases) else WARN, "cases folder", "found" if os.path.isdir(cases) else
        f"{cases} does not exist; set `cases` in {config.config_file()}")
    ws = s["workspace"][0]
    if os.path.realpath(ws).startswith(os.path.realpath(cases) + os.sep) and \
            os.path.isfile(os.path.join(os.path.dirname(ws), "system", "controlDict")):
        add(FAIL, "workspace", "is inside a case folder; put it outside every case")
    elif os.path.isdir(ws):
        warn = config.ensure_workspace(ws)
        add(WARN if warn else OK, "workspace", warn or "private (700)")
    else:
        add(OK, "workspace", "will be created, private (700)")
    bashrc = s["bashrc"][0]
    env = foam_env(bashrc) if os.path.isfile(bashrc) else None
    if not env:
        add(FAIL, "OpenFOAM", f"no OpenFOAM environment from {bashrc}; set `bashrc` (MESHDOCTOR_FOAM_BASHRC)")
    else:
        good = env["project"] == "OpenFOAM" and env["version"] == "14"
        add(OK if good else FAIL, "OpenFOAM", f"{env['project']} {env['version']}" +
            ("" if good else "; Mesh Doctor needs OpenFOAM 14 from openfoam.org"))
        for p, where in env["progs"].items():
            mine = p.startswith("foamMesh") or p.startswith("foamResidual")
            add(OK if where else FAIL, p, where or ("not built: run ./Allwmake in the repository" if mine
                                                     else "not found in the OpenFOAM environment"))
    free = ramguard.available_mb()
    add(OK if free else WARN, "memory", f"{free / 1024:.1f} GB available; about "
        f"{int(free * 1024 / ramguard.KB_PER_CELL['repair'] / 1e6 * 10) / 10}M cells can be repaired"
        if free else "unknown (no /proc/meminfo)")
    w = max(len(r[1]) for r in rows)
    for level, what, detail in rows:
        print(f"{level:4s}  {what:{w}s}  {detail}")
    bad = sum(1 for r in rows if r[0] == FAIL)
    print("\nready" if not bad else f"\n{bad} problem(s) to fix before using Mesh Doctor")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
