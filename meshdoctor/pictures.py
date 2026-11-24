# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Pictures of a solved case's flow: ParaView's pvbatch runs the paraview-post scripts offscreen.

    python3 -m meshdoctor pictures <case> [--time T] [--kinds cuts,vortices,spots] [--mean]

The case (a run Mesh Doctor made, or a case you made, in the cases folder) is only read: ParaView reads it through
a folder of links in the workspace (its constant, system and the time pictured, and an empty case.foam), and the
pictures go in the workspace too, in .pictures/<case>/<time>/, with pictures.json listing them.  Cuts follow the
case's cut list (cuts.json at its root, as a case made from the Ahmed body template has), or without one are made
from its model's size; vortices and spots of unphysical pressure on the walls (Cp below -5: a numerical error) need
only the case.  The scripts' cameras need the flow toward -x and z up.  With --mean they picture a transient run's
mean flow (UMean and pMean, written once its averaging is on) in place of the flow at that time, into
.pictures/<case>/<time>_mean/.  A computer's first set starts with the vortex script's self test (a test vortex that
must come out red), in .pictures/.selftest/, which is kept once it has passed.  The API serves the sets (sets(),
one(), picture(), delete()): only a picture a set's list names is read, in the set's own folders, never through a link.
"""
import argparse, json, math, os, re, shutil, stat, subprocess, sys, time

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
KINDS = ("cuts", "vortices", "spots")
SCRIPT = {"cuts": "cut_views.py", "vortices": "vortex_views.py", "spots": "pressure_spots.py"}
CUTS = "cuts.json"
MARK = ".meshdoctor-pictures"  # in a set (and one being made): make() replaces only a folder that has it
MEAN = ("UMean", "pMean")       # a transient run's mean flow (transient.AVERAGE), pictured in place of U and p
SELFTEST = ".selftest"          # in PICTURES: the vortex script's self test (a dot folder: no case is named so)
Q_AT_15 = (3000, 10000, 30000)  # Q levels (1/s²) that showed a car's vortices at 15 m/s; Q goes as the speed²
VIEWS = {"rear34": "from behind", "top": "from above", "side": "from the side"}
FORCE_OBJECT = re.compile(r"([A-Za-z_][\w.:-]*)\s*\{[^{}]*\btype\s+(?:forces|forceCoeffs)\s*;")
WORDS = {"U": "speed", "Cp": "pressure coefficient Cp", "Cpt": "total pressure coefficient Cp,t"}
SPOT_CP = -5                    # pressure_spots.py's LIM: a wall face with Cp below it is a spot of unphysical pressure
SPOT_VIEWS = {"closeup": "close up, with the surface mesh", "normal": "further back",
              "side": "from the side of the model"}
SET = re.compile(r"^[0-9][0-9.eE+-]{0,39}(_mean)?$")              # a set's folder: the time pictured (_mean: its mean)
FILE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}\.png$")     # a picture's file, in its kind's folder of its set
PNG = b"\x89PNG\r\n\x1a\n"      # the first bytes of every PNG file
MAX_PNG = 32 << 20              # the largest picture served: ParaView's 1920 x 1080 PNGs are well under 1 MB
AUTO_CUTS = 7                   # the pictures of the cuts cut_views.py makes from the model's size: 3, 2 and 2 colours


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


def mean_times(case):
    """Those of times() that hold a transient run's mean flow too (UMean and pMean), oldest first."""
    return [t for t in times(case) if all(_has(os.path.join(case, t), f) for f in MEAN)]


def set_name(at, mean=False):
    """The folder of a set of pictures of time `at`, or of its mean flow."""
    return at + ("_mean" if mean else "")


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


def why_not(case, at=None, mean=False):
    """Why this case (its mean flow, with `mean`) can't be pictured, as (code, message) naming no folders, or None."""
    name = os.path.basename(os.path.normpath(case))
    have = times(case)
    if not have:
        return "not-ready", (f"{name} has no written result on its whole mesh to picture (a time with U and p): "
                             "solve it first")
    if at is not None and at not in have:
        return "bad-request", f"{name} has no time {at} on its whole mesh; its latest are {', '.join(have[-4:])}"
    means = mean_times(case) if mean else []
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
    if not walls(case, d["total"]):
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


def how_many(case, kinds):
    """About how many pictures a set of these kinds makes of `case`: one per colour of each cut in its cut list (else
    AUTO_CUTS), one per vortex level and view, and the worst spot's three views."""
    n = 0
    for kind in kinds:
        if kind == "cuts":
            try:
                with open(os.path.join(case, CUTS), encoding="utf-8") as f:
                    n += sum(len(c["colours"]) for c in json.load(f)["cuts"]) or AUTO_CUTS
            except (OSError, ValueError, KeyError, TypeError):
                n += AUTO_CUTS
        else:
            n += len(Q_AT_15) * len(VIEWS) if kind == "vortices" else len(SPOT_VIEWS)
    return n


