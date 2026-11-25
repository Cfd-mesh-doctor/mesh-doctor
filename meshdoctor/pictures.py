# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Pictures of a solved case's flow: ParaView's pvbatch runs the paraview-post scripts offscreen.

    python3 -m meshdoctor pictures <case> [--time T] [--kinds cuts,vortices,spots,times,fastest] [--mean]

The case (a run Mesh Doctor made, or a case you made, in the cases folder) is only read: ParaView reads it through
a folder of links in the workspace (its constant, system and the time pictured, and an empty case.foam), and the
pictures go in the workspace too, in .pictures/<case>/<time>/, with pictures.json listing them.  A time still split
onto the case's processes (on several processes a run joins only the latest of each stretch) is joined first, into the
run's own folder (reconstructPar -time), when Mesh Doctor made the run: the one thing a picture writes in a case, as
its solve would, so that the run then lists it as joined.  A case you made is read as it is, split (ParaView's
Decomposed Case): each processor folder through links of its own, with its constant and only that time.  Cuts follow the
case's cut list (cuts.json at its root, as a case made from the Ahmed body template has), or without one are made
from its model's size; vortices and spots of unphysical pressure on the walls (Cp below -5: a numerical error) need
only the case.  A cut over time (the kind times, not made unless asked) pictures the first cut's speed at each written
time up to the one pictured, at most MAX_TIMES evenly picked, each read as it is kept: joined, or split onto the
processes, as they are (none is joined for it).  The cells that set the time step (the kind fastest, not made
unless asked) are those with the highest Courant number at the time pictured, found as a transient plan finds them
(tplan.py, Mesh Doctor's foamCourantCells, from that time's face flux) and written alone by foamToVTK -cellSet, through
links of their own in the set's folder (on a split case without the whole mesh it was split from, each processor's own
set, in parallel), then drawn with the walls: the whole model from three sides, and each of the fastest places close
up.  The scripts' cameras need the flow toward -x and z up.  With --mean
they picture a transient run's mean flow (UMean and pMean, written once its averaging is on) in place of the flow at
that time, into .pictures/<case>/<time>_mean/, and each cut shows how much the speed swings about it too (from
UPrime2Mean).  A computer's first set starts with the vortex script's self test (a test vortex that
must come out red), in .pictures/.selftest/, which is kept once it has passed.  As it goes, a set being made says its
step and how far it is in a status file beside it (<set>.status.json), from how long each step took on the coarse
Ahmed body, which its job's progress reads (jobs.progress).  The API serves the sets (sets(), one(), picture(),
delete()): only a picture a set's list names is read, in the set's own folders, never through a link.
"""
import argparse, json, math, os, re, shlex, shutil, stat, subprocess, sys, time

import caseinfo
import config
import diskguard
import jobs
import md_api
import prog
import selfcheck
import tplan
import transient

PKG = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(os.path.dirname(PKG), "skills", "paraview-post", "scripts")
PICTURES = ".pictures"          # in the workspace: <case>/<time>/ (<time>_mean/: a mean flow's), a set, and its .log
KINDS = ("cuts", "vortices", "spots")   # what a set has unless asked otherwise
ALL_KINDS = KINDS + ("times", "fastest")    # a cut over time: the first cut's speed at each written time (API
                                            # 1.20); the cells that set the time step (API 1.21)
SCRIPT = {"cuts": "cut_views.py", "vortices": "vortex_views.py", "spots": "pressure_spots.py", "times": "cut_views.py",
          "fastest": "fastest_cells.py"}
MAX_TIMES = 50                          # the most written times a cut over time pictures, evenly picked
CUTS = "cuts.json"
MARK = ".meshdoctor-pictures"  # in a set (and one being made): make() replaces only a folder that has it
MEAN = ("UMean", "pMean")       # a transient run's mean flow (transient.AVERAGE), pictured in place of U and p
SELFTEST = ".selftest"          # in PICTURES: the vortex script's self test (a dot folder: no case is named so)
Q_AT_15 = (3000, 10000, 30000)  # Q levels (1/s²) that showed a car's vortices at 15 m/s; Q goes as the speed²
VIEWS = {"rear34": "from behind", "top": "from above", "side": "from the side"}
FORCE_OBJECT = re.compile(r"([A-Za-z_][\w.:-]*)\s*\{[^{}]*\btype\s+(?:forces|forceCoeffs)\s*;")
WORDS = {"U": "speed", "Cp": "pressure coefficient Cp", "Cpt": "total pressure coefficient Cp,t",
         "Urms": "how much the speed swings about its mean (rms / free-stream speed)"}
SPOT_CP = -5                    # pressure_spots.py's LIM: a wall face with Cp below it is a spot of unphysical pressure
SPOT_VIEWS = {"closeup": "close up, with the surface mesh", "normal": "further back",
              "side": "from the side of the model"}
SET = re.compile(r"^[0-9][0-9.eE+-]{0,39}(_mean)?$")              # a set's folder: the time pictured (_mean: its mean)
FILE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}\.png$")     # a picture's file, in its kind's folder of its set
TIME_NAME = re.compile(r"^[0-9][0-9.eE+-]{0,39}$")                   # a written time, as its folder names it
AT_TIME = re.compile(r"(.+)_U_at_([0-9][0-9.eE+-]{0,39})")           # a cut over time's picture: <cut>_U_at_<time>
PNG = b"\x89PNG\r\n\x1a\n"      # the first bytes of every PNG file
MAX_PNG = 32 << 20              # the largest picture served: ParaView's 1920 x 1080 PNGs are well under 1 MB
AUTO_CUTS = 7                   # the pictures of the cuts cut_views.py makes from the model's size: 3, 2 and 2 colours
FLOW = ("U", "p")               # the flow a picture reads (MEAN in their place for a mean flow's)
PROC = re.compile(r"^processor[0-9]+$")     # a processor folder of a case split onto its processes
FAST_VIEWS = {"side": "from the side", "top": "from above", "front34": "from the front"}   # fastest_cells.py's views
PLACES = 3                      # the fastest places that the cells that set the time step show close up, one each
FAST_FILE = re.compile(r"fastest_(?:(" + "|".join(FAST_VIEWS) + r")|place([0-9]{1,3}))")   # their pictures' names
FAST_DOC = "fastest.json"       # in a set: the count of the cells that set the time step and each place's words
FAST_MEAN = ("bad-request", "the cells that set the time step are found from a written time's own flow, not from its "
                            "mean flow: picture them without the mean flow")
STATUS = ".status.json"         # beside a set being made (<set>.status.json): its step and how far it is, for its job
# How long a picture job's steps took, in seconds, in a real job on the coarse Ahmed body's 0.48M cells (20.4 s from
# joining its time to done), for how far a job is: joining a time split onto a run's processes (with OpenFOAM's
# environment), the self test, finding the cells that set the time step and looking for spots, each as a whole; each
# picture of the other kinds (a cut over time's, each a time's cut, as a cut's)
COST = {"join": 1.4, "selftest": 2.0, "find": 2.6, "spots": 1.0}
PER_PICTURE = {"cuts": 1.0, "times": 1.0, "vortices": 0.5, "fastest": 0.35}
DRAWING = {"cuts": "drawing the cuts", "vortices": "drawing the vortices",
           "spots": "looking for spots of unphysical pressure on the walls", "times": "drawing a cut over time",
           "fastest": "drawing the cells that set the time step"}     # each kind's step, as its job says it


def _num(text):
    try:
        return math.isfinite(float(text))
    except ValueError:
        return False


def _has(folder, field):
    return any(os.path.isfile(os.path.join(folder, field + z)) for z in ("", ".gz"))


def _fields(folder, fields):
    return all(_has(folder, f) for f in fields)


def processors(case):
    """The processor folders of a case split onto its processes, by number (processor0, processor1, ...); [] when it
    isn't split."""
    try:
        names = [n for n in os.listdir(case) if PROC.match(n) and os.path.isdir(os.path.join(case, n))]
    except OSError:
        return []
    return sorted(names, key=lambda n: int(n[len("processor"):]))


