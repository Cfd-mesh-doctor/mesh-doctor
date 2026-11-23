# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Pairing: lets the Mesh Doctor web app talk to the engine on this machine.

The web app is a static site (for example on Vercel).  It runs in your browser and
calls this machine's /api/v1 on localhost.  Two things keep every other site out:

  * an allow-list of app addresses, the `app_origins` setting (config.py), checked
    against each request's Origin.  Any other site is refused, as before;
  * a pairing key: a random secret in a file only you can read, which the app sends
    on every request (X-MD-Key header).  The pairing link carries it after '#', and a
    browser never sends that part of a link to the web host.

    python3 -m meshdoctor pair            print the pairing link for each app address
    python3 -m meshdoctor pair --new      make a new key: every paired browser must pair again
    python3 -m meshdoctor pair --open     also open the first link in the browser

The key lives in ~/.config/meshdoctor/app.key (MESHDOCTOR_KEY_FILE to change it).
Anyone who has it can use this engine from an allowed app address, so treat the
link like a password: don't post it or put it in a screenshot.
"""
import argparse, json, os, re, secrets, shutil, stat, subprocess, sys
import urllib.error, urllib.request
from urllib.parse import quote

import config
import prog

KEY_FILE = os.path.join(os.path.expanduser("~"), ".config", "meshdoctor", "app.key")
KEY = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
# https on any host (the deployed app), or plain http on this machine only (a developer's own build)
ORIGIN = re.compile(r"^(https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*"
                    r"|http://(localhost|127\.0\.0\.1|\[::1\]))(:[0-9]{1,5})?$")


def key_file():
    return os.environ.get("MESHDOCTOR_KEY_FILE") or KEY_FILE


def parse_origins(text):
    """(valid origins in order, refused entries) from a space- or comma-separated list.
    An origin is scheme://host[:port] only: no path, no wildcard, no trailing slash."""
    good, bad = [], []
    for item in re.split(r"[\s,]+", text or ""):
        if not item:
            continue
        o = item.rstrip("/").lower()
        if ORIGIN.match(o):
            if o not in good:
                good.append(o)
        else:
            bad.append(item)
    return good, bad


def origins():
    """The app addresses this engine answers (the app_origins setting)."""
    return parse_origins(config.settings().get("app_origins", ""))[0]


def _write_key(path, key):
    folder = os.path.dirname(path)
    if folder and not os.path.isdir(folder):
        os.makedirs(folder, mode=0o700, exist_ok=True)
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(key + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def new_key():
    """Make and store a new key.  Every paired browser has to pair again."""
    key = secrets.token_urlsafe(32)
    _write_key(key_file(), key)
    return key


def load_key(create=True):
    """The pairing key, made on first use.  A key file others can read is made private
    (chmod 600) first; one that doesn't hold a key is replaced."""
    path = key_file()
    try:
        mode = stat.S_IMODE(os.stat(path).st_mode)
        if mode & 0o077:
            os.chmod(path, 0o600)
        with open(path, encoding="utf-8") as f:
            key = f.read().strip()
    except OSError:
        key = ""
    if KEY.match(key):
        return key
    return new_key() if create else ""


def link(origin, port, key):
    """The pairing link: the app's /connect page, with the key and the engine address after '#'."""
    engine = f"http://localhost:{int(port)}"
    return f"{origin}/connect#key={quote(key, safe='')}&engine={quote(engine, safe='')}"


def open_url(url):
    """Open a link in the user's browser: the Windows browser from WSL, else the desktop's.
    Returns True when a browser was started.  No shell is involved, so '&' in the link is safe."""
    for cmd in (["wslview", url], ["explorer.exe", url], ["xdg-open", url]):
        if shutil.which(cmd[0]):
            try:
                subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return True
            except OSError:
                continue
    return False


def engine_state(port, origin="", key="", timeout=2.0):
    """Is the engine running on this machine's port, with this key?  Asked as the web app at origin would
    (GET /api/v1/ with the key): 'running' when a Mesh Doctor engine answers, 'old-key' when it runs with
    another key, 'none' when nothing listens there, 'unknown' when something else answers or none in time."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))      # this machine: never a proxy
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/v1/",
                                 headers={"Origin": origin, "X-MD-Key": key} if origin else {})
    try:
        with opener.open(req, timeout=timeout) as r:
            doc = json.loads(r.read(65536).decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            said = e.read(65536).decode("utf-8", "replace")
        except OSError:
            said = ""
        return "old-key" if e.code == 403 and "pairing key" in said else "unknown"
    except urllib.error.URLError as e:
        return "none" if isinstance(e.reason, ConnectionRefusedError) else "unknown"
    except (OSError, ValueError):
        return "unknown"
    return "running" if isinstance(doc, dict) and doc.get("apiVersion") and doc.get("openapi") else "unknown"


def main(argv=None):
    ap = argparse.ArgumentParser(prog=prog.name() + " pair",
                                 description="Pair the Mesh Doctor web app with the engine on this machine.")
    ap.add_argument("--new", action="store_true", help="make a new key (every paired browser must pair again)")
    ap.add_argument("--open", action="store_true", help="open the first link in the browser")
    ap.add_argument("--port", type=int, default=int(os.environ.get("MESHDOCTOR_PORT", "8765")),
                    help="the engine's port (default %(default)s)")
    a = ap.parse_args(argv)
    good, bad = parse_origins(config.settings().get("app_origins", ""))
    for b in bad:
        print(f"ignored app address {b!r}: use https://host[:port], or http://localhost:port", file=sys.stderr)
    if not good:
        sys.exit(f"no app address is set; set app_origins in the config file (see: {prog.name()} config)")
    key = new_key() if a.new else load_key()
    if a.new:
        print("New pairing key made: every browser paired before must pair again.")
    print("Open this link in the browser you use for the app (it holds the key: treat it like a password).")
    serve = prog.name() + " serve" + (f" --port {a.port}" if a.port != 8765 else "")
    state = engine_state(a.port, good[0], key)
    if state == "old-key":                  # the engine read the key when it started: a newer one isn't in it
        print(f"The engine running on port {a.port} " + ("still has the old key" if a.new else
              "has another key (from before a pair --new?)") + f": restart it (Ctrl+C in its terminal, then "
              f"{serve}) for this link to work.")
    elif state == "running":
        print(f"The engine is running on port {a.port}, so the link works now.")
    elif state == "none":
        print(f"No engine is running on port {a.port} yet: start it first, in another terminal: {serve}")
    else:
        print(f"If the engine isn't running yet, start it first, in another terminal: {serve}")
    for o in good:
        print("  " + link(o, a.port, key))
    if a.open and not open_url(link(good[0], a.port, key)):
        print("could not open a browser here; copy the link instead", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
