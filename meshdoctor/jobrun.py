# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Runs one Mesh Doctor job and keeps its job file current (started by jobs.submit).

    python3 jobrun.py <job file> <log file> -- <command ...>

The command runs at lower priority (nice 5) in its own process group, so
cancelling stops everything it started (mpirun ranks included).  SIGTERM to
this process cancels the job: the group gets SIGTERM, then SIGKILL after 30 s.
The command comes from this process's arguments, never from the job file.
"""
import os, signal, subprocess, sys, time

import jobs

KILL_AFTER = 30


def _last_line(log, ws):
    """The log's last non-empty line, without workspace paths (it may be shown on a web page)."""
    try:
        with open(log, "rb") as f:
            f.seek(max(0, os.path.getsize(log) - 4096))
            lines = [x.strip() for x in f.read().decode("utf-8", "replace").splitlines() if x.strip()]
    except OSError:
        return ""
    return lines[-1].replace(ws.rstrip("/") + "/", "")[:300] if lines else ""


def detach():
    """Fork once: the parent prints the child's pid and exits at once, so the
    server can wait for it, and the job (the child) is adopted and reaped by
    init.  No zombie processes in a long-running server, and the job outlives it."""
    pid = os.fork()
    if pid:
        print(pid, flush=True)
        os._exit(0)
    null = os.open(os.devnull, os.O_RDWR)
    for fd in (0, 1, 2):
        os.dup2(null, fd)
    if null > 2:                       # 0, 1 and 2 are copies of it now
        os.close(null)


def main(argv):
    if argv[:1] == ["--detach"]:
        argv = argv[1:]
        detach()
    if len(argv) < 4 or argv[2] != "--":
        print(__doc__, file=sys.stderr)
        return 2
    path, log, cmd = argv[0], argv[1], argv[3:]
    ws = os.path.dirname(os.path.dirname(os.path.abspath(path)))
    cancelled = []

    def on_term(sig, frame):
        if not cancelled:
            cancelled.append(time.time())
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except OSError:
                pass

    with open(log, "wb") as out:
        try:
            child = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT,
                                     start_new_session=True, preexec_fn=lambda: os.nice(5))
        except OSError as e:
            jobs.update(path, state="failed", finished=jobs.now(), error=f"could not start: {e.strerror}")
            return 1
        signal.signal(signal.SIGTERM, on_term)
        jobs.update(path, state="running", started=jobs.now(), pid=os.getpid())
        while True:
            try:
                rc = child.wait(timeout=1)
                break
            except subprocess.TimeoutExpired:
                if cancelled and time.time() - cancelled[0] > KILL_AFTER:
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except OSError:
                        pass
    if cancelled:
        state, error = "cancelled", None
    elif rc == 0:
        state, error = "done", None
    else:
        state, error = "failed", f"exit code {rc}: {_last_line(log, ws)}"
    jobs.update(path, state=state, finished=jobs.now(), exitCode=rc, error=error)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