def kept(case, fields=FLOW):
    """{time: how it is kept} of the written times that hold these fields (the flow, U and p, by default), oldest
    first, as their folders say them: "joined" on the case's whole mesh, else "split" in every one of its processor
    folders.  A time a picture job is still joining (jobs.JOINING in it) is split."""
    def written(folder):
        try:
            return [d for d in os.listdir(folder) if _num(d) and float(d) > 0]
        except OSError:
            return []
    out = {d: "joined" for d in written(case) if _fields(os.path.join(case, d), fields)
           and not os.path.lexists(os.path.join(case, d, jobs.JOINING))}
    procs = processors(case)
    for d in written(os.path.join(case, procs[0])) if procs else []:
        if d not in out and all(_fields(os.path.join(case, p, d), fields) for p in procs):
            out[d] = "split"
    return dict(sorted(out.items(), key=lambda kv: float(kv[0])))


def times(case):
    """The written times with the flow (U and p) on the case's whole mesh, joined, oldest first, as their folders say
    them."""
    return [t for t, how in kept(case).items() if how == "joined"]


def mean_times(case):
    """Those of times() that hold a transient run's mean flow too (UMean and pMean), oldest first."""
    return [t for t, how in kept(case, FLOW + MEAN).items() if how == "joined"]


def latest(case, mean=False):
    """The latest written time with the flow (with `mean`, a transient run's mean flow too), joined or split; None
    when it has none."""
    return next(reversed(kept(case, FLOW + MEAN if mean else FLOW)), None)


def ours(case):
    """Did Mesh Doctor make this case (its marker says so), in a folder of its own, not one reached through a link?
    Only then may a picture job join a time of it in its folder: a case you made is only ever read."""
    return not os.path.islink(os.path.normpath(case)) and md_api.made(case) is not None


def how(case, at):
    """How a picture job reads written time `at`: "joined", on the case's whole mesh; "join", split onto the processes
    of a run Mesh Doctor made (ours()), which it joins first, into the run's own folder (join_time()); or "split",
    split in a case you made, which ParaView reads as it is (make())."""
    if at in times(case):
        return "joined"
    return "join" if ours(case) else "split"


def strip(case, at, mean=False):
    """The written times a cut over time pictures, up to `at`, oldest first: (those times, whether ParaView reads them
    split, how many the case keeps up to `at`).  Each one kept with the flow (and the mean flow, with `mean`), at most
    MAX_TIMES of them, evenly picked from the first to the last.  They are read split, as they are, when any of them
    isn't joined (a run on several processes keeps each one in its processor folders and joins only the latest of each
    stretch), so none is joined for it, and then only those in every processor folder are pictured."""
    fields = FLOW + MEAN if mean else FLOW
    have = {t: h for t, h in kept(case, fields).items() if float(t) <= float(at)}
    split = any(h == "split" for h in have.values())
    procs = processors(case)
    upto = [t for t in have if not split or all(_fields(os.path.join(case, p, t), fields) for p in procs)]
    if MAX_TIMES < 2:                               # the latest alone (or none)
        upto = upto[len(upto) - max(MAX_TIMES, 0):]
    elif len(upto) > MAX_TIMES:                     # the first and the latest, and evenly between
        step = (len(upto) - 1) / (MAX_TIMES - 1)
        upto = [upto[round(i * step)] for i in range(MAX_TIMES)]
    return upto, split, len(have)


def set_name(at, mean=False):
    """The folder of a set of pictures of time `at`, or of its mean flow."""
    return at + ("_mean" if mean else "")


def boundary(case, proc=None):
    """{patch: (its type, its groups)} from the whole mesh's constant/polyMesh/boundary, or with `proc`, that processor
    folder's (a case split onto its processes: it lists every patch of the whole mesh), less its processor patches."""
    where = (case,) if proc is None else (case, proc)
    text = transient.blank(transient.read(os.path.join(*where, "constant", "polyMesh", "boundary")) or "")
    out = {}
    for name, body in re.findall(r"([^\s{}();]+)\s*\{([^{}]*)\}", text):
        if name != "FoamFile":
            kind = re.search(r"\btype\s+(\w+)\s*;", body)
            groups = re.search(r"\binGroups\s+(?:List<word>\s*)?\d*\s*\(([^)]*)\)", body)
            if kind and kind.group(1).startswith("processor"):     # processor, processorCyclic: between processes
                continue
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


def named(case, total=None):
    """The patches, groups or patterns that name the model: the `patches` of its total force group's function object
    (caseinfo.describe's `total`: of its force history, the group with the most drag), else of every forces or
    forceCoeffs function object (a case without its force history, as a copy may be), in system/controlDict or
    system/functions."""
    total = total or caseinfo.describe(case)["total"]
    texts = [transient.blank(transient.read(os.path.join(case, "system", f)) or "")
             for f in ("controlDict", "functions")]
    out = _patches(texts, [total]) if total else []
    return out or _patches(texts, [m.group(1) for t in texts for m in FORCE_OBJECT.finditer(t)])


def walls(case, total=None, split=False):
    """The model's wall patches: what names it (named()), groups and patterns turned into the patches of the boundary
    of the mesh its time is read on: with `split`, each processor folder's (as processor0's lists them), else the whole
    mesh's; else of the other one when that has none of them (a case split onto its processes may have no whole mesh,
    or only the background mesh it was meshed from in parallel); [] when there are none."""
    names, procs = named(case, total), processors(case)
    for proc in ([procs[0]] if procs and split else []) + [None] + ([procs[0]] if procs and not split else []):
        b, out = boundary(case, proc), []
        for w in names:
            hit = [p for p, (_, g) in b.items() if p == w or w in g] or [p for p in b if _fits(w, p)]
            out += [p for p in hit if p not in out]
        if out:
            return out
    return []


def q_levels(uinf):
    """The Q levels to draw at this speed: Q_AT_15 times (U / 15 m/s)², to two significant figures."""
    out = []
    for q in Q_AT_15:
        v = q * (uinf / 15.0) ** 2
        step = 10 ** (math.floor(math.log10(v)) - 1)
        out.append(int(round(v / step) * step))
    return out


