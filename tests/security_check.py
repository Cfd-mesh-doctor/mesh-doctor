# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Security checks for the dashboard server (Phase 0 of docs/mesh-doctor-package/PLAN.md).

    python3 tests/security_check.py [port]      against a running server
    python3 tests/security_check.py --start     starts its own server (Linux; used by CI)

It never starts a job: the only accepted job request it sends uses the copy
name "..", which the API must refuse.  With --start the server gets empty
temporary cases and workspace folders and no config file, but for two sets of
pictures in the workspace (one of them deleted by the checks).
"""
import atexit, http.client, json, os, re, shutil, socket, subprocess, sys, tempfile, time

APP = "https://app.example.test"      # the web app's address the --start server allows (app_origins)
START = "--start" in sys.argv
PNG = b"\x89PNG\r\n\x1a\n"


def _pictures(work, key_file):
    """Two sets of pictures of ahmed in the workspace, as a picture job leaves them: in each, a picture that is
    served, a file its list doesn't name, and a picture it lists that is a link to the pairing key."""
    for at in ("2000", "1000"):
        folder = os.path.join(work, ".pictures", "ahmed", at)
        os.makedirs(os.path.join(folder, "cuts"), mode=0o700)
        open(os.path.join(folder, ".meshdoctor-pictures"), "w").close()
        with open(os.path.join(folder, "pictures.json"), "w") as f:
            json.dump({"case": "ahmed", "time": at, "mean": False, "kinds": ["cuts"], "made": "2026-11-24T00:00:00Z",
                       "notes": [], "pictures": [{"file": f"cuts/{n}.png", "kind": "cuts", "title": n}
                                                 for n in ("side_U", "key")]}, f)
        for name, text in (("side_U", b"a picture"), ("unlisted", b"not in the list")):
            with open(os.path.join(folder, "cuts", name + ".png"), "wb") as f:
                f.write(PNG + text)
        os.symlink(key_file, os.path.join(folder, "cuts", "key.png"))
    os.chmod(work, 0o700)


