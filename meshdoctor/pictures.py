# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Pictures of a solved case's flow: ParaView's pvbatch runs the paraview-post scripts offscreen.

    python3 -m meshdoctor pictures <case> [--time T] [--kinds cuts,vortices,spots]

The case (a run Mesh Doctor made, or a case you made, in the cases folder) is only read: ParaView reads it through
a folder of links in the workspace (its constant, system and the time pictured, and an empty case.foam), and the
pictures go in the workspace too, in .pictures/<case>/<time>/, with pictures.json listing them.  Cuts need the
case's cut list (cuts.json at its root, as a case made from the Ahmed body template has); vortices and spots of
unphysical pressure on the walls (Cp below -5: a numerical error) need only the case.  The scripts' cameras need the
flow toward -x and z up.
"""
import argparse, json, math, os, re, shutil, subprocess, sys, time

import caseinfo
import config
import md_api
import prog
import selfcheck
import tplan
import transient

PKG = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(os.path.dirname(PKG), "skills", "paraview-post", "scripts")
PICTURES = ".pictures"          # in the workspace: <case>/<time>/, a set of pictures, and <case>/<time>.log
KINDS = ("cuts", "vortices", "spots")
SCRIPT = {"cuts": "cut_views.py", "vortices": "vortex_views.py", "spots": "pressure_spots.py"}
CUTS = "cuts.json"
MARK = ".meshdoctor-pictures"  # in a set (and one being made): make() replaces only a folder that has it
Q_AT_15 = (3000, 10000, 30000)  # Q levels (1/s²) that showed a car's vortices at 15 m/s; Q goes as the speed²
VIEWS = {"rear34": "from behind", "top": "from above", "side": "from the side"}
FORCE_OBJECT = re.compile(r"([A-Za-z_][\w.:-]*)\s*\{[^{}]*\btype\s+(?:forces|forceCoeffs)\s*;")
WORDS = {"U": "speed", "Cp": "pressure coefficient Cp", "Cpt": "total pressure coefficient Cp,t"}
SPOT_CP = -5                    # pressure_spots.py's LIM: a wall face with Cp below it is a spot of unphysical pressure
SPOT_VIEWS = {"closeup": "close up, with the surface mesh", "normal": "further back",
              "side": "from the side of the model"}


def _num(text):
    try:
        return math.isfinite(float(text))
    except ValueError:
        return False


def _has(folder, field):
    return any(os.path.isfile(os.path.join(folder, field + z)) for z in ("", ".gz"))


def times(case):
    """The written times with the flow (U and p) on the case's whole mesh, oldest first, as their folders say them."""
    return sorted((d for d in os.listdir(case) if _num(d) and float(d) > 0
                   and _has(os.path.join(case, d), "U") and _has(os.path.join(case, d), "p")), key=float)


def boundary(case):
    """{patch: (its type, its groups)} from constant/polyMesh/boundary."""
    text = transient.blank(transient.read(os.path.join(case, "constant", "polyMesh", "boundary")) or "")
    out = {}
    for name, body in re.findall(r"([^\s{}();]+)\s*\{([^{}]*)\}", text):
        if name != "FoamFile":
            kind = re.search(r"\btype\s+(\w+)\s*;", body)
            groups = re.search(r"\binGroups\s+(?:List<word>\s*)?\d*\s*\(([^)]*)\)", body)
            out[name] = (kind.group(1) if kind else "", groups.group(1).split() if groups else [])
    return out


def _fits(pattern, name):
    try:
        return re.fullmatch(pattern, name) is not None
    except re.error:
        return False


def _patches(texts, names):
    """The `patches` of these function objects, the first found of each, in order."""
    out = []
    for name in names:
        for text in texts:
            span = transient.block(text, name)
            m = re.search(r"\bpatches\s*\(([^)]*)\)", text[span[0]:span[1]]) if span else None
            if m:
                out += [w.strip('"') for w in m.group(1).split()]
                break
    return out