def why_not(case, at=None, mean=False):
    """Why this case (its mean flow, with `mean`) can't be pictured, as (code, message) naming no folders, or None."""
    name = os.path.basename(os.path.normpath(case))
    how_kept = kept(case)
    have = list(how_kept)
    if not have:
        return "not-ready", (f"{name} has no written result to picture (a time with U and p, on its whole mesh or "
                             "split onto its processes): solve it first")
    if at is not None and at not in have:
        return "bad-request", (f"{name} has no written time {at} with its flow (U and p); its latest are "
                               f"{', '.join(have[-4:])}")
    means = list(kept(case, FLOW + MEAN)) if mean else []
    if mean and not means:
        return "not-ready", (f"{name} has no mean flow (UMean and pMean): a transient run writes it in each time once "
                             "its averaging is on, from when its forces have settled")
    if mean and at is not None and at not in means:
        return "bad-request", (f"{name}'s time {at} has no mean flow (UMean and pMean); its latest times with one: "
                               f"{', '.join(means[-4:])}")
    d = caseinfo.describe(case)
    if (d["flowAxis"], d["flowSign"], d["upAxis"]) != (0, -1, 2):
        flow = ("-" if d["flowSign"] < 0 else "+") + "xyz"[d["flowAxis"]]
        return "not-ready", (f"{name}'s flow goes toward {flow}, with {'xyz'[d['upAxis']]} up: the picture scripts' "
                             "cameras need it toward -x, with z up")
    if not d["Uinf"]:
        return "not-ready", f"{name}'s free-stream speed isn't found (its 0/U), which the pictures' colours need"
    if not walls(case, d["total"], how_kept.get(at or latest(case, mean)) == "split"):
        names = named(case, d["total"])
        if names:
            return "not-ready", (f"{name}'s model isn't found: its force function objects name "
                                 f"{', '.join(names[:4])}, and its mesh has no such patch (in its "
                                 "constant/polyMesh/boundary, or processor0's when it is split onto its processes)")
        return "not-ready", (f"{name}'s model isn't found: the pictures take its walls from the patches of its "
                             "force function objects (forces or forceCoeffs), and it has none")
    if not selfcheck.paraview()[1]:
        return "not-ready", ("ParaView isn't installed, or pvbatch doesn't start: Ready to solve? on the Solve "
                             "screen says how to install it")
    return None


def refusal(name, at=None, mean=False):
    """Why case `name` in the cases folder can't be pictured now, as (code, message), or None."""
    case = tplan._case(name)
    return ("not-found", f"no case {name} in the cases folder") if case is None else why_not(case, at, mean)


def how_many(case, kinds, at=None, mean=False):
    """About how many pictures a set of these kinds makes of `case` at time `at`: one per colour of each cut in its cut
    list (else AUTO_CUTS, of 3 cuts), with `mean` one more a cut (how much the speed swings), one per vortex level and
    view, the worst spot's three views, one per time of a cut over time (strip()), and the cells that set the
    time step from three sides and their PLACES fastest places close up."""
    n = 0
    for kind in kinds:
        if kind == "cuts":
            try:
                with open(os.path.join(case, CUTS), encoding="utf-8") as f:
                    n += sum(len(c["colours"]) + bool(mean) for c in json.load(f)["cuts"]) or AUTO_CUTS + 3 * mean
            except (OSError, ValueError, KeyError, TypeError):
                n += AUTO_CUTS + 3 * bool(mean)
        elif kind == "times":
            n += len(strip(case, at, mean)[0]) if at else 0
        elif kind == "fastest":
            n += len(FAST_VIEWS) + PLACES
        else:
            n += len(Q_AT_15) * len(VIEWS) if kind == "vortices" else len(SPOT_VIEWS)
    return n


def _join_of(case, at):
    """What a picture job writes into the run's own folder when it joins time `at` first (how(): split onto the
    processes of a run Mesh Doctor made): (MB, the run's folder, its processes), from that time's fields as they are
    split; None when it doesn't join it."""
    if how(case, at) != "join":
        return None
    procs = processors(case)
    return diskguard.join_mb(sum(diskguard.size(os.path.join(case, p, at)) for p in procs)), case, len(procs)


def _disk(case, name, kinds, at, mean=False):
    """What a pictures job of time `at` of `case` (its mean flow, with `mean`) writes, for the disk guard: ([(MB,
    folder, what needs it, with its verb)], the join (_join_of) or None).  Its set of how_many() pictures in the
    workspace, and a time it joins first in the run's own folder: one check of both when the two are on one disk."""
    n = how_many(case, kinds, at, mean)
    pictures = (diskguard.pictures_mb(n), root(), f"the set of about {n} pictures of {name} needs")
    join = _join_of(case, at)
    if join is None:
        return [pictures], None
    joining = f"joining its written time {at} from its {join[2]} processes into its folder"
    if diskguard.same_disk(case, root()):
        return [(pictures[0] + join[0], root(), f"the set of about {n} pictures of {name} and {joining} need")], join
    return [pictures, (join[0], case, f"{joining} needs")], join


def disk_of(name, at=None, kinds=KINDS, mean=False):
    """GET /disk/pictures: what a pictures job writes, as start's disk guard counts it: ({"set": (MB, the workspace's
    folder of sets), "join": _join_of()'s, "time": the time pictured}, None), or (None, the refusal start would
    give)."""
    why = FAST_MEAN if mean and "fastest" in kinds else refusal(name, at, mean)
    if why:
        return None, md_api._refuse(*why)
    case = tplan._case(name)
    at = at or latest(case, mean)
    n = how_many(case, kinds, at, mean)
    return {"set": (diskguard.pictures_mb(n), root()), "join": _join_of(case, at), "time": at}, None


def plan(case, view, out, kinds, pvbatch, mean=False, since=None, split=False, over_time=None, fastest=None):
    """({kind: the pvbatch command that makes its pictures, reading the links folder `view`, into out/<kind>},
    notes on what is left out).  With `mean`, of the mean flow, averaged from time `since` (s; None: not known);
    with `split`, of a time read split onto the case's processes (each script's Decomposed Case); `over_time`: (the links
    folder of a cut over time's times, whether they are read split), without which it has none; `fastest`: (the folder
    of the VTK files of the cells that set the time step, the FAST_DOC that says their places), without which they
    have none."""
    read = "decomposed" if split else "reconstructed"
    d = caseinfo.describe(case)
    name, w, uinf = os.path.basename(os.path.normpath(case)), ",".join(walls(case, d["total"], split)), d["Uinf"]
    foam, run, cmds, notes = os.path.join(view, "case.foam"), [pvbatch, "--force-offscreen-rendering"], {}, []
    note = f"{name}, written time {{it}}"
    if mean:
        note = f"{name}, the mean flow " + ("" if since is None else f"from {since:.4g} s ") + "to {it} s"
    for kind in kinds:
        script, into = os.path.join(SCRIPTS, SCRIPT[kind]), os.path.join(out, kind)
        if (kind == "times" and over_time is None) or (kind == "fastest" and (fastest is None or mean)):
            continue
        if kind == "fastest":
            cmds[kind] = run + [script, foam, read, into, fastest[0], "--walls", w, "--places", fastest[1],
                                "--note", note]
            continue
        if kind in ("cuts", "times"):
            spec = os.path.join(case, CUTS)
            if not os.path.isfile(spec):                # cut_views makes three from the walls' bounds
                spec = "auto"
                said = f"cuts made from the model's size: {name} has no cut list ({CUTS} at its root)"
                notes += [] if said in notes else [said]
            at_view, at_split = over_time if kind == "times" else (view, split)
            cmds[kind] = run + [script, os.path.join(at_view, "case.foam"), "decomposed" if at_split else
                                "reconstructed", into, spec, note, "--walls", w, "--uinf", f"{uinf:g}"]
            if kind == "times":
                cmds[kind].append("--over-time")
        elif kind == "vortices":
            cmds[kind] = run + [script, foam, into, ",".join(map(str, q_levels(uinf))), "--walls", w,
                                "--views", ",".join(VIEWS), "--note", note] + (["--decomposed"] if split else [])
        else:
            cmds[kind] = run + [script, foam, read, into, "spots", "--walls", w, "--uinf", f"{uinf:g}",
                                "--rho", f"{d['rho'] or 1.205:g}", "--note", note]
        if mean:
            cmds[kind].append("--mean")
    return cmds, notes