def _start_server():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    tmp = tempfile.mkdtemp(prefix="md_sec_")
    env = dict(os.environ, MESHDOCTOR_CONFIG=os.devnull, MESHDOCTOR_CASES=os.path.join(tmp, "cases"),
               MESHDOCTOR_WORKSPACE=os.path.join(tmp, "work"), MESHDOCTOR_APP_ORIGINS=APP,
               MESHDOCTOR_KEY_FILE=os.path.join(tmp, "app.key"))
    _start_server.key_file = env["MESHDOCTOR_KEY_FILE"]
    _start_server.cases = env["MESHDOCTOR_CASES"]
    os.makedirs(os.path.join(env["MESHDOCTOR_CASES"], "mine"))     # a case you made, which a new case never replaces
    _pictures(env["MESHDOCTOR_WORKSPACE"], env["MESHDOCTOR_KEY_FILE"])
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
CASEJOB = b'{"kind": "case", "params": {"template": "ahmed-body", "name": ".."}}'
SOLVEJOB = b'{"kind": "solve", "params": {"name": ".."}}'
COPYJOB = b'{"kind": "solve", "params": {"name": "copy", "source": ".."}}'
TEMPLATEJOB = b'{"kind": "solve", "params": {"name": "verify-install", "template": ".."}}'
TPLANJOB = b'{"kind": "tplan", "params": {"name": ".."}}'
PICTURESJOB = b'{"kind": "pictures", "params": {"name": ".."}}'
PICTURESTIME = b'{"kind": "pictures", "params": {"name": "ahmed", "time": "../0"}}'
PICTURESMEAN = b'{"kind": "pictures", "params": {"name": "ahmed", "mean": "yes"}}'
TRANSIENTJOB = b'{"kind": "solve", "params": {"name": "transient", "steady": ".."}}'
NANJOB = b'{"kind": "solve", "params": {"name": "transient", "steady": "steady", "to": NaN}}'
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
    ("v1 readiness check works", "GET", "/api/v1/check", {}, 200, '"checks"'),
    ("v1 templates list works", "GET", "/api/v1/templates", {}, 200, '"sizes"'),
    ("v1 runs list works", "GET", "/api/v1/runs", {}, 200, '"items"'),
    ("v1 cases list says which ones Mesh Doctor made", "GET", "/api/v1/cases", {}, 200, '"made"'),
    ("v1 a missing run has no live page", "GET", "/api/v1/runs/nope/live", {}, 404, '"code": "not-found"'),
    ("v1 a run's live page takes no bad name", "GET", "/api/v1/runs/.x/live", {}, 400, '"code": "bad-request"'),
    ("v1 a run's live page refused to another site", "GET", "/api/v1/runs/x/live", {"Origin": "http://evil.example"},
     403, "cross-site"),
    ("v1 a missing run has no comparison", "GET", "/api/v1/runs/nope/validation", {}, 404, '"code": "not-found"'),
    ("v1 a run's comparison takes no bad name", "GET", "/api/v1/runs/.x/validation", {}, 400,
     '"code": "bad-request"'),
    ("v1 a run's comparison refused to another site", "GET", "/api/v1/runs/x/validation",
     {"Origin": "http://evil.example"}, 403, "cross-site"),
    ("v1 a case with no transient plan has none", "GET", "/api/v1/tplans/nope", {}, 404, '"code": "not-found"'),
    ("v1 a transient plan takes no bad name", "GET", "/api/v1/tplans/.x", {}, 400, '"code": "bad-request"'),
    ("v1 a transient plan refused to another site", "GET", "/api/v1/tplans/x", {"Origin": "http://evil.example"},
     403, "cross-site"),
    ("v1 picture sets list works", "GET", "/api/v1/pictures", {}, 200, '"items"'),
    ("v1 a picture job's disk check takes no bad case name", "GET", "/api/v1/disk/pictures?name=..", {}, 400,
     '"code": "bad-request"'),
    ("v1 a picture job's disk check takes a mean that is true or false", "GET",
     "/api/v1/disk/pictures?name=ahmed&mean=yes", {}, 400, '"code": "bad-request"'),
    ("v1 a picture job's disk check takes no '..' time", "GET", "/api/v1/disk/pictures?name=ahmed&time=../0", {},
     400, '"code": "bad-request"'),
    ("v1 a picture job's disk check of a missing case", "GET", "/api/v1/disk/pictures?name=nope", {}, 404,
     '"code": "not-found"'),
    ("v1 a set of pictures takes no '..'", "GET", "/api/v1/pictures/../2000", {}, 400, '"code": "bad-request"'),
    ("v1 a set is named by a time only", "GET", "/api/v1/pictures/ahmed/secret", {}, 400, '"code": "bad-request"'),
    ("v1 a picture takes no '..'", "GET", "/api/v1/pictures/ahmed/2000/../pictures.json", {}, 400,
     '"code": "bad-request"'),
    ("v1 a picture takes no encoded path", "GET", "/api/v1/pictures/ahmed/2000/cuts/..%2f..%2fpictures.json", {},
     400, '"code": "bad-request"'),
    ("v1 a picture is a .png file only", "GET", "/api/v1/pictures/ahmed/2000/cuts/pictures.json", {}, 400,
     '"code": "bad-request"'),
    ("v1 a picture refused to another site", "GET", "/api/v1/pictures/ahmed/2000/cuts/side_U.png",
     {"Origin": "http://evil.example"}, 403, "cross-site"),
    ("v1 deleting a set without token refused", "POST", "/api/v1/pictures/ahmed/1000/delete", {}, 403, "token"),
    ("v1 deleting a set from another site refused, even with token", "POST", "/api/v1/pictures/ahmed/1000/delete",
     {"X-MD-Token": TOKEN, "Origin": "http://evil.example"}, 403, "cross-site"),
    ("v1 deleting a set takes no bad name", "POST", "/api/v1/pictures/ahmed/../delete",
     {"X-MD-Token": TOKEN, "Origin": f"http://{HOST}"}, 400, '"code": "bad-request"'),
    ("v1 deleting a set takes POST only", "GET", "/api/v1/pictures/ahmed/1000/delete", {}, 405,
     '"code": "method-not-allowed"'),
    ("v1 readiness check takes no POST", "POST", "/api/v1/check", {"X-MD-Token": TOKEN, "Content-Type": JSON}, 405,
     '"code": "method-not-allowed"', b"{}"),
    ("v1 unknown host refused", "GET", "/api/v1/cases", {"Host": f"evil.example:{PORT}"}, 403, '"code": "forbidden"'),
    ("v1 cross-site read refused", "GET", "/api/v1/cases", {"Origin": "http://evil.example"}, 403, "cross-site"),
    ("v1 unknown route", "GET", "/api/v1/nowhere", {}, 404, '"code": "not-found"'),
    ("v1 A/B judge needs a side", "GET", "/api/v1/abtests/x/judge", {}, 400, "side"),
    ("v1 A/B judge takes no other side", "GET", "/api/v1/abtests/x/judge?side=..", {}, 400, '"code": "bad-request"'),
    ("v1 refuses non-finite numbers", "GET", "/api/v1/abtests/x/judge?side=base&to=nan", {}, 400, "finite"),
    ("v1 A/B judge of a missing test", "GET", "/api/v1/abtests/nope/judge?side=base", {}, 404, '"code": "not-found"'),
    ("v1 live judge window has a floor", "GET", "/api/v1/live/judge?window=5", {}, 400, "window"),
    ("v1 judge window is iterations or auto", "GET", "/api/v1/judge?case=x&window=automatic", {}, 400,
     "window must be a whole number from 10 to 100000 or auto"),
    ("v1 live judge refuses non-finite times", "GET", "/api/v1/live/judge?avgFrom=nan", {}, 400, "finite"),
    ("v1 wrong method", "GET", "/api/v1/jobs/20260101-000000-repair-x-abcd/cancel", {}, 405, '"code": "method-not-allowed"'),
    ("v1 job without token refused", "POST", "/api/v1/jobs", {"Content-Type": JSON}, 403, "token", V1JOB),
    ("v1 cancel without token refused", "POST", "/api/v1/jobs/20260101-000000-repair-x-abcd/cancel", {}, 403,
     "token"),
    ("v1 Stop without token refused", "POST", "/api/v1/runs/x/stop", {}, 403, "token"),
    ("v1 Stop with wrong token refused", "POST", "/api/v1/runs/x/stop", {"X-MD-Token": "wrong"}, 403, "token"),
    ("v1 Stop from another site refused, even with token", "POST", "/api/v1/runs/x/stop",
     {"X-MD-Token": TOKEN, "Origin": "http://evil.example"}, 403, "cross-site"),
    ("v1 Stop with token reaches the API: no such run", "POST", "/api/v1/runs/nope/stop",
     {"X-MD-Token": TOKEN, "Origin": f"http://{HOST}"}, 404, '"code": "not-found"'),
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
    ("v1 new case without token refused", "POST", "/api/v1/jobs", {"Content-Type": JSON}, 403, "token", CASEJOB),
    ("v1 new case with token reaches the API, which refuses '..'", "POST", "/api/v1/jobs",
     {"Content-Type": JSON, "X-MD-Token": TOKEN, "Origin": f"http://{HOST}"}, 400, '"code": "bad-request"', CASEJOB),
    ("v1 solve without token refused", "POST", "/api/v1/jobs", {"Content-Type": JSON}, 403, "token", SOLVEJOB),
    ("v1 solve with token reaches the API, which refuses '..'", "POST", "/api/v1/jobs",
     {"Content-Type": JSON, "X-MD-Token": TOKEN, "Origin": f"http://{HOST}"}, 400, '"code": "bad-request"', SOLVEJOB),
    ("v1 a solve of a copy takes no bad source name", "POST", "/api/v1/jobs",
     {"Content-Type": JSON, "X-MD-Token": TOKEN, "Origin": f"http://{HOST}"}, 400, '"code": "bad-request"', COPYJOB),
    ("v1 a solve with a template takes no bad template name", "POST", "/api/v1/jobs",
     {"Content-Type": JSON, "X-MD-Token": TOKEN, "Origin": f"http://{HOST}"}, 400, '"code": "bad-request"',
     TEMPLATEJOB),
    ("v1 a solve with a template without token refused", "POST", "/api/v1/jobs", {"Content-Type": JSON}, 403, "token",
     TEMPLATEJOB),
    ("v1 a transient plan job takes no bad case name", "POST", "/api/v1/jobs",
     {"Content-Type": JSON, "X-MD-Token": TOKEN, "Origin": f"http://{HOST}"}, 400, '"code": "bad-request"', TPLANJOB),
    ("v1 a transient plan job without token refused", "POST", "/api/v1/jobs", {"Content-Type": JSON}, 403, "token",
     TPLANJOB),
    ("v1 a picture job takes no bad case name", "POST", "/api/v1/jobs",
     {"Content-Type": JSON, "X-MD-Token": TOKEN, "Origin": f"http://{HOST}"}, 400, '"code": "bad-request"',
     PICTURESJOB),
    ("v1 a picture job takes no time that is a path", "POST", "/api/v1/jobs",
     {"Content-Type": JSON, "X-MD-Token": TOKEN, "Origin": f"http://{HOST}"}, 400, '"code": "bad-request"',
     PICTURESTIME),
    ("v1 a picture job's mean flow is true or false", "POST", "/api/v1/jobs",
     {"Content-Type": JSON, "X-MD-Token": TOKEN, "Origin": f"http://{HOST}"}, 400, '"code": "bad-request"',
     PICTURESMEAN),
    ("v1 a picture job without token refused", "POST", "/api/v1/jobs", {"Content-Type": JSON}, 403, "token",
     PICTURESJOB),
    ("v1 a transient solve takes no bad steady run name", "POST", "/api/v1/jobs",
     {"Content-Type": JSON, "X-MD-Token": TOKEN, "Origin": f"http://{HOST}"}, 400, '"code": "bad-request"',
     TRANSIENTJOB),
    ("v1 a transient solve without token refused", "POST", "/api/v1/jobs", {"Content-Type": JSON}, 403, "token",
     TRANSIENTJOB),
    ("v1 a body's NaN is no JSON number", "POST", "/api/v1/jobs",
     {"Content-Type": JSON, "X-MD-Token": TOKEN, "Origin": f"http://{HOST}"}, 400, "not valid JSON", NANJOB),
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