def walls(case, total=None):
    """The model's wall patches: the `patches` of its total force group's function object (caseinfo.describe's
    `total`: of its force history, the group with the most drag), else of every forces or forceCoeffs function
    object (a case without its force history, as a copy may be), in system/controlDict or system/functions; groups
    and patterns turned into the boundary's patches; [] when there are none."""
    total = total or caseinfo.describe(case)["total"]
    texts = [transient.blank(transient.read(os.path.join(case, "system", f)) or "")
             for f in ("controlDict", "functions")]
    named = _patches(texts, [total]) if total else []
    if not named:
        named = _patches(texts, [m.group(1) for t in texts for m in FORCE_OBJECT.finditer(t)])
    b, out = boundary(case), []
    for w in named:
        hit = [p for p, (_, g) in b.items() if p == w or w in g] or [p for p in b if _fits(w, p)]
        out += [p for p in hit if p not in out]
    return out


def q_levels(uinf):
    """The Q levels to draw at this speed: Q_AT_15 times (U / 15 m/s)², to two significant figures."""
    out = []
    for q in Q_AT_15:
        v = q * (uinf / 15.0) ** 2
        step = 10 ** (math.floor(math.log10(v)) - 1)
        out.append(int(round(v / step) * step))
    return out


def why_not(case, at=None):
    """Why this case can't be pictured, as (code, message) naming no folders, or None."""
    name = os.path.basename(os.path.normpath(case))
    have = times(case)
    if not have:
        return "not-ready", (f"{name} has no written result on its whole mesh to picture (a time with U and p): "
                             "solve it first")
    if at is not None and at not in have:
        return "bad-request", f"{name} has no time {at} on its whole mesh; its latest are {', '.join(have[-4:])}"
    d = caseinfo.describe(case)
    if (d["flowAxis"], d["flowSign"], d["upAxis"]) != (0, -1, 2):
        flow = ("-" if d["flowSign"] < 0 else "+") + "xyz"[d["flowAxis"]]
        return "not-ready", (f"{name}'s flow goes toward {flow}, with {'xyz'[d['upAxis']]} up: the picture scripts' "
                             "cameras need it toward -x, with z up")
    if not d["Uinf"]:
        return "not-ready", f"{name}'s free-stream speed isn't found (its 0/U), which the pictures' colours need"
    if not walls(case, d["total"]):
        return "not-ready", (f"{name}'s model isn't found: the pictures take its walls from the patches of its "
                             "force function objects (forces or forceCoeffs), and it has none")
    if not selfcheck.paraview()[1]:
        return "not-ready", ("ParaView isn't installed, or pvbatch doesn't start: Ready to solve? on the Solve "
                             "screen says how to install it")
    return None


def refusal(name, at=None):
    """Why case `name` in the cases folder can't be pictured now, as (code, message), or None."""
    case = tplan._case(name)
    return ("not-found", f"no case {name} in the cases folder") if case is None else why_not(case, at)


def plan(case, view, out, kinds, pvbatch):
    """({kind: the pvbatch command that makes its pictures, reading the links folder `view`, into out/<kind>},
    notes on what is left out)."""
    d = caseinfo.describe(case)
    name, w, uinf = os.path.basename(os.path.normpath(case)), ",".join(walls(case, d["total"])), d["Uinf"]
    foam, run, cmds, notes = os.path.join(view, "case.foam"), [pvbatch, "--force-offscreen-rendering"], {}, []
    note = f"{name}, written time {{it}}"
    for kind in kinds:
        script, into = os.path.join(SCRIPTS, SCRIPT[kind]), os.path.join(out, kind)
        if kind == "cuts":
            if not os.path.isfile(os.path.join(case, CUTS)):
                notes.append(f"no cuts: {name} has no cut list ({CUTS} at its root)")
                continue
            cmds[kind] = run + [script, foam, "reconstructed", into, os.path.join(case, CUTS), note,
                                "--walls", w, "--uinf", f"{uinf:g}"]
        elif kind == "vortices":
            cmds[kind] = run + [script, foam, into, ",".join(map(str, q_levels(uinf))), "--walls", w,
                                "--views", ",".join(VIEWS), "--note", note]
        else:
            cmds[kind] = run + [script, foam, "reconstructed", into, "spots", "--walls", w, "--uinf", f"{uinf:g}",
                                "--rho", f"{d['rho'] or 1.205:g}"]
    return cmds, notes


