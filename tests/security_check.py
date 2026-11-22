# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Security checks for the dashboard server (Phase 0 of docs/mesh-doctor-package/PLAN.md).

    python3 tests/security_check.py [port]      against a running server
    python3 tests/security_check.py --start     starts its own server (Linux; used by CI)

It never starts a job: the only accepted job request it sends uses the copy
name "..", which the API must refuse.  With --start the server gets empty
temporary cases and workspace folders and no config file.
"""
import atexit, http.client, os, re, shutil, socket, subprocess, sys, tempfile, time

APP = "https://app.example.test"      # the web app's address the --start server allows (app_origins)
START = "--start" in sys.argv


def _start_server():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    tmp = tempfile.mkdtemp(prefix="md_sec_")
    env = dict(os.environ, MESHDOCTOR_CONFIG=os.devnull, MESHDOCTOR_CASES=os.path.join(tmp, "cases"),
               MESHDOCTOR_WORKSPACE=os.path.join(tmp, "work"), MESHDOCTOR_APP_ORIGINS=APP,
               MESHDOCTOR_KEY_FILE=os.path.join(tmp, "app.key"))
    _start_server.key_file = env["MESHDOCTOR_KEY_FILE"]
    os.makedirs(env["MESHDOCTOR_CASES"])
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    p = subprocess.Popen([sys.executable, "-m", "meshdoctor", "serve", "--port", str(port)], cwd=repo, env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def stop():
        p.terminate()
        try:
            p.wait(10)
        except subprocess.TimeoutExpired:
            p.kill()
        shutil.rmtree(tmp, ignore_errors=True)
    atexit.register(stop)
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            return port
        except OSError:
            time.sleep(0.1)
    sys.exit("server did not start")


PORT = _start_server() if START else int(sys.argv[1]) if len(sys.argv) > 1 else 8765
HOST = f"localhost:{PORT}"


def req(method, path, headers=None, body=None):
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=30)
    h = {"Host": HOST}
    if body is not None:
        h["Content-Length"] = str(len(body))
    h.update(headers or {})
    c.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
    for k, v in h.items():
        if v is not None:
            c.putheader(k, v)
    c.endheaders(body)
    r = c.getresponse()
    body = r.read().decode("utf-8", "replace")
    c.close()
    req.headers = r
    return r.status, body


page_status, page = req("GET", "/meshdoctor")
m = re.search(r'<meta name="md-token" content="([^"]+)">', page)
TOKEN = m.group(1) if m else ""
JOB = "/api/md/start?src=example_case&name=..&profile=openfoam"
V1JOB = b'{"kind": "repair", "params": {"source": "example_case", "name": ".."}}'
JSON = "application/json"
PAGES = ("/", "/run", "/meshdoctor", "/meshmap", "/report")
APP_KEY = ""
if START:                                     # the server made its pairing key before it listened
    with open(_start_server.key_file, encoding="utf-8") as f:
        APP_KEY = f.read().strip()
EVIL = "https://evil.example"

CHECKS = [
    # (description, method, path, headers, expected status, text that must be in the body)
    ("page loads and carries a launch token", "GET", "/meshdoctor", {}, 200, "md-token"),
    ("other dashboard pages load", "GET", "/meshmap", {}, 200, "<canvas"),
    ("run page loads", "GET", "/run", {}, 200, "<html"),
    ("report viewer loads, with its no-upload policy", "GET", "/report", {}, 200, "connect-src"),
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
    # /api/v1: the same rules, and errors always {"error": {"code", "message"}}
    ("v1 index works", "GET", "/api/v1", {}, 200, "apiVersion"),
    ("v1 OpenAPI document is served", "GET", "/api/v1/openapi.json", {}, 200, '"openapi": "3.1.0"'),
    ("v1 list works", "GET", "/api/v1/cases", {}, 200, '"items"'),
    ("v1 machine works", "GET", "/api/v1/machine", {}, 200, '"memoryMb"'),
    ("v1 unknown host refused", "GET", "/api/v1/cases", {"Host": f"evil.example:{PORT}"}, 403, '"code": "forbidden"'),
    ("v1 cross-site read refused", "GET", "/api/v1/cases", {"Origin": "http://evil.example"}, 403, "cross-site"),
    ("v1 unknown route", "GET", "/api/v1/nowhere", {}, 404, '"code": "not-found"'),
    ("v1 A/B judge needs a side", "GET", "/api/v1/abtests/x/judge", {}, 400, "side"),
    ("v1 A/B judge takes no other side", "GET", "/api/v1/abtests/x/judge?side=..", {}, 400, '"code": "bad-request"'),
    ("v1 refuses non-finite numbers", "GET", "/api/v1/abtests/x/judge?side=base&to=nan", {}, 400, "finite"),
    ("v1 A/B judge of a missing test", "GET", "/api/v1/abtests/nope/judge?side=base", {}, 404, '"code": "not-found"'),
    ("v1 live judge window has a floor", "GET", "/api/v1/live/judge?window=5", {}, 400, "window"),
    ("v1 live judge refuses non-finite times", "GET", "/api/v1/live/judge?avgFrom=nan", {}, 400, "finite"),
    ("v1 wrong method", "GET", "/api/v1/jobs/20260101-000000-repair-x-abcd/cancel", {}, 405, '"code": "method-not-allowed"'),
    ("v1 job without token refused", "POST", "/api/v1/jobs", {"Content-Type": JSON}, 403, "token", V1JOB),
    ("v1 cancel without token refused", "POST", "/api/v1/jobs/20260101-000000-repair-x-abcd/cancel", {}, 403,
     "token"),
    ("v1 job with wrong token refused", "POST", "/api/v1/jobs", {"Content-Type": JSON, "X-MD-Token": "wrong"},
     403, "token", V1JOB),
    ("v1 job from another site refused, even with token", "POST", "/api/v1/jobs",
     {"Content-Type": JSON, "X-MD-Token": TOKEN, "Origin": "http://evil.example"}, 403, "cross-site", V1JOB),
    ("v1 job as a form post refused, even with token", "POST", "/api/v1/jobs",
     {"Content-Type": "application/x-www-form-urlencoded", "X-MD-Token": TOKEN}, 415, "application/json", V1JOB),
    ("v1 oversized body refused unread", "POST", "/api/v1/jobs",
     {"Content-Type": JSON, "X-MD-Token": TOKEN, "Content-Length": "10000000"}, 413, "too-large", b""),
    ("v1 job with token reaches the API, which refuses '..'", "POST", "/api/v1/jobs",
     {"Content-Type": JSON, "X-MD-Token": TOKEN, "Origin": f"http://{HOST}"}, 400, '"code": "bad-request"', V1JOB),
    # page scripts: only plain names from web/js/
    ("shared page script is served", "GET", "/js/md.js", {}, 200, "MD.render"),
    ("unknown script is not served", "GET", "/js/nope.js", {}, 404, ""),
    ("script route does not reach other files", "GET", "/js/../server.py", {}, 404, ""),
    ("encoded traversal in the script route", "GET", "/js/%2e%2e%2fserver.py", {}, 404, ""),
    # CORS preflights: never for another site, a missing Origin or an unknown host
    ("preflight from another site refused", "OPTIONS", "/api/v1/jobs",
     {"Origin": EVIL, "Access-Control-Request-Method": "POST"}, 403, "cross-site"),
    ("preflight without an Origin refused", "OPTIONS", "/api/v1/jobs", {}, 403, "cross-site"),
    ("preflight to an unknown host refused", "OPTIONS", "/api/v1/jobs",
     {"Host": f"evil.example:{PORT}", "Origin": APP, "Access-Control-Request-Method": "GET"}, 403, "unknown host"),
    ("another site's read refused, even with a key header", "GET", "/api/v1/cases",
     {"Origin": EVIL, "X-MD-Key": "anything"}, 403, "cross-site"),
]

# The web app (pairing.py): only with --start, where this script knows the app address and the key
APP_CHECKS = [
    ("app: read without the pairing key refused", "GET", "/api/v1/cases", {"Origin": APP}, 403, "pairing key"),
    ("app: read with a wrong key refused", "GET", "/api/v1/cases", {"Origin": APP, "X-MD-Key": "wrong"}, 403,
     "pairing key"),
    ("app: read with the key works", "GET", "/api/v1/cases", {"Origin": APP, "X-MD-Key": APP_KEY}, 200, '"items"'),
    ("app: no dashboard pages, even with the key", "GET", "/meshdoctor", {"Origin": APP, "X-MD-Key": APP_KEY},
     403, "/api/v1 only"),
    ("app: no old routes, even with the key", "GET", "/api/md/maplist", {"Origin": APP, "X-MD-Key": APP_KEY},
     403, "/api/v1 only"),
    ("app: job start without the key refused, even with the launch token", "POST", "/api/v1/jobs",
     {"Origin": APP, "Content-Type": JSON, "X-MD-Token": TOKEN}, 403, "pairing key", V1JOB),
    ("app: job start with the key reaches the API, which refuses '..'", "POST", "/api/v1/jobs",
     {"Origin": APP, "Content-Type": JSON, "X-MD-Key": APP_KEY}, 400, '"code": "bad-request"', V1JOB),
    ("app: job as a form post refused, even with the key", "POST", "/api/v1/jobs",
     {"Origin": APP, "Content-Type": "application/x-www-form-urlencoded", "X-MD-Key": APP_KEY}, 415,
     "application/json", V1JOB),
    ("app: preflight answered", "OPTIONS", "/api/v1/jobs",
     {"Origin": APP, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-md-key"},
     204, ""),
    ("app: preflight for another method refused", "OPTIONS", "/api/v1/jobs",
     {"Origin": APP, "Access-Control-Request-Method": "DELETE"}, 405, "method-not-allowed"),
    ("app: preflight outside /api/v1 refused", "OPTIONS", "/meshdoctor",
     {"Origin": APP, "Access-Control-Request-Method": "GET"}, 403, "cross-site"),
    ("app: a look-alike address is another site", "GET", "/api/v1/cases",
     {"Origin": APP + ".evil.example", "X-MD-Key": APP_KEY}, 403, "cross-site"),
    ("app: the plain-http twin is another site", "GET", "/api/v1/cases",
     {"Origin": APP.replace("https:", "http:"), "X-MD-Key": APP_KEY}, 403, "cross-site"),
] if START else []


def header(path, name, method="GET", headers=None):
    req(method, path, headers)
    return req.headers.getheader(name) or ""


def _key_file_private():
    return os.name != "posix" or (os.stat(_start_server.key_file).st_mode & 0o777) == 0o600


def csp(path):
    """The page's Content-Security-Policy as {directive: [sources]}."""
    return {d.split()[0]: d.split()[1:] for d in header(path, "Content-Security-Policy").split(";") if d.strip()}