def _cut_titles(case, folder):
    """{cut: its title}: from the case's cut list, else from the one cut_views made from the model's size in the
    set (for its cuts, or its cut over time)."""
    for path in (os.path.join(case, CUTS), os.path.join(folder, "cuts", CUTS), os.path.join(folder, "times", CUTS)):
        try:
            with open(path, encoding="utf-8") as f:
                return {c["name"]: c.get("title", c["name"]) for c in json.load(f)["cuts"]}
        except (OSError, ValueError, KeyError, TypeError):
            pass
    return {}


def _fast_order(f):
    """A picture of the cells that set the time step's place in its set: its views as FAST_VIEWS has them, then its
    places, the fastest first."""
    m = FAST_FILE.fullmatch(f[:-4])
    if m and m.group(1):
        return (0, list(FAST_VIEWS).index(m.group(1)), f)
    return (1, int(m.group(2)), f) if m else (2, 0, f)


def _fast_doc(folder):
    """A set's FAST_DOC: {"cells": their count, "places": [{"title", ...}, ...]}, or {} when it has none."""
    try:
        with open(os.path.join(folder, FAST_DOC), encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError):
        return {}
    return doc if isinstance(doc, dict) else {}


def _time_order(f):
    """A picture of a cut over time's place in its set: by its time."""
    m = AT_TIME.fullmatch(f[:-4])
    return (0, float(m.group(2)), f) if m and _num(m.group(2)) else (1, 0.0, f)


def listing(case, folder, mean=False):
    """The pictures in a set's folder, each {file, kind, title} (and a cut over time's, its time): each kind's PNGs,
    titled from the cut list, the Q level and the view, the spot, the time (and the mean flow, with `mean`), or the
    view and the place of the cells that set the time step (its FAST_DOC)."""
    cuts, fast = _cut_titles(case, folder), _fast_doc(folder)
    places = fast.get("places") if isinstance(fast.get("places"), list) else []
    count = fast.get("cells")
    out = []
    for kind in ALL_KINDS:
        d = os.path.join(folder, kind)
        files = sorted(f for f in (os.listdir(d) if os.path.isdir(d) else []) if f.endswith(".png"))
        order = {"vortices": _vortex_order, "times": _time_order, "fastest": _fast_order}.get(kind)
        for f in sorted(files, key=order) if order else files:
            stem, title, more = f[:-4], f[:-4], {}
            if kind == "cuts":
                cut, _, colour = stem.rpartition("_")
                title = f"{cuts.get(cut, cut)}: {WORDS.get(colour, colour)}" + (" of the mean flow" if mean and
                                                                                 colour != "Urms" else "")
            elif kind == "times":
                m = AT_TIME.fullmatch(stem)
                if m:
                    title = f"{cuts.get(m.group(1), m.group(1))}: speed" + (
                        f" of the mean flow to {m.group(2)} s" if mean else f", written time {m.group(2)}")
                    more = {"time": m.group(2)}
            elif kind == "fastest":
                m = FAST_FILE.fullmatch(stem)
                if m and m.group(1):
                    title = ("The cells that set the time step: the "
                             + (f"{count} " if isinstance(count, int) else "") + "with the highest Courant number, "
                             + FAST_VIEWS[m.group(1)])
                elif m:
                    i = int(m.group(2))
                    p = places[i - 1] if 0 < i <= len(places) and isinstance(places[i - 1], dict) else {}
                    title = p["title"] if isinstance(p.get("title"), str) else (
                        f"The cells that set the time step, place {i}, close up")
            elif kind == "vortices":
                m = re.fullmatch(r"Q([0-9.e+]+)_(\w+)", stem)
                if m:
                    title = (f"Vortices{' of the mean flow' if mean else ''}, Q = {float(m.group(1)):,.0f} 1/s², "
                             f"{VIEWS.get(m.group(2), m.group(2))}")
            else:
                m = re.fullmatch(r".*_Cp_spot_(\w+)", stem)
                title = (f"The worst spot of unphysical pressure (Cp below {SPOT_CP})"
                         + (" in the mean flow" if mean else "") + ", "
                         + (SPOT_VIEWS.get(m.group(1), m.group(1)) if m else stem))
            out.append(dict({"file": f"{kind}/{f}", "kind": kind, "title": title}, **more))
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


def _passed(record):
    """Whether a self test's record (selftest.json) says it passed."""
    try:
        with open(record, encoding="utf-8") as f:
            return json.load(f).get("passed") is True
    except (OSError, ValueError, AttributeError):
        return False


def _say(path, step, fraction):
    """Write a set's status file (STATUS): the step its job is at and how far it is (0 to 1), whole: a new file put in
    its place, so never written through a link.  It only shows how far a job is, so a failure to write it is let be."""
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        if os.path.lexists(tmp):
            os.unlink(tmp)
        with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as f:
            json.dump({"step": step, "fraction": round(min(max(fraction, 0.0), 1.0), 3), "time": jobs.now()}, f)
        os.replace(tmp, path)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass


class _Steps:
    """A picture job's steps as it goes, said in its set's status file: each step's words and how far the job is as it
    starts, from what the steps before it cost of the whole ({step: s}, as _costs() has them).  A step that costs
    nothing isn't said, and one left out (drop()) no longer counts."""

    def __init__(self, path, costs):
        self.path, self.costs, self.done = path, {k: c for k, c in costs.items() if c > 0}, 0.0

    def at(self, key, words):
        if key in self.costs:
            total = self.done + sum(self.costs.values())
            _say(self.path, words, self.done / total)
            self.done += self.costs.pop(key)

    def drop(self, keys):
        for key in keys:
            self.costs.pop(key, None)

    def end(self):
        _say(self.path, "done", 1.0)


def _costs(case, at, kinds, mean=False, joins=False, selftest_dir=None):
    """What each step of making a set costs, in seconds at the coarse Ahmed body's size (COST, PER_PICTURE): joining
    its time first (`joins`), the self test while it hasn't passed in `selftest_dir`, finding the cells that set the
    time step, and each kind's pictures (how_many()): {step: s}."""
    tests = bool(selftest_dir) and not os.path.islink(selftest_dir) \
        and not _passed(os.path.join(selftest_dir, "selftest.json"))
    costs = {"join": COST["join"] * bool(joins), "selftest": COST["selftest"] * tests,
             "find": COST["find"] * ("fastest" in kinds and not mean)}
    for kind in kinds:
        if kind == "spots":
            costs[kind] = COST["spots"]
        elif kind != "fastest" or not mean:
            costs[kind] = PER_PICTURE[kind] * how_many(case, [kind], at, mean)
    return costs