def listing(case, folder):
    """The pictures in a set's folder, each {file, kind, title}: each kind's PNGs, titled from the cut list, the Q
    level and the view, or the spot."""
    cuts = {}
    try:
        with open(os.path.join(case, CUTS), encoding="utf-8") as f:
            cuts = {c["name"]: c.get("title", c["name"]) for c in json.load(f)["cuts"]}
    except (OSError, ValueError, KeyError, TypeError):
        pass
    out = []
    for kind in KINDS:
        d = os.path.join(folder, kind)
        files = sorted(f for f in (os.listdir(d) if os.path.isdir(d) else []) if f.endswith(".png"))
        for f in sorted(files, key=_vortex_order) if kind == "vortices" else files:
            stem, title = f[:-4], f[:-4]
            if kind == "cuts":
                cut, _, colour = stem.rpartition("_")
                title = f"{cuts.get(cut, cut)}: {WORDS.get(colour, colour)}"
            elif kind == "vortices":
                m = re.fullmatch(r"Q([0-9.e+]+)_(\w+)", stem)
                if m:
                    title = f"Vortices, Q = {float(m.group(1)):,.0f} 1/s², {VIEWS.get(m.group(2), m.group(2))}"
            else:
                m = re.fullmatch(r".*_Cp_spot_(\w+)", stem)
                title = (f"The worst spot of unphysical pressure (Cp below {SPOT_CP}), "
                         + (SPOT_VIEWS.get(m.group(1), m.group(1)) if m else stem))
            out.append({"file": f"{kind}/{f}", "kind": kind, "title": title})
    return out


def _vortex_order(f):
    """A vortex picture's place in its set: by Q level, then by view as VIEWS has them."""
    m = re.fullmatch(r"Q([0-9.e+]+)_(\w+)\.png", f)
    if not m:
        return (math.inf, len(VIEWS), f)
    return (float(m.group(1)), list(VIEWS).index(m.group(2)) if m.group(2) in VIEWS else len(VIEWS), f)


def _replaceable(folder):
    """Whether make() may replace `folder`: none there, an empty folder, or a set (or one being made) it wrote."""
    if os.path.islink(folder):
        return False
    if not os.path.exists(folder):
        return True
    return os.path.isdir(folder) and (not os.listdir(folder) or os.path.isfile(os.path.join(folder, MARK)))


def _run(cmd, env, cwd):
    """Run a pvbatch command, its output passed on as it comes (a job's log has it): (its exit code, its output)."""
    said = []
    with subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, env=env, cwd=cwd, text=True,
                          errors="replace") as p:
        for line in p.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            said.append(line)
    return p.returncode, "".join(said)


