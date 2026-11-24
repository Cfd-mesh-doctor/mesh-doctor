# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Solving a case Mesh Doctor made: split onto processes, started with potentialFoam, then foamRun to an iteration;
later continued from its latest written time, or stopped early at a written time.

    python3 -m meshdoctor solve <case> [--to N] [--np P]
    python3 -m meshdoctor solve <srcCase> <name> [--to N] [--np P]
    python3 -m meshdoctor solve <name> --template <template> [--size S] [--to N] [--np P]

<case> is a case in the cases folder that Mesh Doctor made (python3 -m meshdoctor new, or a copy made here).  A case
you made is never changed, so it is solved through a copy: with <srcCase> and a new <name>, its mesh and settings,
not its results, are copied into the cases folder as <name>, with the marker of a case made here, and the copy is
solved.  With --template, the new case <name> is first made from that template (at --size, else the template's own),
as `new` makes one, then solved: Verify install solves the Ahmed body's coarse mesh this way to iteration 2000, and
GET /api/v1/runs/{name}/validation compares its drag with the wind tunnel's (validate.py).  While no iteration is
written, a solve splits the case onto P processes (4 by default; 1 solves it whole), starts the flow with
potentialFoam and runs foamRun to iteration N (2000 by default).  Once one is written, a solve continues from the
latest to N, on the same processes.  The run's state is in the case's .meshdoctor-solve.json, which GET
/api/v1/runs lists.  The app starts the same thing as a `solve` job (POST /api/v1/jobs, with a `source` to solve a
copy, or a `template` to make the case first), which runs `solve.py run`; Stop (POST /api/v1/runs/{name}/stop) ends
it at a written time.
"""
import json, os, re, shlex, shutil, signal, subprocess, sys, time

import config
import jobs
import md_api
import prog
import ramguard
import templates

PKG = os.path.dirname(os.path.abspath(__file__))
STATUS = jobs.SOLVE_STATUS
LOGS = ".runs"                        # the solve jobs' logs, in the workspace
POLL_S = 2.0
MAX_ITERS = 100_000
TIME = re.compile(rb"^Time = ([0-9.eE+-]+)s?[ \t]*$", re.M)
NAME_RULE = "a case name is letters, digits and _ . - (not . or - first), at most 80 characters"


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


def latest(case):
    """The run's latest written iteration: the processors' when it is split, else the case's own; 0 if none."""
    best = 0.0
    try:
        for n in os.listdir(os.path.join(case, "processor0") if split(case) else case):
            try:
                best = max(best, float(n))
            except ValueError:
                pass
    except OSError:
        pass
    return int(best)


def own_size(template):
    """The mesh size a template makes a case at when none is asked for ("" for no such template)."""
    return templates.TEMPLATES.get(template, {}).get("size", "")


def refusal(name, to, nproc=None, source=None, template=None, size=None):
    """Why case `name` can't be solved to iteration `to` now, as (code, message) with no paths, or None.  With a
    `source`, `name` is the new case a copy of it goes in; with a `template`, the new case made from it."""
    if not md_api.SAFE.match(name):
        return "bad-request", NAME_RULE
    if source is not None and template is not None:
        return "bad-request", "a solve makes its new case from a source case or from a template, not both"
    if size is not None and template is None:
        return "bad-request", "a mesh size goes with a template"
    if template is not None:
        return templates.problem(template, size or own_size(template)) or templates.refusal(name) or _procs(nproc)
    if source is not None:
        return copy_refusal(source) or templates.refusal(name) or _procs(nproc)
    case = case_dir(name)
    if os.path.islink(case) or not os.path.isfile(os.path.join(case, "system", "controlDict")):
        return "not-found", f"no case {name} in the cases folder"
    made = md_api._read_json(os.path.join(case, jobs.CASE_MARKER))
    if not isinstance(made, dict):
        return "unsupported", (f"{name} is a case you made, which Mesh Doctor never changes: solve a copy of it, "
                               "under a new name")
    if made.get("state") != "done":
        return "not-ready", f"{name} has no mesh yet: make it again first"
    at = latest(case)
    if at == 0:                                 # a fresh start: its processes
        return _procs(nproc)
    if to <= at:                                # a continuation: past what is written
        return "bad-request", f"{name} is solved to iteration {at} already; continue it to a later one"
    return None


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


def _plain(path):
    """An OpenFOAM dictionary's text without its comments ('' when it can't be read)."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read(1_000_000)
    except OSError:
        return ""
    return re.sub(r"/\*.*?\*/|//[^\n]*", "", text, flags=re.S)


def start(name, to, nproc, source=None, template=None, size=None):
    """Start a solve job (POST /jobs, kind "solve"): the job, or a refusal, as md_api's other starts answer.  With a
    `source`, the job first copies that case into the new case `name`, then solves the copy; with a `template`, it
    first makes `name` from the template (at `size`, else the template's own), then solves it."""
    why = refusal(name, to, nproc, source, template, size)
    if why:
        return md_api._refuse(*why)
    ws = config.settings()["workspace"]
    config.ensure_workspace(ws)
    os.makedirs(os.path.join(ws, LOGS), mode=0o700, exist_ok=True)
    made = {} if template is None else {"template": template, "size": size or own_size(template)}
    cmd = [sys.executable, os.path.join(PKG, "solve.py"), "run", *([] if source is None else [source]), name,
           *(["--template", made["template"], "--size", made["size"]] if made else []), "--to", str(to),
           "--np", str(nproc)]
    params = {"name": name, "to": to, "np": nproc, **({} if source is None else {"source": source}), **made}
    # a case made first needs its mesh's memory, more than its solve's; else the solve's own
    ram = ((templates.TEMPLATES[template]["sizes"][made["size"]]["cells"], "mesh") if made
           else (case_dir(name if source is None else source), "solve"))
    return md_api._submit("solve", params, name, cmd, log=f"{LOGS}/{name}_to_{to}.log", ram=ram)   # a log per stretch


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
    if st.get("step") == "copying":
        return None, ("not-ready", f"{name} is being copied: Stop works once it solves (cancel its job to end it now)")
    if str(st.get("step") or "").startswith("meshing"):
        return None, ("not-ready", f"{name} is being meshed: Stop works once it solves (cancel its job to end it now)")
    _stop_at(case, "writeNow")
    return describe(name), None


# --------------------------------------------------------------------------
# what GET /runs and /runs/{name} answer

def solving(name):
    """Is a solve job of case `name` queued or running?"""
    return any(j["kind"] == "solve" and j["name"] == name and j["state"] in jobs.ACTIVE
               for j in jobs.list_jobs(limit=1000))


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
    """A run as the API shows it: its status file, with its state checked against the jobs (a run whose job is gone
    says interrupted), the iteration written last, and its split."""
    case = case_dir(name)
    st = status_of(case)
    if st is None:
        return None
    state = st.get("state")
    if state == "running" and not solving(name):
        state = "interrupted"
    return {"name": name, "state": state, "step": st.get("step") or "", "iteration": st.get("iteration"),
            "start": st.get("start", 0), "end": st.get("end"), "written": latest(case), "nProcs": st.get("nProcs"),
            "stretches": st.get("stretches", []), "started": st.get("started"), "updated": st.get("time"),
            "finished": st.get("finished"), "error": st.get("error")}


# --------------------------------------------------------------------------
# solving (the job's command, and the CLI's)

class Status:
    """The run's status file: what the job is doing, the iteration it is at, and the stretches solved so far."""

    def __init__(self, case, start_at, end, nproc, keep=True):
        self.case, self.path = case, os.path.join(case, STATUS)
        old = (status_of(case) or {}) if keep else {}
        self.doc = {"madeBy": "Mesh Doctor", "state": "running", "step": "", "iteration": start_at,
                    "start": start_at, "end": end, "nProcs": nproc, "started": now(), "time": now(),
                    "finished": None, "error": None, "fraction": 0.0, "stretches": old.get("stretches", [])}
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


def run(name, to, nproc, source=None, template=None, size=None):
    """Solve case `name` to iteration `to`: from iteration 0 on `nproc` processes, else from the latest written one on
    the run's own split.  With a `source`, `name` is made first, as a copy of it (_copy); with a `template`, it is made
    first from the template, as a case job makes one (templates.build).  0 when it ran to `to` or was stopped at a
    written time."""
    why = refusal(name, to, source=source, template=template, size=size)
    if why:
        _say(why[1])
        return 1
    case = case_dir(name)
    made = None
    if source is not None or template is not None:
        try:
            os.mkdir(case)
        except FileExistsError:
            _say(f"a case named {name} exists already; pick another name")
            return 1
        if source is not None:
            made = templates.Status(case, copyOf=source)      # its marker: a case made here, being copied
            made.step("copying")
        else:
            size = size or own_size(template)
            made = templates.Status(case, template=template, size=size)     # its marker: a case made here, being made
    start_at = latest(case)
    first = start_at == 0                       # nothing written yet (as the template's Allrun): split, then start
    nproc = (nproc if first else split(case)) or 1
    status = Status(case, start_at, to, nproc, keep=not first)
    if made is not None:
        status.step("copying" if source is not None else "meshing", 0.0)

    def ended():                                # cancelled
        if source is not None and made.doc["state"] != "done":
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
        if template is not None:
            t = templates.TEMPLATES[template]
            why = templates.build(case, name, t, t["sizes"][size], _Meshing(made, status))
            if why:
                status.end("failed", why)
                _say(why)
                return 1
        return _solve(case, name, first, start_at, to, nproc, status)
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


def _solve(case, name, first, start_at, to, nproc, status):
    parallel = nproc > 1
    _say(f"{name}: {'solving' if first else 'continuing'} from iteration {start_at} to {to}"
         f"{f' on {nproc} processes' if parallel else ''}")
    for entry, value in (("startFrom", "latestTime"), ("stopAt", "endTime"), ("endTime", to),
                         ("writeInterval", write_interval(start_at, to))):
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
        status.step("potentialFoam", 0.03)
        rc = _foam(case, f"{mpi}potentialFoam -initialiseUBCs{par}", "log.potentialFoam").wait()
        if rc:
            return _fail(status, "potentialFoam", rc)
    log = "log.foamRun" if first else f"log.foamRun_to_{to}"
    status.step("solving", 0.05)
    p = _foam(case, f"nice -n 5 {mpi}foamRun{par}", log)
    seen, it = 0, start_at
    while True:
        try:
            rc = p.wait(timeout=POLL_S)
            break
        except subprocess.TimeoutExpired:
            seen, it = _iteration(os.path.join(case, log), seen, it)
            status.step("solving", round(0.05 + 0.92 * (it - start_at) / max(1, to - start_at), 3), iteration=it)
    seen, it = _iteration(os.path.join(case, log), seen, it)
    status.doc["iteration"] = it
    _stop_at(case, "endTime")                   # a Stop's writeNow ends this run only
    if rc:
        return _fail(status, "foamRun", rc)
    if parallel:
        status.step("reconstructing", 0.97)
        rc = _foam(case, "reconstructPar -latestTime", "log.reconstructPar").wait()
        if rc:
            return _fail(status, "reconstructPar", rc)
    state = "done" if it >= to else "stopped"
    status.end(state)
    _say(f"{name}: solved to iteration {it}" + ("" if state == "done" else f", stopped before {to}"))
    return 0


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
            it = int(float(times[-1]))
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

    def word(flag):
        if flag not in rest:
            return None
        i = rest.index(flag) + 1
        if i >= len(rest) or rest[i].startswith("-"):
            sys.exit(f"{flag} takes a name")
        return rest[i]
    to, nproc = opt("--to", 2000), opt("--np", 4)
    if not 1 <= to <= MAX_ITERS or not 1 <= nproc <= 64:
        sys.exit(f"--to is 1 to {MAX_ITERS:,} and --np 1 to 64")
    template, size = word("--template"), word("--size")
    why = refusal(name, to, nproc, source, template, size)
    if why:
        sys.exit(why[1])
    if not job:                                 # a job's memory was checked when it was admitted (jobs.submit)
        if template is not None:                # its mesh's, more than its solve's
            cells = templates.TEMPLATES[template]["sizes"][size or own_size(template)]["cells"]
            ok, msg = ramguard.check_cells(cells, "mesh")
        else:
            ok, msg = ramguard.check(case_dir(name if source is None else source), "solve")
        if not ok:
            sys.exit(msg)
    return run(name, to, nproc, source, template, size)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
