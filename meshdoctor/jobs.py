# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Jobs: the only place that starts long-running work (docs/architecture.md, "Jobs").

A job is a file <workspace>/.jobs/<id>.json (schemas/job.schema.json):

    {"schemaVersion": "1.0", "id": "20261111-213000-repair-mb-3fa2", "kind": "repair",
     "params": {...}, "name": "mb", "state": "running", "runner": "local",
     "created": "...", "started": "...", "finished": null, "pid": 4242, "exitCode": null,
     "log": "mb.log", "result": "mb/meshDoctor/result.json", "error": null}

States: queued -> running -> done | failed | cancelled.  Paths in a job file are
relative to the workspace, so a job means the same thing on another worker.

The LocalRunner starts `jobrun.py`, a small wrapper that runs the command in its
own process group, writes the log, and records the end state and exit code.
Admission rules live here so every client gets them: one big job at a time
(running jobs, plus OpenFOAM processes started outside Mesh Doctor), and the
RAM guard.  Progress is read from each tool's own status file when a job is read.

    python3 -m meshdoctor jobs [list | show <id> | cancel <id>]
"""
import calendar, json, os, re, secrets, signal, subprocess, sys, time

import config
import prog
import ramguard
import schema

PKG = os.path.dirname(os.path.abspath(__file__))
WRAPPER = os.path.join(PKG, "jobrun.py")
SOLVERS = ("foamRun", "snappyHexMesh", "foamMeshDoctor")
ACTIVE = ("queued", "running")
ID = re.compile(r"^[0-9]{8}-[0-9]{6}-[a-z]+-[A-Za-z0-9_.-]{1,80}-[0-9a-f]{4}$")
START_GRACE = 60          # seconds a queued job may wait for its wrapper before it counts as lost
SPAWN_TIMEOUT = 30        # seconds the wrapper has to say its pid (jobrun.detach)


class Refused(Exception):
    """A job that may not start now.  code is one of api_v1.STATUS."""
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def workspace():
    return config.settings()["workspace"]


def jobs_dir(ws=None):
    return os.path.join(ws or workspace(), ".jobs")


def path_of(job_id, ws=None):
    if not ID.match(job_id):
        raise ValueError("bad job id")
    return os.path.join(jobs_dir(ws), job_id + ".json")


def save(path, job):
    """Write a job file atomically (readers never see half a file)."""
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(schema.stamp(job, "job"), f, indent=1)
    os.replace(tmp, path)


def load(path):
    return schema.read(path, "job")


def update(path, **fields):
    job = load(path)
    job.update(fields)
    save(path, job)
    return job


# --------------------------------------------------------------------------
# processes on this machine

def procs():
    """[(pid, command name, full command line)] of this machine's processes, from /proc."""
    out = []
    try:
        pids = [d for d in os.listdir("/proc") if d.isdigit()]
    except OSError:
        return out
    for pid in pids:
        try:
            with open(f"/proc/{pid}/comm", encoding="utf-8", errors="replace") as f:
                comm = f.read().strip()
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                cmd = f.read().replace(b"\0", b" ").decode("utf-8", "replace").strip()
        except OSError:
            continue           # the process ended while we looked
        out.append((int(pid), comm, cmd))
    return out


def solver_running():
    """True while an OpenFOAM solver, mesher or repair runs on this machine."""
    if not os.path.isdir("/proc"):
        return True            # can't tell: refuse rather than overload the machine
    return any(comm in SOLVERS or any(x in cmd.split()[:3] for x in SOLVERS) for _, comm, cmd in procs())


def _wrapper_alive(pid, job_id):
    """Is pid still this job's wrapper (and not a reused pid)?"""
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            cmd = f.read().decode("utf-8", "replace")
    except (OSError, TypeError):
        return False
    return "jobrun.py" in cmd and job_id in cmd


# --------------------------------------------------------------------------
# reading jobs

# kind -> (status file relative to the workspace, [(step prefix, fraction)])
PROGRESS = {
    "repair": ("{name}/meshDoctor/status.json", [
        ("fingerprinting", 0.03), ("checkMesh (before)", 0.08), ("inspect", 0.15),
        ("correcting", 0.25), ("checkMesh (after)", 0.75), ("collapsing", 0.8),
        ("grouping", 0.9), ("done", 1.0)]),
    "abtest": ("{name}_ab/ab_status.json", [
        ("copying base", 0.02), ("solving base", 0.05), ("copying fixed", 0.45), ("solving fixed", 0.5),
        ("hotspots", 0.92), ("done", 1.0)]),
    "abextend": ("{name}_ab/ab_status.json", [("extending", 0.1), ("hotspots", 0.92), ("done", 1.0)]),
}


def progress(job, ws):
    """{"step", "fraction", "updated"} from the tool's own status file, or None."""
    rel, steps = PROGRESS.get(job.get("kind"), (None, []))
    if not rel:
        return None
    try:
        with open(os.path.join(ws, rel.format(name=job["name"])), encoding="utf-8") as f:
            st = json.load(f)
        if os.path.getmtime(f.name) < _epoch(job.get("created")) - 1:
            return None        # an older run's status file
    except (OSError, ValueError, KeyError):
        return None
    step = str(st.get("step", ""))
    frac = next((x for p, x in steps if step.startswith(p)), None)
    return {"step": step, "fraction": frac, "updated": st.get("time")}