def selftest(folder, pvbatch, env):
    """The vortex script's self test, in `folder` (the workspace's .pictures/.selftest): a test vortex that must come
    out red, which catches an offscreen renderer that draws nothing, or colours the wrong way round.  None once it has
    passed there, when it isn't run again; else why it didn't pass, for the set's notes."""
    record = os.path.join(folder, "selftest.json")
    if not os.path.islink(folder) and _passed(record):
        return None
    if not _replaceable(folder):
        return "its folder is in the way: it isn't one Mesh Doctor made"
    shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(folder, mode=0o700)
    open(os.path.join(folder, MARK), "w").close()
    print("pictures: the vortex script's self test", flush=True)
    rc, _ = _run([pvbatch, "--force-offscreen-rendering", os.path.join(SCRIPTS, SCRIPT["vortices"]), "--selftest",
                  folder], env, folder)
    if _passed(record):
        return None
    try:
        with open(record, encoding="utf-8") as f:
            why = json.load(f).get("reason")
    except (OSError, ValueError, AttributeError):
        why = None
    if isinstance(why, str) and why:
        return why
    return f"ParaView stopped, exit {rc}" if rc else "it wrote no verdict"


def join_time(case, at):
    """Join written time `at` of a run Mesh Doctor made from its processes into the run's own folder (reconstructPar
    -time), as its solve joins the latest of each stretch; reconstructPar's output goes to the job's log.  While it
    joins, the time holds jobs.JOINING, so one cut short isn't taken for joined; one that fails is removed again (only
    its mark, when its folder was there before).  RuntimeError when it isn't joined."""
    name = os.path.basename(os.path.normpath(case))
    if not ours(case):
        raise RuntimeError(f"{name} is a case you made, which Mesh Doctor only reads: its split times are read as "
                           "they are")
    folder = os.path.join(case, at)
    if os.path.islink(folder) or (os.path.lexists(folder) and not os.path.isdir(folder)):
        raise RuntimeError(f"{name}'s written time {at} is in the way: it isn't a folder of its own")
    fresh = not os.path.lexists(folder)
    os.makedirs(folder, exist_ok=True)
    mark = os.path.join(folder, jobs.JOINING)
    open(mark, "w").close()
    print(f"pictures: joining written time {at} from its {len(processors(case))} processes, into its folder "
          "(reconstructPar)", flush=True)
    bashrc = shlex.quote(config.settings()["bashrc"])
    rc, _ = _run(["bash", "-c", f"source {bashrc} >/dev/null 2>&1; [ -n \"$WM_PROJECT_DIR\" ] || exit 2; "
                  f"exec reconstructPar -time {shlex.quote(at)}"], None, case)
    if rc == 0 and _fields(folder, FLOW):
        os.unlink(mark)
        return
    if fresh:
        shutil.rmtree(folder, ignore_errors=True)
    elif os.path.lexists(mark):
        os.unlink(mark)
    if rc == 2:
        raise RuntimeError(f"OpenFOAM's environment didn't load, so {name}'s written time {at} wasn't joined: check "
                           f"the bashrc setting ({prog.name()} config)")
    raise RuntimeError(f"reconstructPar didn't join {name}'s written time {at}" + (f" (exit {rc})" if rc else "")
                       + ": the job's log says why")


def size_words(m):
    """A length in m in the unit that reads best, to two significant figures, as the app's plan card says it: "2.6
    mm", "4.5 cm", "1.2 m"."""
    mm = float(f"{m * 1000:.2g}")
    if mm < 10:
        return f"{mm:g} mm"
    cm = float(f"{m * 100:.2g}")
    return f"{cm:g} cm" if cm < 100 else f"{float(f'{m:.2g}'):g} m"


def place_title(i, g):
    """The title of the close-up of place `i` (from 1) of the cells that set the time step, from a transient plan's
    region `g`, as its plan card says one: "Place 1 of the cells that set the time step, close up: 38 cells near
    (-0.0635, 0.18, 0.322) m, about 2.6 mm across and 2.4 mm from the wall ahmed, where the flow is up to 55 m/s"."""
    n = g["nCells"]
    s = (f"Place {i} of the cells that set the time step, close up: {n} cell{'' if n == 1 else 's'} near "
         f"({', '.join(f'{x:.3g}' for x in g['centre'])}) m, about {size_words(g['h'])} across")
    if g.get("wall"):
        s += (f" and {size_words(g['wallDist'])} from the wall {g['wall']}" if g.get("wallDist") is not None
              else f", by the wall {g['wall']}")
    if g.get("speed") is not None:
        speed = float(f"{g['speed']:.2g}")
        s += f", where the flow is up to {speed:g} m/s"
    return s


def _mirror(src, into, set_file, links):
    """Make `into` a folder that OpenFOAM reads as `src` (a case, or one of its processor folders) with the cell set
    `set_file` as its constant/polyMesh/sets/fastestCells: each entry of src's constant and of its polyMesh a link (not
    its own sets), and the set a link too, so that nothing is written in the case.  Each link goes in `links`."""
    poly = os.path.join(into, "constant", "polyMesh")
    os.makedirs(os.path.join(poly, "sets"), mode=0o700)
    for d, dest, skip in ((os.path.join(src, "constant"), os.path.dirname(poly), "polyMesh"),
                          (os.path.join(src, "constant", "polyMesh"), poly, "sets")):
        for e in sorted(os.listdir(d)):
            if e != skip:
                links.append(os.path.join(dest, e))
                os.symlink(os.path.join(d, e), links[-1])
    links.append(os.path.join(poly, "sets", tplan.SET))
    os.symlink(set_file, links[-1])