def _disk(case, name, kinds):
    """What a pictures job of `case` writes, for the disk guard: (MB, the workspace's folder of sets, what needs it,
    with its verb), from how_many() pictures."""
    n = how_many(case, kinds)
    return diskguard.pictures_mb(n), root(), f"the set of about {n} pictures of {name} needs"


def disk_of(name, at=None, kinds=KINDS, mean=False):
    """GET /disk/pictures: what a pictures job writes, as start's disk guard counts it: ((MB, folder, what), None), or
    (None, the refusal start would give)."""
    why = refusal(name, at, mean)
    return (None, md_api._refuse(*why)) if why else (_disk(tplan._case(name), name, kinds), None)


def plan(case, view, out, kinds, pvbatch, mean=False, since=None):
    """({kind: the pvbatch command that makes its pictures, reading the links folder `view`, into out/<kind>},
    notes on what is left out).  With `mean`, of the mean flow, averaged from time `since` (s; None: not known)."""
    d = caseinfo.describe(case)
    name, w, uinf = os.path.basename(os.path.normpath(case)), ",".join(walls(case, d["total"])), d["Uinf"]
    foam, run, cmds, notes = os.path.join(view, "case.foam"), [pvbatch, "--force-offscreen-rendering"], {}, []
    note = f"{name}, written time {{it}}"
    if mean:
        note = f"{name}, the mean flow " + ("" if since is None else f"from {since:.4g} s ") + "to {it} s"
    for kind in kinds:
        script, into = os.path.join(SCRIPTS, SCRIPT[kind]), os.path.join(out, kind)
        if kind == "cuts":
            spec = os.path.join(case, CUTS)
            if not os.path.isfile(spec):                # cut_views makes three from the walls' bounds
                spec = "auto"
                notes.append(f"cuts made from the model's size: {name} has no cut list ({CUTS} at its root)")
            cmds[kind] = run + [script, foam, "reconstructed", into, spec, note, "--walls", w, "--uinf", f"{uinf:g}"]
        elif kind == "vortices":
            cmds[kind] = run + [script, foam, into, ",".join(map(str, q_levels(uinf))), "--walls", w,
                                "--views", ",".join(VIEWS), "--note", note]
        else:
            cmds[kind] = run + [script, foam, "reconstructed", into, "spots", "--walls", w, "--uinf", f"{uinf:g}",
                                "--rho", f"{d['rho'] or 1.205:g}", "--note", note]
        if mean:
            cmds[kind].append("--mean")
    return cmds, notes


def listing(case, folder, mean=False):
    """The pictures in a set's folder, each {file, kind, title}: each kind's PNGs, titled from the cut list, the Q
    level and the view, or the spot (and the mean flow, with `mean`)."""
    cuts = {}
    for path in (os.path.join(case, CUTS), os.path.join(folder, "cuts", CUTS)):     # the case's, else cut_views' own
        try:
            with open(path, encoding="utf-8") as f:
                cuts = {c["name"]: c.get("title", c["name"]) for c in json.load(f)["cuts"]}
            break
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
                title = f"{cuts.get(cut, cut)}: {WORDS.get(colour, colour)}" + (" of the mean flow" if mean else "")
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


def _passed(record):
    """Whether a self test's record (selftest.json) says it passed."""
    try:
        with open(record, encoding="utf-8") as f:
            return json.load(f).get("passed") is True
    except (OSError, ValueError, AttributeError):
        return False


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


def make(case, out, at, kinds, mean=False, selftest_dir=None):
    """Make a set of pictures of `case` at time `at` (its mean flow, with `mean`) in folder `out`; pictures.json
    lists them.  A set made there before is replaced once the new one is whole; any other folder in the way is
    refused and left as it is.  With `selftest_dir`, the vortex script's self test runs first, unless it has passed
    there (selftest()).  The document; RuntimeError when no picture was made."""
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
    why = selftest(selftest_dir, pvbatch, env) if selftest_dir else None
    first = [f"ParaView's self test didn't pass ({why}), so these pictures may be blank or wrongly coloured; it runs "
             "again with the next set"] if why else []
    since = transient.average_from(os.path.join(case, at), float(at)) if mean else None
    try:
        os.mkdir(view, 0o700)
        for d in ("constant", "system", at):        # ParaView reads the case through these links: it is only read
            links.append(os.path.join(view, d))
            os.symlink(os.path.join(os.path.abspath(case), d), links[-1])
        open(os.path.join(view, "case.foam"), "w").close()
        cmds, notes = plan(case, view, new, kinds, pvbatch, mean, since)
        notes = first + notes
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
    return doc


