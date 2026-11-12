# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""End-to-end check of jobs through /api/v1 (run by tests/integration_motorbike.sh).

    python3 tests/api_jobs_check.py <source case name>

Uses the MESHDOCTOR_CASES and MESHDOCTOR_WORKSPACE of the calling script and
starts its own server.  Through the API it: repairs the case as run "api_mb"
and follows the job to "done"; checks that a second job is refused while one
runs; starts a short A/B test, cancels it while OpenFOAM solves, and checks
that nothing it started is left running.
"""
import http.client, json, os, re, socket, subprocess, sys, time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "meshdoctor"))
import schema  # noqa: E402

SRC = sys.argv[1]
WS = os.environ["MESHDOCTOR_WORKSPACE"]
s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
server = subprocess.Popen([sys.executable, "-m", "meshdoctor", "serve", "--port", str(PORT)], cwd=REPO,
                          stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def req(method, path, doc=None, token=None):
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=60)
    h = {"Host": f"localhost:{PORT}"}
    body = None
    if doc is not None:
        body = json.dumps(doc).encode()
        h["Content-Type"] = "application/json"
    if token:
        h["X-MD-Token"] = token
    c.request(method, path, body=body, headers=h)
    r = c.getresponse()
    data = r.read().decode()
    c.close()
    return r.status, (json.loads(data) if data.startswith(("{", "[")) else data)


def check(cond, what):
    print(("ok    " if cond else "FAIL  ") + what, flush=True)
    if not cond:
        raise SystemExit(1)


def follow(job_id, until, timeout):
    """Poll a job until until(job) or timeout; print each new step."""
    t0, seen = time.time(), None
    while time.time() - t0 < timeout:
        st, j = req("GET", f"/api/v1/jobs/{job_id}")
        step = (j.get("progress") or {}).get("step")
        if step != seen:
            print(f"      {time.time() - t0:5.0f} s  {j['state']:<9} {step}", flush=True)
            seen = step
        if until(j):
            return j
        time.sleep(1)
    raise SystemExit(f"FAIL  job {job_id} timed out in state {j['state']}")


def left_running(folder):
    """Processes whose working folder is inside folder."""
    out = []
    for pid in filter(str.isdigit, os.listdir("/proc")):
        try:
            if os.readlink(f"/proc/{pid}/cwd").startswith(folder):
                out.append(pid)
        except OSError:
            pass
    return out


try:
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", PORT), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.1)
    page = req("GET", "/meshdoctor")[1]
    token = re.search(r'<meta name="md-token" content="([^"]+)">', page).group(1)

    st, j = req("POST", "/api/v1/jobs", {"kind": "repair", "params": {"source": SRC, "name": "api_mb"}}, token)
    check(st == 202 and j["state"] == "queued", f"repair job accepted: {st} {j.get('id')}")
    rid = j["id"]
    st, e = req("POST", "/api/v1/jobs", {"kind": "repair", "params": {"source": SRC, "name": "api_mb2"}}, token)
    check(st == 409 and e["error"]["code"] == "busy" and rid in e["error"]["message"],
          "a second job is refused while the first runs (409 busy, names the job)")
    j = follow(rid, lambda j: j["state"] not in ("queued", "running"), 900)
    check(j["state"] == "done" and j["exitCode"] == 0, f"repair job done (exit {j['exitCode']})")
    check(schema.validate(j, "job") == [], "job document matches the job schema")
    st, r = req("GET", j["links"]["repair"])
    check(st == 200 and schema.validate(r, "repair") == [] and not r["verdict"]["regressions"],
          "its result is served, valid, and no checkMesh count got worse")

    st, j = req("POST", "/api/v1/jobs", {"kind": "abtest", "params": {"name": "api_mb", "iters": 30, "init": "0"}},
                token)
    check(st == 202, f"A/B job accepted: {st} {j.get('id')}")
    aid = j["id"]
    follow(aid, lambda j: j["state"] == "running" and (j.get("progress") or {}).get("step", "").startswith("solving"),
           600)
    time.sleep(3)                                  # let the solver get going
    check(left_running(os.path.join(WS, "api_mb_ab")) != [], "OpenFOAM is running in the A/B folder")
    st, j = req("POST", f"/api/v1/jobs/{aid}/cancel", token=token)
    if j.get("state") in ("queued", "running"):
        j = follow(aid, lambda j: j["state"] not in ("queued", "running"), 60)
    check(j["state"] == "cancelled", f"A/B job cancelled: {j['state']}")
    time.sleep(1)
    check(left_running(os.path.join(WS, "api_mb_ab")) == [], "nothing it started is left running")
    st, e = req("POST", f"/api/v1/jobs/{aid}/cancel", token=token)
    check(st == 409 and e["error"]["code"] == "finished", "cancelling it again: 409 finished")
    st, js = req("GET", "/api/v1/jobs")
    check([x["state"] for x in js["items"][:2]] == ["cancelled", "done"], "job list: newest first")
    out = subprocess.run([sys.executable, "-m", "meshdoctor", "jobs", "list"], cwd=REPO, capture_output=True,
                         text=True).stdout
    check(rid in out and aid in out, "meshdoctor jobs list shows both")
    print("API jobs: PASS")
finally:
    server.terminate()
    err = server.communicate()[1].decode()
    if "Traceback" in err:
        print(err[-3000:])
        sys.exit(1)
