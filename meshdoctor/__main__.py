# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Mesh Doctor for OpenFOAM 14 (openfoam.org): one entry point for every tool.

    python3 -m meshdoctor serve  [--port 8765] [--case <live case>]   dashboard
    python3 -m meshdoctor new    [<template> <name> [--size S]]       new case from a template, meshed
    python3 -m meshdoctor full   <srcCase> <name> [--profile P]       copy, check, repair, check
    python3 -m meshdoctor copy | inspect | fix ...                    single repair steps
    python3 -m meshdoctor ab     <srcCase> <name> [--iters N] ...     A/B solver test
    python3 -m meshdoctor ab     extend | hotspots | mode ...         A/B follow-ups
    python3 -m meshdoctor judge  <case> [window|auto] [--to N]        convergence verdict
    python3 -m meshdoctor transient-plan <case> [--co 1,5,20]         time step and cost of a transient run
    python3 -m meshdoctor map    <name> [--hot "Label=<dir>"] ...     repair-vs-hotspot map
    python3 -m meshdoctor config                                      settings in use
    python3 -m meshdoctor schema <kind> <file>                        validate a result file
    python3 -m meshdoctor jobs   [list | show <id> | cancel <id>]     dashboard and API jobs
    python3 -m meshdoctor report <name> [--html | --gzip] [-o file]   portable report (one file)
    python3 -m meshdoctor check                                       is this machine ready?
    python3 -m meshdoctor pair   [--new] [--open]                     pair the web app with this engine
    python3 -m meshdoctor experimental polish | ratchet ...           experimental skills

New here? python3 -m meshdoctor check says whether this machine is ready. Then python3 -m meshdoctor serve
starts the engine and its dashboard; to use the web app too, run python3 -m meshdoctor pair --open in a
second terminal while it runs.
Each command's own help: python3 -m meshdoctor <command> --help
Source cases are only ever read; every job works on a copy in the workspace, and a new case goes in a new folder.
A <srcCase> is a folder, or the name of a case in the cases folder (python3 -m meshdoctor config).
"""
import os, runpy, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = {
    "serve": "server.py",
    "new": "templates.py",
    "full": "repair.py", "copy": "repair.py", "inspect": "repair.py", "fix": "repair.py",
    "ab": "abtest.py",
    "judge": "abtest.py",
    "transient-plan": "tplan.py",
    "map": "mapdata.py",
    "config": "config.py",
    "check": "selfcheck.py",
    "schema": "schema.py",
    "jobs": "jobs.py",
    "report": "report.py",
    "pair": "pairing.py",
}
EXPERIMENTAL = {"polish": "polish.py", "ratchet": "ratchet.py"}
# Only when the help gives python3 -m meshdoctor: where that works, and how to get the short command
FROM_CLONE = ("Run it from the folder that holds meshdoctor/. To type just meshdoctor in any folder, link\n"
              "bin/meshdoctor into ~/.local/bin, as the setup scripts do.\n")


def usage():
    """The help above, giving each command as it is typed here (prog.py)."""
    import prog
    if prog.name() == prog.MODULE:
        return __doc__ + FROM_CLONE
    return prog.text(__doc__)


def main(argv=None):
    sys.path.insert(0, HERE)                 # the tools import each other by module name
    import prog
    os.environ["MESHDOCTOR_PROG"] = prog.name()          # so the tools' own messages give commands the same way
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(usage())
        return 0
    cmd, rest = argv[0], argv[1:]
    if cmd == "experimental":
        if not rest or rest[0] not in EXPERIMENTAL:
            sys.exit("experimental commands: " + ", ".join(EXPERIMENTAL))
        script, args = os.path.join(HERE, "experimental", EXPERIMENTAL[rest[0]]), rest[1:]
    elif cmd in SCRIPTS:
        script = os.path.join(HERE, SCRIPTS[cmd])
        # repair.py and abtest.py take their sub-command as the first argument
        args = [cmd] + rest if cmd in ("full", "copy", "inspect", "fix", "judge") else rest
    else:
        sys.exit(f"unknown command {cmd!r}; try: {prog.name()} help")
    if os.name == "nt":
        sys.exit("Mesh Doctor runs on Linux. On Windows, run it inside WSL: wsl python3 -m meshdoctor " + cmd)
    sys.argv = [script] + args
    runpy.run_path(script, run_name="__main__")
    return 0


if __name__ == "__main__":
    sys.exit(main())