def start(name, at=None, kinds=KINDS, mean=False):
    """Start a pictures job (POST /jobs, kind "pictures"): the job, or a refusal, as md_api's other starts answer."""
    why = refusal(name, at, mean)
    if why:
        return md_api._refuse(*why)
    ws = config.settings()["workspace"]
    config.ensure_workspace(ws)
    os.makedirs(os.path.join(ws, PICTURES, name), mode=0o700, exist_ok=True)
    case = tplan._case(name)
    at = at or (mean_times(case) if mean else times(case))[-1]
    rel = f"{PICTURES}/{name}/{set_name(at, mean)}"
    cmd = [sys.executable, os.path.join(PKG, "pictures.py"), case, "--time", at, "--kinds", ",".join(kinds),
           "--out", os.path.join(ws, rel)] + (["--mean"] if mean else [])
    return md_api._submit("pictures", {"name": name, "time": at, "kinds": list(kinds), "mean": mean}, name, cmd,
                          log=f"{rel}.log", result=f"{rel}/pictures.json", ram=(case, "pictures"),
                          disk=_disk(case, name, kinds))


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
    """The kinds a set (or its job) names, in its order: those of KINDS only."""
    return list(dict.fromkeys(k for k in kinds if k in KINDS)) if isinstance(kinds, list) else []


def _shown(doc):
    """The pictures of a set that are served: each {file, kind, title}, its file <kind>/<a plain .png name>."""
    out = []
    for p in doc["pictures"]:
        kind, file = (p.get("kind"), p.get("file")) if isinstance(p, dict) else (None, None)
        if kind in KINDS and isinstance(file, str) and file.startswith(kind + "/") and isinstance(p.get("title"), str) \
                and FILE.match(file[len(kind) + 1:]):
            out.append({"file": file, "kind": kind, "title": p["title"]})
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
    if kind not in KINDS or not FILE.match(file):
        return None, ("bad-request", f"bad picture: its kind ({', '.join(KINDS)}), then its file, a plain .png name")
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
    """POST /pictures/{case}/{set}/delete: delete a set Mesh Doctor made, with its job's log and any copy of it cut
    short, but not while a job makes it: ({case, set, deleted: its pictures}, None), or (None, (code, message))."""
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
    new, log = _plain(name, at + ".new"), _plain(name, at + ".log")
    if new and _replaceable(new):
        shutil.rmtree(new, ignore_errors=True)
    if log and os.path.isfile(log):
        os.unlink(log)
    try:
        os.rmdir(_plain(name))              # the case's folder, once it has no set left
    except OSError:
        pass
    return {"case": name, "set": at, "deleted": len(_shown(doc)) if doc else 0}, None


def main(argv=None):
    ap = argparse.ArgumentParser(prog=prog.name() + " pictures", description=__doc__.split("\n\n")[0])
    ap.add_argument("case", help="a case with a written result: its name in the cases folder, or its folder (only "
                                 "read)")
    ap.add_argument("--time", help="the written time to picture (default: the latest on its whole mesh; with --mean, "
                                   "the latest with a mean flow)")
    ap.add_argument("--kinds", default=",".join(KINDS), help="what to make, of %(default)s (default: all)")
    ap.add_argument("--mean", action="store_true", help="a transient run's mean flow (UMean and pMean), at a time "
                                                        "written once its averaging is on")
    ap.add_argument("--out", help="the set's folder (default: the workspace's .pictures/<case>/<time>, or "
                                  "<time>_mean), replaced only if it holds a set made before")
    a = ap.parse_args(argv)
    kinds = [k for k in a.kinds.split(",") if k]
    if not kinds or any(k not in KINDS for k in kinds):
        sys.exit(f"pictures: --kinds takes {', '.join(KINDS)}")
    case = a.case if os.path.isdir(a.case) else tplan._case(a.case)
    if not case:
        sys.exit(f"pictures: no case {a.case} in the cases folder")
    why = why_not(case, a.time, a.mean)
    if why:
        sys.exit(f"pictures: {why[1]}")
    at = a.time or (mean_times(case) if a.mean else times(case))[-1]
    sets = os.path.join(config.settings()["workspace"], PICTURES)
    out = a.out or os.path.join(sets, os.path.basename(os.path.normpath(case)), set_name(at, a.mean))
    try:
        doc = make(case, out, at, kinds, a.mean, os.path.join(sets, SELFTEST))
    except (RuntimeError, OSError) as e:
        sys.exit(f"pictures: {e}")
    for n in doc["notes"]:
        print(f"pictures: {n}")
    print(f"pictures: {len(doc['pictures'])} made, in {out}")


if __name__ == "__main__":
    main(sys.argv[1:])
