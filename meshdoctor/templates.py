# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""New cases from the templates in examples/: a copy in the cases folder under a new name, meshed by its Allmesh.

    python3 -m meshdoctor new                                       the templates and their mesh sizes
    python3 -m meshdoctor new <template> <name> [--size S] [--replace]

A new case always goes in a new folder: Mesh Doctor never changes a case you made.  A name that is taken is
refused, except a case made here before (it holds a .meshdoctor-case.json), which --replace deletes and makes
again, as after a mesh that failed.  The free memory is checked first (the RAM guard's mesh figure).  The app
starts the same thing as a `case` job (POST /api/v1/jobs), which runs `templates.py make`.
"""
import json, os, re, shlex, shutil, signal, subprocess, sys, time

import config
import jobs
import md_api
import prog
import ramguard

PKG = os.path.dirname(os.path.abspath(__file__))
EXAMPLES = os.path.join(os.path.dirname(PKG), "examples")
MARKER = jobs.CASE_MARKER              # in every case made here: jobs.py reads its step as the job's progress,
                                      # and md_api.sources() lists the case only once its state is done
LOGS = ".cases"                       # the case jobs' logs, in the workspace
SAFE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$")      # md_api.SAFE: plain folder names only
POLL_S = 2.0

# Each template's mesh sizes: the cells each one made (OpenFOAM 14, docs/validation.md and the templates'
# READMEs), and the background blocks that make it in system/blockMeshDict (None: the template's own).
TEMPLATES = {
    "ahmed-body": {
        "label": "Ahmed body",
        "about": "The standard test shape for car aerodynamics: a box with a rounded nose and a 25° slanted rear, "
                 "measured in wind tunnels many times. A half model at 40 m/s over a moving ground.",
        "blocks": "(130 15 15)",
        "size": "medium",
        "sizes": {
            "coarse": {"label": "Coarse", "cells": 480_000, "blocks": "(104 12 12)",
                       "about": "for a quick look; its drag comes out 7 % above the medium mesh's"},
            "medium": {"label": "Medium", "cells": 836_000, "blocks": None,
                       "about": "the accuracy check's mesh, with drag within 2 % of the wind tunnel's"},
            "fine": {"label": "Fine", "cells": 1_570_000, "blocks": "(164 19 19)",
                     "about": "twice the medium mesh's cells, for the same drag"},
        },
    },
    "wheel-wing": {
        "label": "Wheel and front wing",
        "about": "A front wing in ground effect ahead of a rolling 18-inch wheel, with the forces on each part. "
                 "A full model at 15 m/s over a moving ground; your own parts can take the demo geometry's place.",
        "blocks": "(60 26 14)",
        "size": "medium",
        "sizes": {
            "medium": {"label": "Medium", "cells": 920_000, "blocks": None, "about": "the template's tested mesh"},
        },
    },
}
SIZES = ["coarse", "medium", "fine"]
# Allmesh's steps, from the logs runApplication writes in the case (log.<program>), and snappyHexMesh's phases
# from its own log, latest first.
SNAPPY = ((b"Shrinking and layer addition phase", "snappyHexMesh: adding layers"),
          (b"Morphing phase", "snappyHexMesh: snapping"),
          (b"Refinement phase", "snappyHexMesh: refining"))
# What a copy leaves out: the template's accuracy check, and anything a run made there.
SKIP = {"Allvalidate", "postProcessing", "polyMesh", "extendedFeatureEdgeMesh", "dynamicCode", "__pycache__"}


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def found(name):
    """Is template `name` here (its folder with its Allmesh)?"""
    return name in TEMPLATES and os.path.isfile(os.path.join(EXAMPLES, name, "Allmesh"))


def listing():
    """The templates this engine has, for GET /templates: name, label, about, default size, sizes."""
    return [{"name": n, "label": t["label"], "about": t["about"], "size": t["size"],
             "sizes": [{"name": s, "label": v["label"], "cells": v["cells"], "about": v["about"]}
                       for s, v in t["sizes"].items()]}
            for n, t in TEMPLATES.items() if found(n)]


def made_here(case):
    """Did a case job make this folder (it holds the marker, and isn't a link to somewhere else)?"""
    return os.path.isdir(case) and not os.path.islink(case) and os.path.isfile(os.path.join(case, MARKER))


def refusal(name, replace=False):
    """Why <cases>/<name> can't be made now, as (code, message) with no paths, or None."""
    if not SAFE.match(name):
        return "bad-request", "a case name is letters, digits and _ . - (not . or - first), at most 80 characters"
    s = config.settings()
    case = os.path.join(s["cases"], name)
    real, ws = os.path.realpath(case), os.path.realpath(s["workspace"])
    if real == ws or ws.startswith(real + os.sep):
        return "bad-request", f"{name} is the engine's workspace folder; pick another name"
    if not os.path.lexists(case):
        return None
    if made_here(case):
        if replace:
            return None
        return "exists", (f"a case named {name} exists already (made from a template here); pick another name, "
                          "or replace it")
    return "exists", f"a case named {name} exists already; pick another name (a case you made is never changed)"


def problem(template, size):
    """What's wrong with a template and size, as (code, message), or None."""
    if not found(template):
        return "not-found", f"no template {template[:40]} here"
    t = TEMPLATES[template]
    if size not in t["sizes"]:
        return "bad-request", f"the {t['label']} template has no {size[:20]} mesh; its sizes: {', '.join(t['sizes'])}"
    return None


def start(template, size, name, replace=False):
    """Start a case job (POST /jobs, kind "case"): the job, or a refusal, as md_api's other starts answer."""
    why = problem(template, size) or refusal(name, replace)
    if why:
        return md_api._refuse(*why)
    ws = config.settings()["workspace"]
    config.ensure_workspace(ws)
    os.makedirs(os.path.join(ws, LOGS), mode=0o700, exist_ok=True)
    cmd = [sys.executable, os.path.join(PKG, "templates.py"), "make", template, name, "--size", size]
    return md_api._submit("case", {"template": template, "size": size, "name": name, "replace": replace}, name,
                          cmd + (["--replace"] if replace else []), log=f"{LOGS}/{name}.log",
                          ram=(TEMPLATES[template]["sizes"][size]["cells"], "mesh"))


# --------------------------------------------------------------------------
# making a case (the job's command, and the CLI's)

class Status:
    """The marker file: which template made the case, and where the making is (the job's progress)."""

    def __init__(self, case, template, size):
        self.path = os.path.join(case, MARKER)
        self.doc = {"madeBy": "Mesh Doctor", "template": template, "size": size, "created": now(),
                    "state": "running", "step": "", "time": now(), "cells": None}

    def step(self, step):
        if step != self.doc["step"]:
            self.doc.update(step=step, time=now())
            self._write()

    def end(self, state, cells=None):
        self.doc.update(state=state, time=now(), cells=cells, **({"step": "done"} if state == "done" else {}))
        self._write()

    def _write(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.doc, f, indent=1)
        os.replace(tmp, self.path)


class Watch:
    """Which step Allmesh is at: the newest log.<program> in the case, and snappyHexMesh's phase from its log."""

    def __init__(self, case):
        self.case, self.read, self.phase = case, 0, SNAPPY[-1][1]

    def step(self):
        has = lambda p: os.path.exists(os.path.join(self.case, "log." + p))
        for program in ("checkMesh", "snappyHexMesh", "blockMesh", "surfaceFeatures"):
            if has(program):
                return self._snappy() if program == "snappyHexMesh" else program
        return "geometry"

    def _snappy(self):
        try:
            with open(os.path.join(self.case, "log.snappyHexMesh"), "rb") as f:
                f.seek(self.read)
                new = f.read()
        except OSError:
            return self.phase
        whole = new[:new.rfind(b"\n") + 1]          # a line still being written is read next time
        self.read += len(whole)
        self.phase = next((step for line, step in SNAPPY if line in whole), self.phase)
        return self.phase


def _skip(src):
    def skip(folder, names):
        top = os.path.samefile(folder, src)
        return [n for n in names if n in SKIP or n.startswith(("log.", "processor"))
                or n.endswith((".stl", ".eMesh", ".foam", ".pyc")) or (top and n.replace(".", "", 1).isdigit())]
    return skip


def _blocks(case, old, new):
    """Set the background mesh's blocks in system/blockMeshDict (the size); False if the template's aren't there."""
    path = os.path.join(case, "system", "blockMeshDict")
    with open(path, encoding="utf-8") as f:
        text = f.read()
    if text.count(old) != 1:
        return False
    with open(path, "w", encoding="utf-8") as f:
        f.write(text.replace(old, new))
    return True


def _say(text):
    print(text, flush=True)


def make(template, name, size, replace=False):
    """Copy the template into <cases>/<name>, set its size, and run its Allmesh; 0 when the case has its mesh."""
    t, s = TEMPLATES[template], TEMPLATES[template]["sizes"][size]
    cases = config.settings()["cases"]
    case = os.path.join(cases, name)
    why = refusal(name, replace)
    if why:
        _say(why[1])
        return 1
    if os.path.lexists(case):
        _say(f"replacing {name}, which a template made here before")
        shutil.rmtree(case)
    os.makedirs(cases, exist_ok=True)
    try:
        os.mkdir(case)
    except FileExistsError:
        _say(f"a case named {name} exists already; pick another name")
        return 1
    status = Status(case, template, size)

    def stop(sig, frame):                       # cancelled: say so in the marker, then end as the signal would
        status.end("cancelled")
        sys.exit(128 + sig)
    before = signal.getsignal(signal.SIGTERM)
    signal.signal(signal.SIGTERM, stop)
    try:
        return _build(case, name, t, s, status)
    except KeyboardInterrupt:
        status.end("cancelled")
        _say("stopped")
        return 130
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_DFL if before is None else before)


def _build(case, name, t, s, status):
    """make()'s work in the new folder: the copy, its size, then Allmesh, which the marker follows."""
    status.step("copying")
    _say(f"{name}: the {t['label']} template, {s['label'].lower()} mesh (about {s['cells']:,} cells)")
    src = os.path.join(EXAMPLES, status.doc["template"])
    shutil.copytree(src, case, ignore=_skip(src), dirs_exist_ok=True)
    if s["blocks"] and not _blocks(case, t["blocks"], s["blocks"]):
        status.end("failed")
        _say(f"the template's system/blockMeshDict has no {t['blocks']} blocks to resize")
        return 1
    status.step("geometry")
    bashrc = shlex.quote(config.settings()["bashrc"])
    p = subprocess.Popen(["bash", "-c", f"source {bashrc} >/dev/null 2>&1; "
                          "[ -n \"$WM_PROJECT_DIR\" ] || exit 2; exec sh ./Allmesh"], cwd=case, stdin=subprocess.DEVNULL)
    watch = Watch(case)
    while True:
        try:
            rc = p.wait(timeout=POLL_S)
            break
        except subprocess.TimeoutExpired:
            status.step(watch.step())
    cells = ramguard.mesh_cells(case)
    if rc != 0 or not cells:
        at = watch.step()
        status.end("failed")
        if at != "geometry":
            program = at.split(":")[0]
            _say(f"the mesh failed at {program}: see log.{program} in the case's folder")
        elif rc == 2:
            _say(f"OpenFOAM's environment didn't load: check the bashrc setting ({prog.name()} config)")
        else:
            _say("the mesh failed while making the geometry: see the job's log")
        return 1
    status.end("done", cells)
    _say(f"{name}: {cells:,} cells, ready in the cases folder")
    return 0


def _print_templates():
    _say(f"Templates ({prog.name()} new <template> <name> [--size S]):")
    for t in listing():
        _say(f"\n  {t['name']}: {t['label']}. {t['about']}")
        for s in t["sizes"]:
            mark = " (the default)" if s["name"] == t["size"] else ""
            _say(f"    --size {s['name']:<7} about {s['cells']:,} cells{mark}: {s['about']}")


def main(argv):
    job = argv[:1] == ["make"]
    args = argv[1:] if job else argv
    if not args:
        _print_templates()
        return 0
    if args[0] in ("-h", "--help") or len(args) < 2:
        print(prog.text(__doc__))
        return 0 if args[:1] in (["-h"], ["--help"]) else 2
    template, name, rest = args[0], args[1], args[2:]
    replace = "--replace" in rest
    size = rest[rest.index("--size") + 1] if "--size" in rest[:-1] else TEMPLATES.get(template, {}).get("size", "")
    why = problem(template, size) or refusal(name, replace)
    if why:
        sys.exit(why[1])
    if not job:                                 # a job's memory was checked when it was admitted (jobs.submit)
        ok, msg = ramguard.check_cells(TEMPLATES[template]["sizes"][size]["cells"], "mesh")
        if not ok:
            sys.exit(msg)
    return make(template, name, size, replace)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