# The sets of pictures the --start server's workspace has (_pictures): served only from their lists, never a link
PIC = "/api/v1/pictures/ahmed/2000/cuts/side_U.png"
SET_CHECKS = [
    ("v1 the picture sets are listed", "GET", "/api/v1/pictures", {}, 200, '"set": "2000"'),
    ("v1 a set of pictures is served", "GET", "/api/v1/pictures/ahmed/2000", {}, 200, '"cuts/side_U.png"'),
    ("v1 a picture the set lists is served", "GET", PIC, {}, 200, "a picture"),
    ("v1 a picture the set doesn't list is not served", "GET", "/api/v1/pictures/ahmed/2000/cuts/unlisted.png", {},
     404, '"code": "not-found"'),
    ("v1 a picture the set lists that is a link is not served", "GET", "/api/v1/pictures/ahmed/2000/cuts/key.png",
     {}, 404, '"code": "not-found"'),
    ("app: a picture without the pairing key refused", "GET", PIC, {"Origin": APP}, 403, "pairing key"),
    ("app: a picture with the key is served", "GET", PIC, {"Origin": APP, "X-MD-Key": APP_KEY}, 200, "a picture"),
    ("v1 deleting a set with token deletes it", "POST", "/api/v1/pictures/ahmed/1000/delete",
     {"X-MD-Token": TOKEN, "Origin": f"http://{HOST}"}, 200, '"deleted": 2'),
    ("v1 a deleted set is gone", "GET", "/api/v1/pictures/ahmed/1000", {}, 404, '"code": "not-found"'),
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
        ("v1 new case never replaces a case it didn't make, and names none of this machine's folders",
         lambda: (lambda r: r[0] == 409 and "never changed" in r[1] and "md_sec_" not in r[1])(
             req("POST", "/api/v1/jobs", {"Content-Type": JSON, "X-MD-Token": TOKEN, "Origin": f"http://{HOST}"},
                 b'{"kind": "case", "params": {"template": "ahmed-body", "name": "mine", "replace": true}}'))),
        ("v1 readiness check names none of this machine's folders",
         lambda: "md_sec_" not in req("GET", "/api/v1/check")[1]
         and '"cases"' in req("GET", "/api/v1/check", {"Origin": APP, "X-MD-Key": APP_KEY})[1]),
        ("app: no cookies or credentials are ever allowed",
         lambda: header("/api/v1/cases", "Access-Control-Allow-Credentials",
                        headers={"Origin": APP, "X-MD-Key": APP_KEY}) == ""),
        ("app: the key file is readable by its owner only", _key_file_private),
        ("v1 a picture is sent as image/png, never sniffed",
         lambda: header(PIC, "Content-Type") == "image/png" and header(PIC, "X-Content-Type-Options") == "nosniff"),
        ("app: a picture's answer names the app's own address, as every answer does",
         lambda: header(PIC, "Access-Control-Allow-Origin", headers={"Origin": APP, "X-MD-Key": APP_KEY}) == APP),
        ("v1 a picture that is a link to the pairing key never shows the key",
         lambda: APP_KEY not in req("GET", "/api/v1/pictures/ahmed/2000/cuts/key.png")[1]),
    ]

failed = 0
print(f"token found in page: {'yes' if TOKEN else 'NO'} (page status {page_status})")
CHECKS += APP_CHECKS + SET_CHECKS
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