def fastest(case, at, folder, links):
    """The cells that set the time step at written time `at` of `case`, ready to picture: the transient plan's (tplan,
    Mesh Doctor's foamCourantCells: the cells with the highest Courant number, from that time's face flux), its cell
    set written in `folder`, and foamToVTK -cellSet writing those cells alone as VTK files, reading the case through
    links in folder/view_fastest (each link in `links`): on the whole mesh, or, on a split case without the whole mesh
    it was split from, each processor's own set, in parallel.  Its FAST_DOC goes in `folder`.  (the folder of the VTK
    files, the FAST_DOC, notes); the first two None, with a note why, when they aren't found."""
    name, case = os.path.basename(os.path.normpath(case)), os.path.abspath(case)
    if not any(tplan._field(os.path.join(r, at), "phi") for r in [os.path.join(case, q) for q in processors(case)[:1]]
               + [case]):              # as the plan reads it: split where processor0 has it, else joined
        return None, None, [f"no cells that set the time step: written time {at} has no face flux (phi) to find them "
                            "from"]
    print(f"pictures: the cells that set the time step, as a transient plan finds them ({tplan.TOOL})", flush=True)
    try:
        p = tplan.plan(case, at)
    except (ValueError, RuntimeError, MemoryError) as e:
        print(f"pictures: {e}", flush=True)
        return None, None, [f"no cells that set the time step: {str(e).replace(case, name)}"
                            if isinstance(e, MemoryError) else "no cells that set the time step: the transient plan "
                            "that finds them stopped; the job's log says why"]
    if p.get("fastestCells") is None:
        return None, None, [f"no cells that set the time step: Mesh Doctor's {tplan.TOOL} isn't built (./Allwmake in "
                            "its folder), and OpenFOAM's CourantNo finds only their places, not the cells"]
    n, d, said = len(p["fastestCells"]), p["courantPerSecond"], []
    sets = os.path.join(folder, "fastest_sets")
    why = tplan.write_sets(sets, p, case)
    whole = not p["decomposed"] or why is None
    gain = d["max"] / d["withoutTop"] if d["withoutTop"] > 0 else 1.0
    said.append(f"the cells that set the time step are the {n} with the highest Courant number at written time {at}"
                + (f": without them it could be {float(f'{gain:.2g}'):g} times as long" if gain >= 1.1 else
                   ": leaving them out would hardly change it"))
    if not whole:
        said.append(f"the cells that set the time step were written on each of its {p['processors']} processes: "
                    f"{why}")
    view = os.path.join(folder, "view_fastest")
    os.mkdir(view, 0o700)
    links.append(os.path.join(view, "system"))
    os.symlink(os.path.join(case, "system"), links[-1])
    for sub in [""] if whole else [f"processor{k}" for k in range(p["processors"])]:
        os.makedirs(os.path.join(view, sub), mode=0o700, exist_ok=True)
        _mirror(os.path.join(case, sub), os.path.join(view, sub),
                os.path.join(sets, sub, "constant", "polyMesh", "sets", tplan.SET), links)
    par = "" if whole else f"mpirun --oversubscribe -np {p['processors']} "
    cmd = (f"{par}foamToVTK {'' if whole else '-parallel '}-cellSet {tplan.SET} -fields '()' -excludePatches "
           "'(\".*\")' -polyhedra polyhedra -noPointValues -noFaceZones -noFunctionObjects")
    print(f"pictures: foamToVTK writes the {n} cells alone" + ("" if whole else f", on its {p['processors']} "
                                                                                "processes"), flush=True)
    bashrc = shlex.quote(config.settings()["bashrc"])
    rc, _ = _run(["bash", "-c", f"source {bashrc} >/dev/null 2>&1; [ -n \"$WM_PROJECT_DIR\" ] || exit 2; exec {cmd}"],
                 None, view)
    vtk = os.path.join(view, "VTK")
    if rc or not any(f.endswith(".vtk") for f in (os.listdir(vtk) if os.path.isdir(vtk) else [])):
        return None, None, said + ["no pictures of the cells that set the time step: " + (
            "OpenFOAM's environment didn't load (the bashrc setting)" if rc == 2 else
            f"foamToVTK didn't write them (exit {rc}); the job's log says why")]
    doc = os.path.join(folder, FAST_DOC)
    with open(doc, "w") as f:
        json.dump({"cells": n, "time": at, "places": [
            {"centre": g["centre"], "bbox": g["bbox"], "h": g["h"], "title": place_title(i, g)}
            for i, g in enumerate(p["regions"][:PLACES], 1)]}, f, indent=1)
    return vtk, doc, said


def make(case, out, at, kinds, mean=False, selftest_dir=None, join=False):
    """Make a set of pictures of `case` at time `at` (its mean flow, with `mean`) in folder `out`; pictures.json
    lists them.  A time still split onto the case's processes is joined first with `join`, when Mesh Doctor made the
    run (join_time(), how()'s "join"), else read as it is, split, each processor folder through links of its own with
    its constant and only that time.  The cells that set the time step are found first (fastest()), not for a mean
    flow.  A set made there before is replaced once the new one is whole; any other folder in
    the way is refused and left as it is.  With `selftest_dir`, the vortex script's self test runs first, unless it
    has passed there (selftest()).  As it goes, each step and how far it is are said in out + STATUS (_Steps).  The
    document; RuntimeError when no picture was made."""
    pvbatch = selfcheck.paraview()[0]
    if not pvbatch:
        raise RuntimeError("ParaView's pvbatch isn't found")
    new = out + ".new"
    for folder in (out, new):
        if not _replaceable(folder):
            raise RuntimeError(f"{folder} is in the way: it isn't a set of pictures Mesh Doctor made, so it is left "
                               "as it is")
    procs, said = processors(case), []
    joins = join and at not in times(case) and ours(case)
    steps = _Steps(out + STATUS, _costs(case, at, kinds, mean, joins, selftest_dir))
    if joins:
        steps.at("join", f"joining written time {at} from its {len(procs)} processes (reconstructPar)")
        join_time(case, at)
        said.append(f"written time {at} was split onto its {len(procs)} processes, so it was joined first, in the "
                    "run's own folder")
    whole = at in times(case)
    if not whole and kept(case).get(at) != "split":
        raise RuntimeError(f"{os.path.basename(os.path.normpath(case))} has no written time {at} with its flow (U and "
                           "p)")
    if not whole:
        said.append(f"written time {at} is split onto its {len(procs)} processes, so ParaView read it as it is, split: "
                    "a case you made is only read")
    ts, ts_split, ts_all = strip(case, at, mean) if "times" in kinds else ([], False, 0)
    if "times" in kinds and not ts:
        said.append(f"no cut over time: no written time up to {at} is in every one of its processor folders")
    if ts and len(ts) < ts_all:
        said.append(f"the cut over time pictures {len(ts)} of its {ts_all} written times up to {at}"
                    + (", evenly picked" if len(ts) == MAX_TIMES else ": the others aren't in every one of its "
                       "processor folders"))
    if ts and ts_split:
        said.append(f"the cut over time read its written times as they are, split onto its {len(procs)} processes: "
                    "none was joined for it")
    shutil.rmtree(new, ignore_errors=True)
    os.makedirs(new, mode=0o700)
    open(os.path.join(new, MARK), "w").close()      # first, so that a set cut short can be replaced
    view, links, cmds, notes, ran = os.path.join(new, "view"), [], {}, [], []
    tview = os.path.join(new, "view_times")         # a cut over time's: its times, as they are kept
    env = dict(os.environ, PYTHONPATH=selfcheck.PV_PYTHONPATH)
    steps.at("selftest", "ParaView's self test: a test vortex that must come out red")
    why = selftest(selftest_dir, pvbatch, env) if selftest_dir else None
    first = [f"ParaView's self test didn't pass ({why}), so these pictures may be blank or wrongly coloured; it runs "
             "again with the next set"] if why else []
    since = transient.average_from(os.path.join(case, *(() if whole else procs[:1]), at), float(at)) if mean else None
    try:
        os.mkdir(view, 0o700)
        for d in ("constant", "system") + ((at,) if whole else ()):    # ParaView reads the case through these links
            links.append(os.path.join(view, d))
            os.symlink(os.path.join(os.path.abspath(case), d), links[-1])
        for proc in () if whole else procs:         # split: each processor folder's constant and only this time
            os.mkdir(os.path.join(view, proc), 0o700)
            for d in ("constant", at):
                links.append(os.path.join(view, proc, d))
                os.symlink(os.path.join(os.path.abspath(case), proc, d), links[-1])
        open(os.path.join(view, "case.foam"), "w").close()
        if ts:
            os.mkdir(tview, 0o700)
            for d in ("constant", "system") + (() if ts_split else tuple(ts)):
                links.append(os.path.join(tview, d))
                os.symlink(os.path.join(os.path.abspath(case), d), links[-1])
            for proc in procs if ts_split else ():
                os.mkdir(os.path.join(tview, proc), 0o700)
                for d in ("constant",) + tuple(ts):
                    links.append(os.path.join(tview, proc, d))
                    os.symlink(os.path.join(os.path.abspath(case), proc, d), links[-1])
            open(os.path.join(tview, "case.foam"), "w").close()
        fast, fast_said = None, []
        if "fastest" in kinds and not mean:
            steps.at("find", "finding the cells that set the time step (foamCourantCells, foamToVTK)")
            vtk, doc, fast_said = fastest(case, at, new, links)
            fast = (vtk, doc) if vtk else None
        cmds, notes = plan(case, view, new, kinds, pvbatch, mean, since, split=not whole,
                           over_time=(tview, ts_split) if ts else None, fastest=fast)
        notes = first + said + fast_said + notes
        steps.drop([k for k in kinds if k not in cmds])
        for kind, cmd in cmds.items():
            steps.at(kind, DRAWING[kind] + (f" at {len(ts)} written times" if kind == "times" else ""))
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
        shutil.rmtree(tview, ignore_errors=True)
        shutil.rmtree(os.path.join(new, "view_fastest"), ignore_errors=True)
        shutil.rmtree(os.path.join(new, "fastest_sets"), ignore_errors=True)
    doc = {"case": os.path.basename(os.path.normpath(case)), "time": at, "mean": bool(mean), "kinds": list(kinds),
           "made": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "notes": notes,
           "pictures": listing(case, new, mean)}
    if not doc["pictures"] and not ran:             # (a set with no spot to show is still a set)
        shutil.rmtree(new, ignore_errors=True)
        raise RuntimeError("no picture was made" + (": " + "; ".join(notes) if notes else ""))
    with open(os.path.join(new, "pictures.json"), "w") as f:
        json.dump(doc, f, indent=1)
    shutil.rmtree(out, ignore_errors=True)
    os.replace(new, out)
    steps.end()
    return doc