HEADERS = [
    # (description, check)
    ("page scripts are sent as JavaScript", lambda: header("/js/md.js", "Content-Type").startswith("text/javascript")),
    ("pages load nothing from other sites", lambda: all(csp(p).get("default-src") == ["'none'"] for p in PAGES)),
    ("pages connect only to this server", lambda: all(csp(p).get("connect-src") == ["'self'"] for p in PAGES)),
    ("pages cannot be framed by another site", lambda: all(csp(p).get("frame-ancestors") == ["'none'"] for p in PAGES)),
    ("no page runs inline script, the report viewer included", lambda: all(csp(p).get("script-src") == ["'self'"] for p in PAGES)),
    ("the report viewer's own script is served", lambda: req("GET", "/js/report.js")[0] == 200),
    ("v1 names the A/B test running now", lambda: req("GET", "/api/v1/live/abtest")[0] in (200, 404)),
    ("v1 judges the live run, or says why not", lambda: req("GET", "/api/v1/live/judge")[0] in (200, 404, 503)),
    ("old routes say they are deprecated, and point to v1",
     lambda: all(header(p, "Deprecation").startswith("@") and "/api/v1/openapi.json" in header(p, "Link")
                 for p in ("/api/status", "/api/md/maplist"))),
    ("v1 and the pages are not deprecated", lambda: not any(header(p, "Deprecation") for p in ("/api/v1", "/meshdoctor"))),
    ("another site never gets a CORS answer",
     lambda: header("/api/v1/cases", "Access-Control-Allow-Origin", headers={"Origin": EVIL}) == ""
     and header("/api/v1/jobs", "Access-Control-Allow-Origin", "OPTIONS",
                {"Origin": EVIL, "Access-Control-Request-Method": "POST"}) == ""),
    ("the dashboard's own pages get no CORS answer",
     lambda: header("/api/v1/cases", "Access-Control-Allow-Origin", headers={"Origin": f"http://{HOST}"}) == ""),
]
if START:
    HEADERS += [
        ("app: answers name the app's own address only",
         lambda: header("/api/v1/cases", "Access-Control-Allow-Origin", headers={"Origin": APP, "X-MD-Key": APP_KEY})
         == APP and "Origin" in header("/api/v1/cases", "Vary", headers={"Origin": APP, "X-MD-Key": APP_KEY})),
        ("app: refusals carry CORS too, so the app can show them",
         lambda: header("/api/v1/cases", "Access-Control-Allow-Origin", headers={"Origin": APP}) == APP),
        ("app: the preflight allows the key header and caches briefly",
         lambda: "X-MD-Key" in header("/api/v1/jobs", "Access-Control-Allow-Headers", "OPTIONS",
                                      {"Origin": APP, "Access-Control-Request-Method": "POST"})
         and header("/api/v1/jobs", "Access-Control-Max-Age", "OPTIONS",
                    {"Origin": APP, "Access-Control-Request-Method": "POST"}) == "600"),
        ("app: no cookies or credentials are ever allowed",
         lambda: header("/api/v1/cases", "Access-Control-Allow-Credentials",
                        headers={"Origin": APP, "X-MD-Key": APP_KEY}) == ""),
        ("app: the key file is readable by its owner only", _key_file_private),
    ]

failed = 0
print(f"token found in page: {'yes' if TOKEN else 'NO'} (page status {page_status})")
CHECKS += APP_CHECKS
for desc, method, path, headers, want, text, *send in CHECKS:
    got, body = req(method, path, headers, *send)
    ok = got == want and (text in body)
    failed += not ok
    print(f"{'PASS' if ok else 'FAIL'}  {desc}: {got}" + ("" if ok else f" (wanted {want}, body {body[:120]!r})"))
for desc, check in HEADERS:
    ok = check()
    failed += not ok
    print(f"{'PASS' if ok else 'FAIL'}  {desc}")
total = len(CHECKS) + len(HEADERS)
print(f"\n{total - failed}/{total} passed")
sys.exit(1 if failed or not TOKEN else 0)
