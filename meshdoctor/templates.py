# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""New cases from the templates in examples/: a copy in the cases folder under a new name, meshed by its Allmesh.
A solve of a case you made makes a new case the same way: a copy of its mesh and settings, not its results (copy()).

    python3 -m meshdoctor new                                       the templates and their mesh sizes
    python3 -m meshdoctor new <template> <name> [--size S] [--replace]

A new case always goes in a new folder: Mesh Doctor never changes a case you made.  A name that is taken is
refused, except a case made here before (it holds a .meshdoctor-case.json), which --replace deletes and makes
again, as after a mesh that failed.  The free memory is checked first (the RAM guard's mesh figure).  The app
starts the same thing as a `case` job (POST /api/v1/jobs), which runs `templates.py make`; a solve job with a
template makes its case the same way (build()), then solves it (solve.py).
"""
import json, os, re, shlex, shutil, signal, subprocess, sys, time

import config
import diskguard
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
# What a copy of a case you made leaves out (copy()): what its runs wrote beside its mesh and settings.
RESULTS = {"postProcessing", "dynamicCode", "VTK", "__pycache__"}


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
    """The marker file: what the case was made from (a template and its size, or the case it is a copy of: copyOf),
    and where the making is (the job's progress)."""

    def __init__(self, case, **origin):
        self.path = os.path.join(case, MARKER)
        self.doc = {"madeBy": "Mesh Doctor", **origin, "created": now(),
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


def _results(src, case):
    """copy()'s ignore: in the case's own folder, the times past 0, the split, the logs and what function objects
    wrote; anywhere in it, Mesh Doctor's own files (a marker, a run's status) and a link round to a folder the copy
    is walking through, or to the copy (_round)."""
    into = os.path.realpath(case)

    def skip(folder, names):
        top = os.path.samefile(folder, src)
        walked = _walked(src, folder)
        return [n for n in names if n.startswith(".meshdoctor") or _round(os.path.join(folder, n), walked, into)
                or (top and (n in RESULTS or n.startswith(("log.", "processor")) or _later(n)))]
    return skip


def _walked(src, folder):
    """The real folders a walk from case `src` down to `folder` goes through: src's, and each one on the way."""
    path, out = src, [os.path.realpath(src)]
    rel = os.path.relpath(folder, src)
    for part in [] if rel == os.curdir else rel.split(os.sep):
        path = os.path.join(path, part)
        out.append(os.path.realpath(path))
    return out


def _round(path, walked, into):
    """Is `path` a link round to one of the `walked` folders or a folder holding one (again -> ., up -> .., the cases
    folder), or to the copy (`into`), a folder holding it or one in it?  copytree follows links, so the copy has files
    of its own a solve can't write through; it would follow these round and round, copying the case into itself
    some 40 levels deep, until the system says too many levels of links or the disk is full."""
    if not os.path.islink(path):
        return False
    to = os.path.realpath(path)

    def holds(a, b):                            # a is the folder b, or one b is in
        return b == a or b.startswith(a.rstrip(os.sep) + os.sep)
    return any(holds(to, w) for w in walked) or holds(to, into) or holds(into, to)


def _later(name):
    """Is this the name of a time folder past 0, a written result?"""
    try:
        return float(name) > 0
    except ValueError:
        return False


def copy(src, case):
    """Copy case `src`'s mesh and settings, not its results, into the new folder `case` (its marker is in it): the
    copy's cell count.  Its initial fields are its 0 folder, or 0.orig when it has no 0, as its Allrun would copy."""
    shutil.copytree(src, case, ignore=_results(src, case), dirs_exist_ok=True, ignore_dangling_symlinks=True)
    zero, orig = os.path.join(case, "0"), os.path.join(case, "0.orig")
    if not os.path.isdir(zero) and os.path.isdir(orig):
        shutil.copytree(orig, zero)
    return ramguard.mesh_cells(case)


def copy_size(src, case=None):
    """The bytes copy() writes copying case `src` into the new folder `case` (by default one in the same folder that
    no case can be named, for a copy not yet named): what it copies, links followed as it follows them, and 0.orig
    once more when there's no 0, which it copies to 0 too."""
    case = case or os.path.join(os.path.dirname(os.path.abspath(src)), ".meshdoctor-copy")
    total = diskguard.size(src, _results(src, case))
    zero, orig = os.path.join(src, "0"), os.path.join(src, "0.orig")
    if not os.path.isdir(zero) and os.path.isdir(orig):
        total += diskguard.size(orig)
    return total


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
    status = Status(case, template=template, size=size)

    def stop(sig, frame):                       # cancelled: say so in the marker, then end as the signal would
        status.end("cancelled")
        sys.exit(128 + sig)
    before = signal.getsignal(signal.SIGTERM)
    signal.signal(signal.SIGTERM, stop)
    try:
        why = build(case, name, t, s, status)
        if why:
            _say(why)
        return 1 if why else 0
    except KeyboardInterrupt:
        status.end("cancelled")
        _say("stopped")
        return 130
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_DFL if before is None else before)


def build(case, name, t, s, status):
    """make()'s work in the new folder, and a solve job's with a template (solve.py): the copy, its size, then Allmesh,
    which `status` follows (the marker; for a solve, the marker and the run's status file).  None once the case has
    its mesh, else why not, naming no folders."""
    status.step("copying")
    _say(f"{name}: the {t['label']} template, {s['label'].lower()} mesh (about {s['cells']:,} cells)")
    src = os.path.join(EXAMPLES, status.doc["template"])
    shutil.copytree(src, case, ignore=_skip(src), dirs_exist_ok=True)
    if s["blocks"] and not _blocks(case, t["blocks"], s["blocks"]):
        status.end("failed")
        return f"the template's system/blockMeshDict has no {t['blocks']} blocks to resize"
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
        status.step(at)                         # where it failed, which a quick Allmesh ends before a poll sees
        status.end("failed")
        if at != "geometry":
            program = at.split(":")[0]
            return f"the mesh failed at {program}: see log.{program} in the case's folder"
        if rc == 2:
            return f"OpenFOAM's environment didn't load: check the bashrc setting ({prog.name()} config)"
        return "the mesh failed while making the geometry: see the job's log"
    status.end("done", cells)
    _say(f"{name}: {cells:,} cells, ready in the cases folder")
    return None


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