def start(name, at=None, kinds=KINDS, mean=False):
    """Start a pictures job (POST /jobs, kind "pictures"): the job, or a refusal, as md_api's other starts answer."""
    why = FAST_MEAN if mean and "fastest" in kinds else refusal(name, at, mean)
    if why:
        return md_api._refuse(*why)
    ws = config.settings()["workspace"]
    config.ensure_workspace(ws)
    os.makedirs(os.path.join(ws, PICTURES, name), mode=0o700, exist_ok=True)
    case = tplan._case(name)
    at = at or latest(case, mean)
    rel = f"{PICTURES}/{name}/{set_name(at, mean)}"
    cmd = [sys.executable, os.path.join(PKG, "pictures.py"), case, "--time", at, "--kinds", ",".join(kinds),
           "--out", os.path.join(ws, rel)] + (["--mean"] if mean else [])
    if "times" in kinds:            # a cut over time: ParaView holds a time's fields twice as it steps to the next
        ram = "pictures-times-split" if strip(case, at, mean)[1] else "pictures-times"
    else:                           # its time, read as it is
        ram = "pictures-split" if how(case, at) == "split" else "pictures"
    return md_api._submit("pictures", {"name": name, "time": at, "kinds": list(kinds), "mean": mean}, name, cmd,
                          log=f"{rel}.log", result=f"{rel}/pictures.json", ram=(case, ram),
                          disk=_disk(case, name, kinds, at, mean)[0])


# --------------------------------------------------------------------------
# the sets made, for the API: the sets, a set, one picture, and deleting a set

def root():
    """The workspace's folder of sets of pictures."""
    return os.path.join(config.settings()["workspace"], PICTURES)


def _plain(*parts):
    """The path to `parts` in root(), or None when one of them is a link: a set is only ever read in folders of its
    own."""
    path = os.path.join(root(), *parts)
    return path if os.path.realpath(path) == os.path.join(os.path.realpath(root()), *parts) else None


def _made(folder):
    """The pictures.json of a set Mesh Doctor made in `folder` (it has the mark), or None."""
    if not folder or not os.path.isfile(os.path.join(folder, MARK)):
        return None
    try:
        with open(os.path.join(folder, "pictures.json"), encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError):
        return None
    return doc if isinstance(doc, dict) and isinstance(doc.get("pictures"), list) else None


def _latest(case=None):
    """{(case, set): the latest pictures job of that set}, of one case or all."""
    out = {}
    for job in jobs.list_jobs(limit=1000):                      # newest first
        p = job.get("params") if isinstance(job.get("params"), dict) else {}
        if job.get("kind") == "pictures" and isinstance(p.get("time"), str) and (case is None or job["name"] == case):
            out.setdefault((job["name"], set_name(p["time"], p.get("mean") is True)), job)
    return out


def _kinds(kinds):
    """The kinds a set (or its job) names, in its order: those of ALL_KINDS only."""
    return list(dict.fromkeys(k for k in kinds if k in ALL_KINDS)) if isinstance(kinds, list) else []


def _shown(doc):
    """The pictures of a set that are served: each {file, kind, title}, its file <kind>/<a plain .png name>, and a
    cut over time's, its time."""
    out = []
    for p in doc["pictures"]:
        kind, file = (p.get("kind"), p.get("file")) if isinstance(p, dict) else (None, None)
        if kind in ALL_KINDS and isinstance(file, str) and file.startswith(kind + "/") \
                and isinstance(p.get("title"), str) and FILE.match(file[len(kind) + 1:]):
            at = p.get("time") if kind == "times" else None
            out.append(dict({"file": file, "kind": kind, "title": p["title"]},
                            **({"time": at} if isinstance(at, str) and TIME_NAME.match(at) else {})))
    return out


def _about(name, at, doc):
    """What a set's folder says, and its pictures.json (or its job's params): {case, set, time, mean, kinds, made}."""
    return {"case": name, "set": at, "time": at[:-len("_mean")] if at.endswith("_mean") else at,
            "mean": at.endswith("_mean"), "kinds": _kinds(doc.get("kinds")),
            "made": doc["made"] if isinstance(doc.get("made"), str) else None}


def sets(case=None):
    """GET /pictures: the sets of pictures in the workspace, of one case or all, newest first: each set made, and each
    one a job is making for the first time (its count and made null until then), each with its latest job."""
    made = {}
    try:
        names = [case] if case else sorted(os.listdir(root()))
    except OSError:
        names = []
    for name in names:
        folder = _plain(name) if md_api.SAFE.match(name) else None     # (.selftest, the self test's, is no case's)
        try:
            ats = os.listdir(folder) if folder else []
        except OSError:
            ats = []
        for at in ats:
            doc = _made(_plain(name, at)) if SET.match(at) else None
            if doc is not None:
                made[(name, at)] = doc
    latest = _latest(case)
    out = []
    for key in sorted(set(made) | {k for k, j in latest.items() if j["state"] in jobs.ACTIVE}):
        doc, job = made.get(key), latest.get(key)
        out.append(dict(_about(*key, doc if doc is not None else job["params"]),
                        count=None if doc is None else len(_shown(doc)),
                        job={"id": job["id"], "state": job["state"]} if job else None))
    out.sort(key=lambda s: s["made"] or "~", reverse=True)       # those being made first, then the newest made
    return out