def _epoch(stamp):
    try:
        return calendar.timegm(time.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ"))
    except (TypeError, ValueError):
        return 0


def refresh(path, ws=None):
    """A job as it stands now: a running job whose wrapper is gone is marked
    failed (machine restarted, or the process was killed), and progress is added."""
    ws = ws or workspace()
    job = load(path)
    lost = None
    if job["state"] == "running" and not _wrapper_alive(job.get("pid"), job["id"]):
        lost = "the job's process ended without reporting (machine restarted, or it was killed)"
    elif job["state"] == "queued" and not _wrapper_alive(job.get("pid"), job["id"]) \
            and time.time() - _epoch(job["created"]) > START_GRACE:
        lost = "the job never started"
    if lost:
        job = update(path, state="failed", finished=now(), error=lost)
    if job["state"] in ACTIVE or job["state"] == "done":
        job["progress"] = progress(job, ws)
    return job


def list_jobs(ws=None, state=None, limit=50):
    ws = ws or workspace()
    try:
        names = sorted((f for f in os.listdir(jobs_dir(ws)) if f.endswith(".json")), reverse=True)
    except OSError:
        return []
    out = []
    for f in names:
        try:
            job = refresh(os.path.join(jobs_dir(ws), f), ws)
        except (OSError, ValueError):
            continue           # unreadable, or from a newer Mesh Doctor
        if state is None or job["state"] == state:
            out.append(job)
            if len(out) >= limit:
                break
    return out


def get(job_id, ws=None):
    """The job, or None."""
    try:
        return refresh(path_of(job_id, ws), ws)
    except (OSError, ValueError):
        return None


def busy(ws=None):
    """Why a big job may not start now, or None."""
    for job in list_jobs(ws, limit=1000):
        if job["state"] in ACTIVE:
            return f"job {job['id']} ({job['kind']} {job['name']}) is {job['state']}; one big job at a time (RAM)"
    if solver_running():
        return "another OpenFOAM job is running; one big job at a time (RAM)"
    return None


# --------------------------------------------------------------------------
# starting and cancelling

def _spawn(argv):
    """Start the wrapper detached from the server (its own session, adopted by
    init; see jobrun.detach) and return its pid.  Tests replace this."""
    p = subprocess.Popen(argv[:2] + ["--detach"] + argv[2:], start_new_session=True, stdin=subprocess.DEVNULL,
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        out, _ = p.communicate(timeout=SPAWN_TIMEOUT)
    except subprocess.TimeoutExpired:
        p.kill()                       # and wait for it, which also closes its pipe
        p.communicate()
        raise Refused("internal", "the job runner did not start") from None
    if p.returncode != 0 or not out.strip().isdigit():
        raise Refused("internal", "the job runner did not start")
    return int(out.strip())


def submit(kind, params, name, cmd, log, result=None, ram=None, ws=None):
    """Admit and start a job; the job dict, or Refused.

    cmd: the argument list to run (no shell).  log and result: paths relative
    to the workspace.  ram: (case folder, "repair" | "solve") for the RAM guard."""
    ws = ws or workspace()
    why = busy(ws)
    if why:
        raise Refused("busy", why)
    if ram:
        ok, msg = ramguard.check(*ram)
        if not ok:
            raise Refused("not-enough-memory", msg)
    config.ensure_workspace(ws)
    os.makedirs(jobs_dir(ws), mode=0o700, exist_ok=True)
    job_id = f"{time.strftime('%Y%m%d-%H%M%S')}-{kind}-{name}-{secrets.token_hex(2)}"
    path = path_of(job_id, ws)
    job = {"id": job_id, "kind": kind, "params": params, "name": name, "state": "queued", "runner": "local",
           "created": now(), "started": None, "finished": None, "pid": None, "exitCode": None,
           "log": log, "result": result, "error": None}
    save(path, job)
    job["pid"] = _spawn([sys.executable, WRAPPER, path, os.path.join(ws, log), "--"] + list(cmd))
    return schema.stamp(job, "job")


def cancel(job_id, ws=None, wait=3.0):
    """Ask a running job to stop (SIGTERM to its wrapper, which stops the whole
    process group and records "cancelled").  The job, or None if unknown."""
    # Only the wrapper writes a live job's file (no lost updates); this just signals it.
    job, t0 = get(job_id, ws), time.time()
    while job is not None and job["state"] == "queued" and time.time() - t0 < wait:
        time.sleep(0.2)                       # the wrapper records its pid when it starts
        job = get(job_id, ws)
    if job is None or job["state"] not in ACTIVE:
        return job
    if _wrapper_alive(job.get("pid"), job_id):
        try:
            os.kill(job["pid"], signal.SIGTERM)
        except OSError:
            pass
    t0 = time.time()
    while time.time() - t0 < wait:
        job = get(job_id, ws)
        if job["state"] not in ACTIVE:
            break
        time.sleep(0.2)
    return job


def main(argv):
    if not argv or argv[0] == "list":
        for j in list_jobs(limit=int(argv[1]) if len(argv) > 1 else 20):
            p = j.get("progress") or {}
            print(f"{j['id']:<60} {j['state']:<10} {p.get('step', '') if j['state'] in ACTIVE else j.get('error') or ''}")
        return 0
    if argv[0] in ("show", "cancel") and len(argv) == 2 and ID.match(argv[1]):
        j = get(argv[1]) if argv[0] == "show" else cancel(argv[1])
        if j is None:
            sys.exit("no job " + argv[1])
        print(json.dumps(j, indent=1))
        return 0
    print(prog.text(__doc__))
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
