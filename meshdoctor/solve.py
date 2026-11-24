# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Solving a case Mesh Doctor made: split onto processes, started with potentialFoam, then foamRun to an iteration;
later continued from its latest written time, or stopped early at a written time.

    python3 -m meshdoctor solve <case> [--to N] [--np P]
    python3 -m meshdoctor solve <srcCase> <name> [--to N] [--np P]
    python3 -m meshdoctor solve <name> --template <template> [--size S] [--to N] [--np P]
    python3 -m meshdoctor solve <name> --steady <run> [--co C] [--model DDES|URANS] [--to SECONDS] [--writes N]
                                [--np P]

<case> is a case in the cases folder that Mesh Doctor made (python3 -m meshdoctor new, or a copy made here).  A case
you made is never changed, so it is solved through a copy: with <srcCase> and a new <name>, its mesh and settings,
not its results, are copied into the cases folder as <name>, with the marker of a case made here, and the copy is
solved.  With --template, the new case <name> is first made from that template (at --size, else the template's own),
as `new` makes one, then solved: Verify install solves the Ahmed body's coarse mesh this way to iteration 2000, and
GET /api/v1/runs/{name}/validation compares its drag with the wind tunnel's (validate.py).  While no iteration is
written, a solve splits the case onto P processes (4 by default; 1 solves it whole), starts the flow with
potentialFoam and runs foamRun to iteration N (2000 by default).  Once one is written, a solve continues from the
latest to N, on the same processes.  With --steady, the new case <name> is a transient run of that solved steady run
(transient.py): its mesh, settings and latest result, solved in time with DDES (the default) or URANS at a largest
Courant number of C (1 by default) to SECONDS of flow (8 L/U by default), with no potentialFoam, as it starts from the
steady flow.  A transient run counts seconds, not iterations: its --to, its progress and its continuations are times.
Each of its stretches writes 4 times, evenly to its end, or N (--writes, 1 to 200; given with a continuation, the run
writes N a stretch from then on), and it keeps every time it writes, for pictures of the flow over time; on several
processes the latest of each stretch is joined.
It averages its flow (transient.py's meanFlow: UMean, pMean, UPrime2Mean, pPrime2Mean) from when its forces have
settled: as it solves, the solve reads its forces every AVERAGE_CHECK_S, and before each stretch, and once they have
settled (the transient judge's rule) switches the averaging on, which OpenFOAM takes up at its next time step; its
status says from when.  The run's state is in the case's .meshdoctor-solve.json, which GET /api/v1/runs lists.  The app starts the same thing
as a `solve` job (POST /api/v1/jobs, with a `source` to solve a copy, a `template` to make the case first, or a
`steady` run to start a transient one from), which runs `solve.py run`; Stop (POST /api/v1/runs/{name}/stop) ends it
at a written time.  Before a solve starts, the disk guard (diskguard.py) checks that the new case it makes and
what it writes as it goes fit on the disk.  A solve run here, in a terminal, has no job: its status file names its process, so the engine
knows that it solves (GET /api/v1/runs says running, not interrupted), Stop works on it as on a job's, and no job
starts until it has ended (jobs.busy).  Ctrl+C ends it too, cancelled at the iteration it wrote last.
"""
import json, math, os, re, shlex, shutil, signal, subprocess, sys, time

import config
import diskguard
import jobs
import md_api
import prog
import ramguard
import templates
import transient

PKG = os.path.dirname(os.path.abspath(__file__))
STATUS = jobs.SOLVE_STATUS
LOGS = ".runs"                        # the solve jobs' logs, in the workspace
POLL_S = 2.0
MAX_ITERS = 100_000
TIME = re.compile(rb"^Time = ([0-9.eE+-]+)s?[ \t]*$", re.M)
NAME_RULE = "a case name is letters, digits and _ . - (not . or - first), at most 80 characters"
WHOLE = "a steady run counts whole iterations: give a whole number"
STEADY_WRITES = "the times a stretch writes go with a transient run; a steady run writes about four times a stretch"
SKEW_S = 60     # OpenFOAM re-reads a changed controlDict only once its time is past the one it read by more than its
                # fileModificationSkew (10 s in OpenFOAM 14, 30 s in some), so a Stop moves the file's time on past it
AVERAGE_CHECK_S = 30            # a transient run's forces are read this often as it solves, until they have settled


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def case_dir(name):
    return os.path.join(config.settings()["cases"], name)


def status_of(case):
    """The run's status file, or None before its first solve."""
    doc = md_api._read_json(os.path.join(case, STATUS))
    return doc if isinstance(doc, dict) else None


def split(case):
    """How many processes the case is split onto (its processor* folders); 0 when it isn't."""
    try:
        return sum(1 for n in os.listdir(case) if re.fullmatch(r"processor\d+", n))
    except OSError:
        return 0


def num(x):
    """A time as the API gives it: a whole number as an int (a steady run's iterations), else a float (seconds)."""
    x = float(x)
    return int(x) if x.is_integer() else x


def latest_name(case):
    """The folder name of the run's latest written time: the processors' when it is split, else the case's own; "0"
    if none."""
    best, name = 0.0, "0"
    try:
        for n in os.listdir(os.path.join(case, "processor0") if split(case) else case):
            try:
                if float(n) > best:
                    best, name = float(n), n
            except ValueError:
                pass
    except OSError:
        pass
    return name


def latest(case):
    """The run's latest written iteration (seconds for a transient run): the processors' when it is split, else the
    case's own; 0 if none."""
    return num(latest_name(case))


def transient_of(case):
    """A transient run's origin, from its marker: {steady, at, maxCo, model, writes}; None for a steady run.  `writes`:
    the times each stretch writes (transient.WRITES for a run that never asked, as one made before it could)."""
    doc = md_api._read_json(os.path.join(case, jobs.CASE_MARKER))
    if not isinstance(doc, dict) or not doc.get("transientOf"):
        return None
    return {"steady": str(doc["transientOf"]), "at": str(doc.get("at") or ""), "maxCo": doc.get("maxCo"),
            "model": doc.get("model"), "writes": doc["writes"] if writes_ok(doc.get("writes")) else transient.WRITES}


def writes_ok(writes):
    """Is `writes` the times a stretch may write: a whole number from 1 to transient.MAX_WRITES?"""
    return isinstance(writes, int) and not isinstance(writes, bool) and 1 <= writes <= transient.MAX_WRITES


def times(case):
    """The written times run folder `case` keeps, as numbers, oldest first, and those of them joined: (times, joined).
    Its processors' and its own (joined) when it is split, else its own; not its start (0)."""
    def listed(folder):
        out = set()
        try:
            names = os.listdir(folder)
        except OSError:
            return out
        for n in names:
            try:
                t = float(n)
            except ValueError:
                continue
            if t > 0 and math.isfinite(t) and os.path.isdir(os.path.join(folder, n)):
                out.add(num(n))
        return out
    joined = listed(case)
    kept = (listed(os.path.join(case, "processor0")) | joined) if split(case) else joined
    return sorted(kept), sorted(joined)


def own_size(template):
    """The mesh size a template makes a case at when none is asked for ("" for no such template)."""
    return templates.TEMPLATES.get(template, {}).get("size", "")


def default_to(name, to, steady=None):
    """What a solve runs to when it isn't said: 2,000 iterations for a steady run; for a new transient run of a steady
    one, 8 flow times over the body (transient.flow_time); None for a transient run's continuation, which must say."""
    if to is not None:
        return num(to)
    if steady is not None:
        return transient.flow_time(case_dir(steady)) if md_api.SAFE.match(steady) else None
    if md_api.SAFE.match(name) and transient_of(case_dir(name)):
        return None
    return 2000


def refusal(name, to, nproc=None, source=None, template=None, size=None, steady=None, co=None, model=None,
            writes=None):
    """Why case `name` can't be solved to iteration `to` (a time in s for a transient run) now, as (code, message) with
    no paths, or None.  With a `source`, `name` is the new case a copy of it goes in; with a `template`, the new case
    made from it; with a `steady` run, the new transient run of it, at a largest Courant number `co` with `model`.
    `writes`, the times a stretch writes, goes with a transient run, new or continued."""
    if not md_api.SAFE.match(name):
        return "bad-request", NAME_RULE
    if to is not None and not math.isfinite(to):
        return "bad-request", "the time or iteration to solve to is a number"
    whole = to is None or float(to).is_integer()
    if source is not None and template is not None:
        return "bad-request", "a solve makes its new case from a source case or from a template, not both"
    if steady is not None and (source is not None or template is not None):
        return "bad-request", "a transient run starts from a steady run alone, not from a source case or a template"
    if size is not None and template is None:
        return "bad-request", "a mesh size goes with a template"
    if (co is not None or model is not None) and steady is None:
        return "bad-request", "a Courant number and a model go with a steady run, to start a transient run of it"
    if writes is not None and not writes_ok(writes):
        return "bad-request", f"the times a stretch writes is a whole number from 1 to {transient.MAX_WRITES}"
    if writes is not None and (source is not None or template is not None):
        return "bad-request", STEADY_WRITES
    if (template is not None or source is not None) and not whole:
        return "bad-request", WHOLE
    if template is not None:
        return templates.problem(template, size or own_size(template)) or templates.refusal(name) or _procs(nproc)
    if source is not None:
        return copy_refusal(source) or templates.refusal(name) or _procs(nproc)
    if steady is not None:
        why = (steady_refusal(steady, 1.0 if co is None else co, model or "DDES") or templates.refusal(name)
               or _procs(nproc))
        if why or (to is not None and to > 0):
            return why
        return "bad-request", (f"{steady}'s settings don't say its body's length and speed (lRef in its force "
                               "coefficients, and 0/U): give the time in s to solve to")
    case = case_dir(name)
    if os.path.islink(case) or not os.path.isfile(os.path.join(case, "system", "controlDict")):
        return "not-found", f"no case {name} in the cases folder"
    made = md_api._read_json(os.path.join(case, jobs.CASE_MARKER))
    if not isinstance(made, dict):
        return "unsupported", (f"{name} is a case you made, which Mesh Doctor never changes: solve a copy of it, "
                               "under a new name")
    if made.get("state") != "done":
        return "not-ready", f"{name} has no mesh yet: make it again first"
    unsteady = transient_of(case) is not None
    if writes is not None and not unsteady:
        return "bad-request", f"{name} is a steady run: {STEADY_WRITES}"
    if to is None:
        return "bad-request", (f"{name} is a transient run: give the time in s to continue it to" if unsteady else
                               "give the iteration to solve to")
    if not unsteady and not whole:
        return "bad-request", f"{name} is a steady run, which counts whole iterations: give a whole number"
    at = latest(case)
    if at == 0:                                 # a fresh start: its processes
        return _procs(nproc)
    if to <= at:                                # a continuation: past what is written
        return "bad-request", (f"{name} is solved to {at:g} s already; continue it to a later time" if unsteady else
                               f"{name} is solved to iteration {at} already; continue it to a later one")
    return None


def steady_refusal(steady, co, model):
    """Why a transient run of run `steady` can't start now, at a largest Courant number `co` with `model`, as (code,
    message) with no paths, or None."""
    if not md_api.SAFE.match(steady):
        return "bad-request", NAME_RULE
    if model not in transient.MODELS:
        return "bad-request", f"the model is {' or '.join(transient.MODELS)}"
    if not 0 < co <= transient.MAX_CO:
        return "bad-request", f"the largest Courant number is more than 0 and at most {transient.MAX_CO:g}"
    if model == "DDES" and co > transient.MAX_DDES_CO:
        return "bad-request", ("DDES resolves the wake's eddies, which needs a largest Courant number of about 1: ask "
                               f"for {transient.MAX_DDES_CO:g} or less, or for URANS")
    case = case_dir(steady)
    if os.path.islink(case) or status_of(case) is None:
        return "not-found", f"no run {steady}: a transient run starts from a solved steady run"
    if transient_of(case):
        return "unsupported", f"{steady} is a transient run already: continue it instead"
    if solving(steady):
        return "not-ready", f"{steady} is solving: wait for it to end, or stop it"
    if latest(case) == 0:
        return "not-ready", f"{steady} has no solved result yet: solve it first"
    if transient.result(case) is None:
        return "not-ready", f"{steady}'s latest result is still split onto its processors: continue it, which joins it"
    why = transient.unsupported(case, model)
    return ("unsupported", f"{steady}: {why}") if why else None


def _procs(nproc):
    cpus = os.cpu_count() or 1
    if nproc is not None and nproc > cpus:
        return "bad-request", f"this computer has {cpus} processors; ask for {cpus} or fewer"
    return None


def copy_refusal(source):
    """Why a copy of case `source` can't be solved, as (code, message) with no paths, or None.  A copy needs the
    case's mesh, joined (constant/polyMesh), its initial fields (0, or 0.orig) and a steady setup foamRun runs: a
    solver entry in its controlDict, and steadyState time schemes."""
    if not md_api.SAFE.match(source):
        return "bad-request", NAME_RULE
    src = case_dir(source)
    if not os.path.isfile(os.path.join(src, "system", "controlDict")):
        return "not-found", f"no case {source} in the cases folder"
    if md_api._unfinished(src):
        return "not-ready", f"{source} has no mesh yet: make it again first"
    def mesh(where):
        return any(os.path.isfile(os.path.join(src, where, "constant", "polyMesh", f)) for f in ("owner", "owner.gz"))
    if not mesh(""):
        return "not-ready", (f"{source}'s mesh is split onto its processors only: join it first (reconstructParMesh)"
                             if mesh("processor0") else f"{source} has no mesh (constant/polyMesh)")
    if not any(os.path.isdir(os.path.join(src, z)) for z in ("0", "0.orig")):
        return "unsupported", f"{source} has no initial fields (a 0 or 0.orig folder)"
    control, schemes = (_plain(os.path.join(src, "system", f)) for f in ("controlDict", "fvSchemes"))
    if not re.search(r"^[ \t]*solver[ \t]+\w+[ \t]*;", control, re.M):
        return "unsupported", (f"{source}'s controlDict names no solver: Mesh Doctor solves with foamRun (OpenFOAM 11 "
                               "or later), which needs one, such as solver incompressibleFluid;")
    if not re.search(r"\bddtSchemes\s*\{[^}]*\bdefault\s+steadyState\s*;", schemes):
        return "unsupported", f"{source} is a transient case: Mesh Doctor solves steady cases for now"
    return None


def _purge(case):
    """The written times case folder `case` keeps: its controlDict's purgeWrite (0, or none set: every one)."""
    m = re.search(r"^[ \t]*purgeWrite[ \t]+(\d+)[ \t]*;", _plain(os.path.join(case, "system", "controlDict")), re.M)
    return int(m.group(1)) if m else 0


def _mesh_mb(case):
    """The MB of case folder `case`'s mesh (constant/polyMesh), or None when it has none."""
    poly = os.path.join(case, "constant", "polyMesh")
    return diskguard.mb(diskguard.size(poly)) if os.path.isdir(poly) else None


def disk(name, writes=None):
    """GET /disk's case: what solving case `name` takes on the disk, in MB.  A copy of it (copyMb), a transient run of
    it (transientMb: its copy, with its latest result in place of its initial fields; None with no joined result),
    and what a solve writes as it goes, on several processes or one (diskguard.solve_mb): from the start (solveMb),
    as a copy of it does too, and continued (continueMb), a transient run's with its averages and every time it
    writes kept; and a transient run of it from the start (transientSolveMb, with its averages and every time it
    writes kept; None with no joined result); None with no mesh to measure.  A transient run's stretch writes
    `writes` times, else its own; a new transient run of it, `writes`, else transient.WRITES."""
    case = case_dir(name)
    mesh, made, of = _mesh_mb(case), transient.make_size(case), transient_of(case)

    def solves(first, unsteady, n_writes):
        purge = 0 if unsteady else _purge(case)
        return None if mesh is None else {k: diskguard.solve_mb(mesh, purge, n, first, unsteady, n_writes)
                                          for k, n in (("several", 2), ("one", 1))}
    own = (writes or of["writes"]) if of else diskguard.STRETCH           # a steady run writes about four a stretch
    return {"name": name, "copyMb": diskguard.mb(templates.copy_size(case)),
            "transientMb": None if made is None else diskguard.mb(made),
            "solveMb": solves(True, of is not None, own), "continueMb": solves(False, of is not None, own),
            "transientSolveMb": None if made is None else solves(True, True, writes or transient.WRITES)}


def template_disk(template, size=None):
    """GET /disk's template: what a solve job that makes a case of `template` at `size` (else the template's own)
    takes on the disk, in MB, as disk_need counts it: the new case (madeMb: its mesh and its sets, from the cells it
    makes, diskguard.made_mb), then what its solve writes as it goes from the start, on several processes or one
    (solveMb, diskguard.solve_mb, keeping the written times the template's controlDict keeps)."""
    size = size or own_size(template)
    cells = templates.TEMPLATES[template]["sizes"][size]["cells"]
    mesh, purge = diskguard.mesh_mb(cells), _purge(os.path.join(templates.EXAMPLES, template))
    return {"name": template, "size": size, "madeMb": diskguard.made_mb(cells),
            "solveMb": {k: diskguard.solve_mb(mesh, purge, n) for k, n in (("several", 2), ("one", 1))}}


def disk_need(name, nproc, source=None, template=None, size=None, steady=None, writes=None):
    """What the solve job of case `name` writes on the disk, for the disk guard: (MB, what needs it, with its verb).
    The new case it makes (a copy of `source`, a transient run of `steady`, or a case of `template` at `size`: its
    mesh and its sets, diskguard.made_mb), then what it writes as it goes (diskguard.solve_mb): from the start on
    `nproc` processes, or continued on the run's own split; a transient run's `writes` times a stretch (else its
    own), each kept.  None when the mesh it solves can't be measured."""
    if template is not None:
        t = template_disk(template, size)              # as GET /disk says it (template_disk)
        return t["madeMb"] + t["solveMb"]["several" if nproc > 1 else "one"], f"{name}'s mesh and its solve need"
    if source is not None or steady is not None:
        src = case_dir(source if source is not None else steady)
        made = (templates.copy_size(src, case_dir(name)) if source is not None
                else transient.make_size(src, case_dir(name)))
        mesh = _mesh_mb(src)
        if made is None or mesh is None:
            return None
        what = f"the copy of {source}" if source is not None else f"the transient run of {steady}"
        solved = (diskguard.solve_mb(mesh, _purge(src), nproc) if source is not None else
                  diskguard.solve_mb(mesh, 0, nproc, averaged=True, writes=writes or transient.WRITES))
        return diskguard.mb(made) + solved, f"{what} and its solve need"
    case = case_dir(name)
    mesh, first, of = _mesh_mb(case), latest(case) == 0, transient_of(case)
    if mesh is None:
        return None
    return (diskguard.solve_mb(mesh, 0 if of else _purge(case), nproc if first else split(case) or 1, first,
                               of is not None, writes or (of["writes"] if of else diskguard.STRETCH)),
            f"the solve of {name} needs" if first else f"the continuation of {name} needs")


def _plain(path):
    """An OpenFOAM dictionary's text without its comments ('' when it can't be read)."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read(1_000_000)
    except OSError:
        return ""
    return re.sub(r"/\*.*?\*/|//[^\n]*", "", text, flags=re.S)


def start(name, to, nproc, source=None, template=None, size=None, steady=None, co=None, model=None, writes=None):
    """Start a solve job (POST /jobs, kind "solve"): the job, or a refusal, as md_api's other starts answer.  With a
    `source`, the job first copies that case into the new case `name`, then solves the copy; with a `template`, it
    first makes `name` from the template (at `size`, else the template's own), then solves it; with a `steady` run, it
    first makes `name` a transient run of it (transient.py), then solves that to `to` s.  With no `to`: 2,000
    iterations, or 8 flow times for a new transient run (default_to).  `writes`: the times each stretch of a
    transient run writes, from this one on (else 4 for a new one, the run's own for a continuation)."""
    if steady is not None:
        co, model = num(1.0 if co is None else co), model or "DDES"
    to = default_to(name, to, steady)
    why = refusal(name, to, nproc, source, template, size, steady, co, model, writes)
    if why:
        return md_api._refuse(*why)
    ws = config.settings()["workspace"]
    config.ensure_workspace(ws)
    os.makedirs(os.path.join(ws, LOGS), mode=0o700, exist_ok=True)
    made = {} if template is None else {"template": template, "size": size or own_size(template)}
    unsteady = {} if steady is None else {"steady": steady, "maxCo": co, "model": model}
    cmd = [sys.executable, os.path.join(PKG, "solve.py"), "run", *([] if source is None else [source]), name,
           *(["--template", made["template"], "--size", made["size"]] if made else []),
           *(["--steady", steady, "--co", str(co), "--model", model] if unsteady else []), "--to", str(to),
           *([] if writes is None else ["--writes", str(writes)]), "--np", str(nproc)]
    params = {"name": name, "to": to, "np": nproc, **({} if source is None else {"source": source}), **made,
              **unsteady, **({} if writes is None else {"writes": writes})}
    # a case made first needs its mesh's memory, more than its solve's; else the solve's own (a transient run's is
    # its steady run's: the same mesh)
    ram = ((templates.TEMPLATES[template]["sizes"][made["size"]]["cells"], "mesh") if made
           else (case_dir(steady if steady is not None else name if source is None else source), "solve"))
    need = disk_need(name, nproc, source, template, size, steady, writes)    # the new case, and what it writes
    disk = None if need is None else (need[0], case_dir(name), need[1])
    return md_api._submit("solve", params, name, cmd, log=f"{LOGS}/{name}_to_{to}.log", ram=ram,   # a log per stretch
                          disk=disk)


def stop(name):
    """Stop: the run writes its current iteration and ends (stopAt writeNow), then the job ends as stopped.  The run
    (GET /runs/{name}), or (code, message)."""
    if not md_api.SAFE.match(name):
        return None, ("bad-request", "bad run name")
    case = case_dir(name)
    st = status_of(case)
    if st is None:
        return None, ("not-found", f"no run {name}")
    if not solving(name):
        return None, ("not-ready", f"{name} isn't solving now")
    end_now = "cancel its job to end it now" if _job_of(name) else "Ctrl+C in its terminal ends it now"
    if st.get("step") == "copying":
        return None, ("not-ready", f"{name} is being copied: Stop works once it solves ({end_now})")
    if str(st.get("step") or "").startswith("meshing"):
        return None, ("not-ready", f"{name} is being meshed: Stop works once it solves ({end_now})")
    path = os.path.join(case, "system", "controlDict")
    try:
        read = os.stat(path).st_mtime           # the time the solver read it at (each stretch writes it first)
    except OSError:
        read = None
    _stop_at(case, "writeNow")
    if read is not None:                        # a Stop a few seconds into a stretch would go unnoticed
        t = max(time.time(), read + SKEW_S)
        os.utime(path, (t, t))
    return describe(name), None


# --------------------------------------------------------------------------
# what GET /runs and /runs/{name} answer

def _job_of(name):
    """The solve job of case `name` that is queued or running, or None."""
    return next((j for j in jobs.list_jobs(limit=1000)
                 if j["kind"] == "solve" and j["name"] == name and j["state"] in jobs.ACTIVE), None)


def solving(name):
    """Is case `name` solving now: a solve job of it queued or running, or a solve run in a terminal, whose status
    file says running and names its live process (jobs.solve_alive)?"""
    if _job_of(name) is not None:
        return True
    st = status_of(case_dir(name))
    return st is not None and st.get("state") == "running" and jobs.solve_alive(name, st)


def runs():
    """Every case with a run, newest first (by its status file's time)."""
    root = config.settings()["cases"]
    try:
        names = [n for n in os.listdir(root) if md_api.SAFE.match(n) and os.path.isfile(os.path.join(root, n, STATUS))]
    except OSError:
        return []
    out = [describe(n) for n in names]
    return sorted((r for r in out if r), key=lambda r: r.get("updated") or "", reverse=True)


def describe(name):
    """A run as the API shows it: its status file, with its state checked against what solves it (a run that no
    job and no solve in a terminal is solving says interrupted), the iteration written last, and its split."""
    case = case_dir(name)
    st = status_of(case)
    if st is None:
        return None
    state = st.get("state")
    if state == "running" and not solving(name):
        state = "interrupted"
    of = transient_of(case)
    return {"name": name, "state": state, "step": st.get("step") or "", "iteration": st.get("iteration"),
            "start": st.get("start", 0), "end": st.get("end"), "written": latest(case), "nProcs": st.get("nProcs"),
            "stretches": st.get("stretches", []), "started": st.get("started"), "updated": st.get("time"),
            "finished": st.get("finished"), "error": st.get("error"), "transient": of,
            "averaging": transient.averaging(case, st) if of else None, **dict(zip(("times", "joined"), times(case)))}


# --------------------------------------------------------------------------
# solving (the job's command, and the CLI's)

class Status:
    """The run's status file: what the job is doing, the iteration it is at, and the stretches solved so far."""

    def __init__(self, case, start_at, end, nproc, keep=True):
        self.case, self.path = case, os.path.join(case, STATUS)
        old = (status_of(case) or {}) if keep else {}
        # pid and pidStart: the process solving it, so the engine can tell it runs, with or without a job (solving)
        self.doc = {"madeBy": "Mesh Doctor", "state": "running", "step": "", "iteration": start_at,
                    "start": start_at, "end": end, "nProcs": nproc, "started": now(), "time": now(),
                    "finished": None, "error": None, "fraction": 0.0, "stretches": old.get("stretches", []),
                    "pid": os.getpid(), "pidStart": jobs.started(os.getpid())}
        if old.get("averaging"):                # a transient run's: when its averaging was switched on
            self.doc["averaging"] = old["averaging"]
        self._write()

    def step(self, step, fraction, **more):
        self.doc.update(step=step, fraction=fraction, time=now(), **more)
        self._write()

    def end(self, state, error=None):
        """The stretch ends at the latest written iteration, which a continuation starts from, however it ended (a
        cancelled or failed solve keeps what it wrote)."""
        written = latest(self.case)
        if written > self.doc["start"]:
            self.doc["stretches"].append({"from": self.doc["start"], "to": written})
        self.doc["iteration"] = max(self.doc["iteration"] or 0, written)    # the log is read every POLL_S only
        self.doc.update(state=state, error=error, time=now(), finished=now(),
                        **({"step": "done", "fraction": 1.0} if state in ("done", "stopped") else {}))
        self._write()

    def _write(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.doc, f, indent=1)
        os.replace(tmp, self.path)


class _Meshing:
    """While a solve job makes its case from a template (templates.build): the case's marker follows Allmesh, and the
    run's status file says so too (meshing, then meshing: <Allmesh's step>), which is the job's progress."""

    def __init__(self, made, status):
        self.made, self.status, self.doc = made, status, made.doc

    def step(self, step):
        self.made.step(step)
        at = "meshing" if step == "copying" else f"meshing: {step}"
        if self.status.doc["step"] != at:
            self.status.step(at, 0.0)

    def end(self, state, cells=None):
        self.made.end(state, cells)


def _set(case, rel, entry, value):
    """Set `entry value;` at the top level of an OpenFOAM dictionary file (added when it isn't there, with a space
    before the value however long the entry: numberOfSubdomains is longer than the column)."""
    path = os.path.join(case, rel)
    with open(path, encoding="utf-8") as f:
        text = f.read()
    pattern = re.compile(r"^(" + re.escape(entry) + r"\s+)[^;\n]*(;)", re.M)
    text, n = pattern.subn(lambda m: m.group(1) + str(value) + m.group(2), text, count=1)
    if not n:
        text = text.rstrip("\n") + f"\n{entry:<15} {value};\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def _stop_at(case, how):
    _set(case, os.path.join("system", "controlDict"), "stopAt", how)


def write_interval(start_at, end):
    """Write about four times over the stretch, and at its end: the largest divisor of `end` no more than a quarter of
    the stretch (OpenFOAM writes when the iteration is a multiple of writeInterval)."""
    for d in range(max(1, (end - start_at) // 4), 0, -1):
        if end % d == 0:
            return d
    return 1


def _foam(case, cmd, log):
    """Start an OpenFOAM program in the case with OpenFOAM's environment, its output in the case's log file."""
    bashrc = shlex.quote(config.settings()["bashrc"])
    out = open(os.path.join(case, log), "w")
    try:
        return subprocess.Popen(["bash", "-c", f"source {bashrc} >/dev/null 2>&1; "
                                 f"[ -n \"$WM_PROJECT_DIR\" ] || exit 2; exec {cmd}"],
                                cwd=case, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT)
    finally:
        out.close()


def _say(text):
    print(text, flush=True)


def _fail(status, program, rc):
    if rc == 2:
        msg = f"OpenFOAM's environment didn't load: check the bashrc setting ({prog.name()} config)"
    else:
        msg = f"the solve failed at {program}: see log.{program} in the case's folder"
    status.end("failed", msg)
    _say(msg)
    return 1


def run(name, to, nproc, source=None, template=None, size=None, steady=None, co=None, model=None, writes=None):
    """Solve case `name` to iteration `to` (a time in s for a transient run): from 0 on `nproc` processes, else from
    the latest written one on the run's own split.  With a `source`, `name` is made first, as a copy of it (_copy);
    with a `template`, it is made first from the template, as a case job makes one (templates.build); with a `steady`
    run, it is made first as a transient run of it (_make_transient), writing `writes` times a stretch (4 unless
    asked), which a transient run's continuation can change from then on.  0 when it ran to `to` or was stopped at a
    written time."""
    why = refusal(name, to, source=source, template=template, size=size, steady=steady, co=co, model=model,
                  writes=writes)
    if why:
        _say(why[1])
        return 1
    case = case_dir(name)
    made = None
    copied = source is not None or steady is not None       # a copy cut short is no case: its folder goes
    if copied or template is not None:
        try:
            os.mkdir(case)
        except FileExistsError:
            _say(f"a case named {name} exists already; pick another name")
            return 1
        if source is not None:
            made = templates.Status(case, copyOf=source)      # its marker: a case made here, being copied
            made.step("copying")
        elif steady is not None:                              # and a transient run of a steady one, being made
            made = templates.Status(case, transientOf=steady, at=transient.result(case_dir(steady))[0], maxCo=co,
                                    model=model, writes=writes or transient.WRITES)
            made.step("copying")
        else:
            size = size or own_size(template)
            made = templates.Status(case, template=template, size=size)     # its marker: a case made here, being made
    if writes is not None and not copied:       # a transient run's continuation: its writes from now on
        _remember_writes(case, writes)
    start_at = latest(case)
    first = start_at == 0                       # nothing written yet (as the template's Allrun): split, then start
    nproc = (nproc if first else split(case)) or 1
    status = Status(case, start_at, to, nproc, keep=not first)
    if made is not None:
        status.step("copying" if copied else "meshing", 0.0)

    def ended():                                # cancelled
        if copied and made.doc["state"] != "done":
            _discard(case)                      # a copy cut short is no case, so its name is free again
        elif made is not None and made.doc["state"] != "done":
            made.end("cancelled")               # a case cut short while it was made says so, as a case job's does
            status.end("cancelled")
        else:
            status.end("cancelled")

    def term(sig, frame):                       # cancelled: say so in the status file, then end as the signal would
        ended()
        sys.exit(128 + sig)
    before = signal.getsignal(signal.SIGTERM)
    signal.signal(signal.SIGTERM, term)
    try:
        if source is not None and not _copy(source, case, made):
            return 1
        if steady is not None and not _make_transient(steady, case, made, co, model, to, writes or transient.WRITES):
            return 1
        if template is not None:
            t = templates.TEMPLATES[template]
            why = templates.build(case, name, t, t["sizes"][size], _Meshing(made, status))
            if why:
                status.end("failed", why)
                _say(why)
                return 1
        return _solve(case, name, first, start_at, to, nproc, status, transient_of(case) is not None)
    except KeyboardInterrupt:
        ended()
        _say("stopped")
        return 130
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_DFL if before is None else before)


def _copy(source, case, made):
    """Make the new case a copy of case `source`'s mesh and settings, not its results (templates.copy), which counts
    its iterations as its times (deltaT 1) and writes by iteration.  On any failure the folder goes, so its name is
    free again.  True once the copy is made."""
    _say(f"copying {source}: its mesh and settings, not its results")
    try:
        cells = templates.copy(case_dir(source), case)
        for entry, value in (("deltaT", 1), ("writeControl", "timeStep")):
            _set(case, os.path.join("system", "controlDict"), entry, value)
    except OSError as e:                        # shutil.Error too
        _discard(case)
        _say(f"the copy of {source} failed: {_reason(e)}")
        return False
    made.end("done", cells)
    _say(f"copied {source}" + (f": {cells:,} cells" if cells else ""))
    return True


def _remember_writes(case, writes):
    """A transient run's continuation asked for `writes` times a stretch: the run's marker keeps it, for this stretch
    and the ones after."""
    path = os.path.join(case, jobs.CASE_MARKER)
    doc = md_api._read_json(path)
    if isinstance(doc, dict) and doc.get("transientOf") and doc.get("writes") != writes:
        doc["writes"] = writes
        tmp = path + ".tmp"                     # as templates.Status writes it: whole, or not at all
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=1)
        os.replace(tmp, path)


def _make_transient(steady, case, made, co, model, to, writes):
    """Make the new case a transient run of the steady run (transient.make): its mesh, settings and latest result,
    with settings for a transient solve, writing `writes` times a stretch.  On any failure the folder goes, so its
    name is free again.  True once it is made."""
    _say(f"making a transient run of {steady} ({model}, largest Courant number {co:g}, to {to:g} s): its mesh, "
         "settings and latest result")
    try:
        cells = transient.make(case_dir(steady), case, co, model, to, writes)
    except (OSError, ValueError) as e:          # shutil.Error too; ValueError: a settings file it couldn't read
        _discard(case)
        _say(f"the transient run of {steady} couldn't be made: {_reason(e) if isinstance(e, OSError) else e}")
        return False
    made.end("done", cells)
    _say(f"made the transient run of {steady}" + (f": {cells:,} cells" if cells else ""))
    return True


def _reason(e):
    """Why a copy failed, in the system's words and naming no folders (No space left on device)."""
    if e.strerror:
        return e.strerror
    for item in e.args[0] if e.args and isinstance(e.args[0], list) else []:   # shutil.Error: (src, dst, why)s
        m = re.search(r"\] ([^:']+)", str(item[-1]) if isinstance(item, tuple) else "")
        if m:
            return m.group(1).strip()
    return "a file couldn't be copied"


def _discard(case):
    """Remove a copy cut short: the folder its job made (os.mkdir), with all it holds."""
    shutil.rmtree(case, ignore_errors=True)


def _solve(case, name, first, start_at, to, nproc, status, unsteady=False):
    """Solve to `to`.  A transient run (`unsteady`) starts from its latest written time by name (in parallel, OpenFOAM
    looks for the latest time in the case's own folder, which a stretch that was cut short hasn't joined), writes its
    `writes` times a stretch (transient_of) at run times OpenFOAM's time steps land on, keeps every one (purgeWrite 0,
    a run made before it from then on too), and has no potentialFoam: it starts from the steady run's flow."""
    parallel = nproc > 1
    when = (lambda t: f"{t:g} s") if unsteady else (lambda t: f"iteration {t}")
    _say(f"{name}: {'solving' if first else 'continuing'} from {when(start_at)} to {f'{to:g} s' if unsteady else to}"
         f"{f' on {nproc} processes' if parallel else ''}")
    begin = latest_name(case)                   # OpenFOAM 14 writes at beginTime + k writeInterval: the last is `to`
    writes = transient_of(case)["writes"] if unsteady else None
    entries = ((("startFrom", "startTime"), ("startTime", begin), ("beginTime", begin), ("stopAt", "endTime"),
                ("endTime", to), ("writeInterval", f"{(to - start_at) / writes:.6g}"), ("purgeWrite", 0))
               if unsteady else
               (("startFrom", "latestTime"), ("stopAt", "endTime"), ("endTime", to),
                ("writeInterval", write_interval(start_at, to))))
    for entry, value in entries:
        _set(case, os.path.join("system", "controlDict"), entry, value)
    mpi = f"mpirun --oversubscribe -np {nproc} " if parallel else ""
    par = " -parallel" if parallel else ""
    if first:
        if parallel:
            status.step("decomposing", 0.01)
            _dictionary(case, os.path.join("system", "decomposeParDict"))     # a copy of yours may have none
            _set(case, os.path.join("system", "decomposeParDict"), "numberOfSubdomains", nproc)
            for key in ("decomposer", "method"):  # OpenFOAM 14 reads decomposer; older dictionaries say method
                _set(case, os.path.join("system", "decomposeParDict"), key, "scotch")
            rc = _foam(case, "decomposePar -force", "log.decomposePar").wait()
            if rc:
                return _fail(status, "decomposePar", rc)
        else:
            _unsplit(case)
        if not unsteady:                        # a transient run starts from its steady run's flow
            status.step("potentialFoam", 0.03)
            rc = _foam(case, f"{mpi}potentialFoam -initialiseUBCs{par}", "log.potentialFoam").wait()
            if rc:
                return _fail(status, "potentialFoam", rc)
    log = "log.foamRun" if first else f"log.foamRun_to_{to}"
    status.step("solving", 0.05)
    # A transient run averages its flow from when its forces have settled: in an earlier stretch, or as it solves
    average = unsteady and transient.average_state(case) == "off"
    if average and _average(case, name, status, start_at):
        average = False
    p = _foam(case, f"nice -n 5 {mpi}foamRun{par}", log)
    seen, it = 0, start_at
    span = (to - start_at) if unsteady else max(1, to - start_at)
    checked = time.monotonic()
    while True:
        try:
            rc = p.wait(timeout=POLL_S)
            break
        except subprocess.TimeoutExpired:
            seen, it = _iteration(os.path.join(case, log), seen, it)
            status.step("solving", round(0.05 + 0.92 * (it - start_at) / span, 3) if span > 0 else 0.05, iteration=it)
            if average and time.monotonic() - checked >= AVERAGE_CHECK_S:
                checked = time.monotonic()
                average = not _average(case, name, status, it)
    seen, it = _iteration(os.path.join(case, log), seen, it)
    status.doc["iteration"] = it
    stopped = re.search(r"^[ \t]*stopAt[ \t]+writeNow[ \t]*;", _plain(os.path.join(case, "system", "controlDict")),
                        re.M) is not None
    _stop_at(case, "endTime")                   # a Stop's writeNow ends this run only
    if rc:
        return _fail(status, "foamRun", rc)
    if parallel:
        status.step("reconstructing", 0.97)
        rc = _foam(case, "reconstructPar -latestTime", "log.reconstructPar").wait()
        if rc:
            return _fail(status, "reconstructPar", rc)
    # A transient run's last time step lands within half a step of its end, so it is done unless a Stop ended it
    state = ("stopped" if stopped else "done") if unsteady else ("done" if it >= to else "stopped")
    status.end(state)
    if unsteady:
        _say(f"{name}: solved to {it:g} s" + ("" if state == "done" else f", stopped before {to:g} s"))
    else:
        _say(f"{name}: solved to iteration {it}" + ("" if state == "done" else f", stopped before {to}"))
    return 0


def _average(case, name, status, at):
    """Switch a transient run's averaging on (transient.switch_on) once its forces have settled
    (transient.forces_settled), from time `at`, where the solver is, and say so in its status (averaging: from,
    settled).  True once it is on."""
    settled = transient.forces_settled(case)
    if settled is None or not transient.switch_on(case, SKEW_S):
        return False
    status.doc["averaging"] = {"from": at, "settled": settled}
    status._write()
    _say(f"{name}: its forces settled at {settled:g} s: averaging its flow from {at:g} s")
    return True


def _dictionary(case, rel):
    """Make an OpenFOAM dictionary file with just its header, when the case has none."""
    path = os.path.join(case, rel)
    if not os.path.isfile(path):
        with open(path, "w", encoding="utf-8") as f:
            f.write("FoamFile\n{\n    format      ascii;\n    class       dictionary;\n"
                    f"    object      {os.path.basename(rel)};\n}}\n")


def _unsplit(case):
    """A fresh solve on one process: an earlier try's split, which wrote nothing past iteration 0, is removed."""
    for n in os.listdir(case):
        path = os.path.join(case, n)
        if re.fullmatch(r"processor\d+", n):
            if os.path.islink(path) or not os.path.isdir(path):
                os.unlink(path)
            else:
                shutil.rmtree(path)


def _iteration(log, seen, it):
    """The last iteration in the solver log, read from byte `seen` on: (bytes read, iteration)."""
    try:
        with open(log, "rb") as f:
            f.seek(seen)
            new = f.read()
    except OSError:
        return seen, it
    whole = new[:new.rfind(b"\n") + 1]           # a line still being written is read next time
    times = TIME.findall(whole)
    if times:
        try:
            it = num(times[-1])                 # an iteration, or a transient run's time in s
        except ValueError:
            pass
    return seen + len(whole), it


def main(argv):
    job = argv[:1] == ["run"]
    args = argv[1:] if job else argv
    if not args or args[0] in ("-h", "--help"):
        print(prog.text(__doc__))
        return 0 if args else 2
    rest = list(args)
    names = []
    while rest and not rest[0].startswith("-") and len(names) < 2:
        names.append(rest.pop(0))
    if not names:
        print(prog.text(__doc__))
        return 2
    source, name = names if len(names) == 2 else (None, names[0])

    def opt(flag, default):
        try:
            return int(rest[rest.index(flag) + 1]) if flag in rest else default
        except (IndexError, ValueError):
            sys.exit(f"{flag} takes a whole number")

    def number(flag):                           # --to (iterations, or seconds for a transient run) and --co
        try:
            return float(rest[rest.index(flag) + 1]) if flag in rest else None
        except (IndexError, ValueError):
            sys.exit(f"{flag} takes a number")

    def word(flag):
        if flag not in rest:
            return None
        i = rest.index(flag) + 1
        if i >= len(rest) or rest[i].startswith("-"):
            sys.exit(f"{flag} takes a name")
        return rest[i]
    template, size, steady, model, co = word("--template"), word("--size"), word("--steady"), word("--model"), \
        number("--co")
    if steady is not None:
        co, model = num(1.0 if co is None else co), model or "DDES"
    to, nproc, writes = default_to(name, number("--to"), steady), opt("--np", 4), opt("--writes", None)
    if (to is not None and not 0 < to <= MAX_ITERS) or not 1 <= nproc <= 64:
        sys.exit(f"--to is 1 to {MAX_ITERS:,} (seconds for a transient run) and --np 1 to 64")
    why = refusal(name, to, nproc, source, template, size, steady, co, model, writes)
    if why:
        sys.exit(why[1])
    if not job and solving(name):               # a job's own solve is its job, which solving counts
        sys.exit(f"{name} is solving now: wait for it to end, or stop it")
    if not job:                                 # a job's memory was checked when it was admitted (jobs.submit)
        if template is not None:                # its mesh's, more than its solve's
            cells = templates.TEMPLATES[template]["sizes"][size or own_size(template)]["cells"]
            ok, msg = ramguard.check_cells(cells, "mesh")
        else:                                   # a transient run's: its steady run's, the same mesh
            ok, msg = ramguard.check(case_dir(steady or (name if source is None else source)), "solve")
        if not ok:
            sys.exit(msg)
        need = disk_need(name, nproc, source, template, size, steady, writes)    # the disk, as jobs.submit checks
        ok, msg = diskguard.check(need[0], case_dir(name), need[1]) if need else (True, "")
        if not ok:
            sys.exit(msg)
    return run(name, to, nproc, source, template, size, steady, co, model, writes)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
