# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Security checks for the dashboard server (Phase 0 of docs/mesh-doctor-package/PLAN.md).

    python3 tests/security_check.py [port]      against a running server
    python3 tests/security_check.py --start     starts its own server (Linux; used by CI)

It never starts a job: the only accepted job request it sends uses the copy
name "..", which the API must refuse.  With --start the server gets empty
temporary cases and workspace folders and no config file.
"""
import atexit, http.client, os, re, socket, subprocess, sys, tempfile, time


def _start_server():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    tmp = tempfile.mkdtemp(prefix="md_sec_")
    env = dict(os.environ, MESHDOCTOR_CONFIG=os.devnull, MESHDOCTOR_CASES=os.path.join(tmp, "cases"),
               MESHDOCTOR_WORKSPACE=os.path.join(tmp, "work"))
    os.makedirs(env["MESHDOCTOR_CASES"])
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    p = subprocess.Popen([sys.executable, "-m", "meshdoctor", "serve", "--port", str(port)], cwd=repo, env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    atexit.register(p.terminate)
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            return port
        except OSError:
            time.sleep(0.1)
    sys.exit("server did not start")


PORT = _start_server() if "--start" in sys.argv else int(sys.argv[1]) if len(sys.argv) > 1 else 8765
HOST = f"localhost:{PORT}"


def req(method, path, headers=None):
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=30)
    h = {"Host": HOST}
    h.update(headers or {})
    c.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
    for k, v in h.items():
        if v is not None:
            c.putheader(k, v)
    c.endheaders()
    r = c.getresponse()
    body = r.read().decode("utf-8", "replace")
    c.close()
    return r.status, body


page_status, page = req("GET", "/meshdoctor")
m = re.search(r'<meta name="md-token" content="([^"]+)">', page)
TOKEN = m.group(1) if m else ""
JOB = "/api/md/start?src=example_case&name=..&profile=openfoam"

CHECKS = [
    # (description, method, path, headers, expected status, text that must be in the body)
    ("page loads and carries a launch token", "GET", "/meshdoctor", {}, 200, "md-token"),
    ("other dashboard pages load", "GET", "/meshmap", {}, 200, "<canvas"),
    ("run page loads", "GET", "/run", {}, 200, "<html"),
    ("status API works", "GET", "/api/status", {}, 200, ""),
    ("map list API works", "GET", "/api/md/maplist", {}, 200, "["),
    ("server source is not served", "GET", "/server.py", {}, 404, ""),
    ("backup files are not served", "GET", "/server.py.bak_phase0", {}, 404, ""),
    ("path traversal is not served", "GET", "/../mesh_doctor/md_api.py", {}, 404, ""),
    ("encoded traversal is not served", "GET", "/%2e%2e/mesh_doctor/md_api.py", {}, 404, ""),
    ("unknown host refused (DNS rebinding)", "GET", "/api/md/maplist", {"Host": f"evil.example:{PORT}"}, 403, "unknown host"),
    ("missing host refused", "GET", "/api/md/maplist", {"Host": None}, 403, "unknown host"),
    ("cross-site read refused", "GET", "/api/md/maplist", {"Origin": "http://evil.example"}, 403, "cross-site"),
    ("job start without token refused", "POST", JOB, {}, 403, "token"),
    ("job start with wrong token refused", "POST", JOB, {"X-MD-Token": "wrong"}, 403, "token"),
    ("job start from another site refused, even with token", "POST", JOB,
     {"X-MD-Token": TOKEN, "Origin": "http://evil.example"}, 403, "cross-site"),
    ("job start with token reaches the API, which refuses '..'", "POST", JOB,
     {"X-MD-Token": TOKEN, "Origin": f"http://{HOST}"}, 200, "bad arguments"),
    ("A/B extend without token refused", "POST", "/api/md/abextend?label=x&to=10", {}, 403, "token"),
    ("HEAD does not fall back to file serving", "HEAD", "/server.py", {}, 501, ""),
]

failed = 0
print(f"token found in page: {'yes' if TOKEN else 'NO'} (page status {page_status})")
for desc, method, path, headers, want, text in CHECKS:
    got, body = req(method, path, headers)
    ok = got == want and (text in body)
    failed += not ok
    print(f"{'PASS' if ok else 'FAIL'}  {desc}: {got}" + ("" if ok else f" (wanted {want}, body {body[:120]!r})"))
print(f"\n{len(CHECKS) - failed}/{len(CHECKS)} passed")
sys.exit(1 if failed or not TOKEN else 0)