def _bad_set(name, at):
    if not md_api.SAFE.match(name) or not SET.match(at):
        return "bad-request", "bad set: a case's name, then the time pictured (with _mean for its mean flow)"
    return None


def _making(name, at):
    """The job making set `at` of case `name` now, or None."""
    job = _latest(name).get((name, at))
    return job if job and job["state"] in jobs.ACTIVE else None


def one(name, at):
    """GET /pictures/{case}/{set}: (the set: _about's fields, its notes and the pictures it serves, None), or (None,
    (code, message)) why not."""
    why = _bad_set(name, at)
    if why:
        return None, why
    doc = _made(_plain(name, at))
    if doc is None:
        job = _making(name, at)
        return None, (("not-ready", f"the pictures {at} of {name} are being made: job {job['id']} is {job['state']}")
                      if job else ("not-found", f"no set of pictures {at} of {name}"))
    shown = _shown(doc)
    notes = [n for n in doc["notes"] if isinstance(n, str)] if isinstance(doc.get("notes"), list) else []
    if len(shown) < len(doc["pictures"]):
        notes.append(f"{len(doc['pictures']) - len(shown)} of its pictures aren't shown: a picture's file is named "
                     "with letters, digits, _, . and - only")
    return dict(_about(name, at, doc), notes=notes, pictures=shown), None


def picture(name, at, kind, file):
    """GET /pictures/{case}/{set}/{kind}/{file}: (the PNG file's bytes, None), or (None, (code, message)).  Only a
    picture its set lists is read, in the set's own folders (never through a link), and only if it is a PNG file."""
    if kind not in ALL_KINDS or not FILE.match(file):
        return None, ("bad-request", f"bad picture: its kind ({', '.join(ALL_KINDS)}), then its file, a plain .png name")
    doc, why = one(name, at)
    if why:
        return None, why
    if f"{kind}/{file}" not in [p["file"] for p in doc["pictures"]]:
        return None, ("not-found", f"the set {at} of {name} lists no picture {kind}/{file}")
    path, fd = _plain(name, at, kind, file), -1
    try:                                    # not through a link, and no pipe or device to wait on
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)) if path else -1
    except OSError:
        pass
    if fd < 0:
        return None, ("not-found", f"the picture {kind}/{file} of the set {at} of {name} isn't there")
    with os.fdopen(fd, "rb") as f:
        info = os.fstat(f.fileno())
        data = f.read(MAX_PNG + 1) if stat.S_ISREG(info.st_mode) and info.st_size <= MAX_PNG else b""
    if not data.startswith(PNG) or len(data) > MAX_PNG:
        return None, ("unsupported", f"the picture {kind}/{file} of the set {at} of {name} isn't a PNG file of at "
                                     f"most {MAX_PNG >> 20} MB")
    return data, None


def delete(name, at):
    """POST /pictures/{case}/{set}/delete: delete a set Mesh Doctor made, with its job's log and status file and any
    copy of it cut short, but not while a job makes it: ({case, set, deleted: its pictures}, None), or (None, (code,
    message))."""
    why = _bad_set(name, at)
    if why:
        return None, why
    job = _making(name, at)
    if job:
        return None, ("busy", f"the pictures {at} of {name} are being made: job {job['id']} is {job['state']}; cancel "
                              "it first")
    folder = _plain(name, at)
    if folder is not None and not os.path.lexists(folder):
        return None, ("not-found", f"no set of pictures {at} of {name}")
    if folder is None or not os.path.isdir(folder) or not os.path.isfile(os.path.join(folder, MARK)):
        return None, ("unsupported", f"{at} of {name} in the workspace's {PICTURES} isn't a set of pictures Mesh "
                                     "Doctor made, so it is left as it is")
    doc = _made(folder)
    shutil.rmtree(folder)
    new, log, status = _plain(name, at + ".new"), _plain(name, at + ".log"), _plain(name, at + STATUS)
    if new and _replaceable(new):
        shutil.rmtree(new, ignore_errors=True)
    for f in (log, status):
        if f and os.path.isfile(f):
            os.unlink(f)
    try:
        os.rmdir(_plain(name))              # the case's folder, once it has no set left
    except OSError:
        pass
    return {"case": name, "set": at, "deleted": len(_shown(doc)) if doc else 0}, None


def main(argv=None):
    ap = argparse.ArgumentParser(prog=prog.name() + " pictures", description=__doc__.split("\n\n")[0])
    ap.add_argument("case", help="a case with a written result: its name in the cases folder, or its folder (only "
                                 "read)")
    ap.add_argument("--time", help="the written time to picture (default: the latest; with --mean, the latest with a "
                                   "mean flow); one still split onto its processes is joined first, in its folder, "
                                   "when Mesh Doctor made the run, else read as it is, split")
    ap.add_argument("--kinds", default=",".join(KINDS), help="what to make, of %(default)s (the default), times (the "
                    "first cut's speed at each written time up to the one pictured, at most " + str(MAX_TIMES) + ") and "
                    "fastest (the cells that set the time step, with the walls)")
    ap.add_argument("--mean", action="store_true", help="a transient run's mean flow (UMean and pMean), at a time "
                                                        "written once its averaging is on")
    ap.add_argument("--out", help="the set's folder (default: the workspace's .pictures/<case>/<time>, or "
                                  "<time>_mean), replaced only if it holds a set made before")
    a = ap.parse_args(argv)
    kinds = [k for k in a.kinds.split(",") if k]
    if not kinds or any(k not in ALL_KINDS for k in kinds):
        sys.exit(f"pictures: --kinds takes {', '.join(ALL_KINDS)}")
    if a.mean and "fastest" in kinds:
        sys.exit(f"pictures: {FAST_MEAN[1]}")
    case = a.case if os.path.isdir(a.case) else tplan._case(a.case)
    if not case:
        sys.exit(f"pictures: no case {a.case} in the cases folder")
    why = why_not(case, a.time, a.mean)
    if why:
        sys.exit(f"pictures: {why[1]}")
    at = a.time or latest(case, a.mean)
    sets = os.path.join(config.settings()["workspace"], PICTURES)
    out = a.out or os.path.join(sets, os.path.basename(os.path.normpath(case)), set_name(at, a.mean))
    try:
        doc = make(case, out, at, kinds, a.mean, os.path.join(sets, SELFTEST), join=how(case, at) == "join")
    except (RuntimeError, OSError) as e:
        sys.exit(f"pictures: {e}")
    for n in doc["notes"]:
        print(f"pictures: {n}")
    print(f"pictures: {len(doc['pictures'])} made, in {out}")


if __name__ == "__main__":
    main(sys.argv[1:])