def make(case, out, at, kinds):
    """Make a set of pictures of `case` at time `at` in folder `out`; pictures.json lists them.  A set made there
    before is replaced once the new one is whole; any other folder in the way is refused and left as it is.  The
    document; RuntimeError when no picture was made."""
    pvbatch = selfcheck.paraview()[0]
    if not pvbatch:
        raise RuntimeError("ParaView's pvbatch isn't found")
    new = out + ".new"
    for folder in (out, new):
        if not _replaceable(folder):
            raise RuntimeError(f"{folder} is in the way: it isn't a set of pictures Mesh Doctor made, so it is left "
                               "as it is")
    shutil.rmtree(new, ignore_errors=True)
    os.makedirs(new, mode=0o700)
    open(os.path.join(new, MARK), "w").close()      # first, so that a set cut short can be replaced
    view, links, cmds, notes, ran = os.path.join(new, "view"), [], {}, [], []
    env = dict(os.environ, PYTHONPATH=selfcheck.PV_PYTHONPATH)
    try:
        os.mkdir(view, 0o700)
        for d in ("constant", "system", at):        # ParaView reads the case through these links: it is only read
            links.append(os.path.join(view, d))
            os.symlink(os.path.join(os.path.abspath(case), d), links[-1])
        open(os.path.join(view, "case.foam"), "w").close()
        cmds, notes = plan(case, view, new, kinds, pvbatch)
        for kind, cmd in cmds.items():
            print(f"pictures: {kind}", flush=True)
            os.makedirs(os.path.join(new, kind))
            rc, said = _run(cmd, env, new)
            if rc:
                notes.append(f"{kind}: ParaView stopped (exit {rc}); the job's log says why")
                continue
            ran.append(kind)
            if kind == "spots" and not os.listdir(os.path.join(new, kind)):
                low = [float(v) for v in re.findall(r"\bCp (-?[0-9]+(?:\.[0-9]*)?) \.\.", said)]
                notes.append(f"no spots: no wall face has unphysical pressure (Cp below {SPOT_CP})"
                             + (f"; the lowest Cp is {min(low):.1f}" if low else ""))
    finally:
        for link in links:                          # the links first: nothing in the case is touched
            if os.path.islink(link):
                os.unlink(link)
        shutil.rmtree(view, ignore_errors=True)     # (it never follows a link)
    doc = {"case": os.path.basename(os.path.normpath(case)), "time": at, "kinds": list(kinds),
           "made": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "notes": notes,
           "pictures": listing(case, new)}
    if not doc["pictures"] and not ran:             # (a set with no spot to show is still a set)
        shutil.rmtree(new, ignore_errors=True)
        raise RuntimeError("no picture was made" + (": " + "; ".join(notes) if notes else ""))
    with open(os.path.join(new, "pictures.json"), "w") as f:
        json.dump(doc, f, indent=1)
    shutil.rmtree(out, ignore_errors=True)
    os.replace(new, out)
    return doc


def start(name, at=None, kinds=KINDS):
    """Start a pictures job (POST /jobs, kind "pictures"): the job, or a refusal, as md_api's other starts answer."""
    why = refusal(name, at)
    if why:
        return md_api._refuse(*why)
    ws = config.settings()["workspace"]
    config.ensure_workspace(ws)
    os.makedirs(os.path.join(ws, PICTURES, name), mode=0o700, exist_ok=True)
    case = tplan._case(name)
    at = at or times(case)[-1]
    rel = f"{PICTURES}/{name}/{at}"
    cmd = [sys.executable, os.path.join(PKG, "pictures.py"), case, "--time", at, "--kinds", ",".join(kinds),
           "--out", os.path.join(ws, rel)]
    return md_api._submit("pictures", {"name": name, "time": at, "kinds": list(kinds)}, name, cmd,
                          log=f"{rel}.log", result=f"{rel}/pictures.json", ram=(case, "pictures"))


def main(argv=None):
    ap = argparse.ArgumentParser(prog=prog.name() + " pictures", description=__doc__.split("\n\n")[0])
    ap.add_argument("case", help="a case with a written result: its name in the cases folder, or its folder (only "
                                 "read)")
    ap.add_argument("--time", help="the written time to picture (default: the latest on its whole mesh)")
    ap.add_argument("--kinds", default=",".join(KINDS), help="what to make, of %(default)s (default: all)")
    ap.add_argument("--out", help="the set's folder (default: the workspace's .pictures/<case>/<time>), replaced only "
                                  "if it holds a set made before")
    a = ap.parse_args(argv)
    kinds = [k for k in a.kinds.split(",") if k]
    if not kinds or any(k not in KINDS for k in kinds):
        sys.exit(f"pictures: --kinds takes {', '.join(KINDS)}")
    case = a.case if os.path.isdir(a.case) else tplan._case(a.case)
    if not case:
        sys.exit(f"pictures: no case {a.case} in the cases folder")
    why = why_not(case, a.time)
    if why:
        sys.exit(f"pictures: {why[1]}")
    at = a.time or times(case)[-1]
    out = a.out or os.path.join(config.settings()["workspace"], PICTURES, os.path.basename(os.path.normpath(case)), at)
    try:
        doc = make(case, out, at, kinds)
    except (RuntimeError, OSError) as e:
        sys.exit(f"pictures: {e}")
    for n in doc["notes"]:
        print(f"pictures: {n}")
    print(f"pictures: {len(doc['pictures'])} made, in {out}")


if __name__ == "__main__":
    main(sys.argv[1:])
