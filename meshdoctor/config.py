# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Where Mesh Doctor finds OpenFOAM and the cases, and where it keeps its work.

Nothing about one machine is written in the code.  Each value comes from, in order:
an environment variable, the config file, or a generic default.

  setting     environment variable          default
  cases       MESHDOCTOR_CASES              $FOAM_RUN, else ~/OpenFOAM/run
  workspace   MESHDOCTOR_WORKSPACE          <cases>/meshdoctor
  bashrc      MESHDOCTOR_FOAM_BASHRC        $WM_PROJECT_DIR/etc/bashrc, else /opt/openfoam14/etc/bashrc
  live_case   MESHDOCTOR_LIVE_CASE          (none) case shown on the live transient page
  flow_axis   MESHDOCTOR_FLOW_AXIS          (none) e.g. -x; only used when 0/U has no freestream
  up_axis     MESHDOCTOR_UP_AXIS            (none) e.g. z; else forceCoeffs liftDir, else the
                                            cross-flow axis with the larger force
  ram_limit_mb MESHDOCTOR_RAM_LIMIT_MB      (none) most memory a job may use (RAM guard)
  app_origins MESHDOCTOR_APP_ORIGINS        https://mesh-doctor.vercel.app: web app addresses that
                                            may use this engine once paired (pairing.py); separate
                                            several with spaces

MESHDOCTOR_CONFIG points at another config file than the one below.

Config file: ~/.config/meshdoctor/config.ini, for example

    [paths]
    cases = /home/<you>/OpenFOAM/<you>-14/run
    workspace = /home/<you>/OpenFOAM/<you>-14/run/meshdoctor

Everything runs on Linux (or inside WSL on Windows): the repair, the A/B test
and the dashboard server.  A Windows browser reaches the dashboard through
WSL's localhost forwarding.

    python3 -m meshdoctor config        # the values in use and where each came from
"""
import configparser, json, os, stat, sys

CONFIG_FILE = os.path.join(os.path.expanduser("~"), ".config", "meshdoctor", "config.ini")
DEFAULT_APP_ORIGINS = "https://mesh-doctor.vercel.app"     # the published web app (pairing.py)
HERE = os.path.dirname(os.path.abspath(__file__))


def config_file():
    return os.environ.get("MESHDOCTOR_CONFIG") or CONFIG_FILE


def _file_values():
    cp = configparser.ConfigParser()
    try:
        cp.read(config_file(), encoding="utf-8")
    except configparser.Error:
        return {}
    return {k: os.path.expanduser(v) for s in cp.sections() for k, v in cp.items(s)}


def resolve():
    """The settings for this machine, each with where it came from."""
    f = _file_values()
    out = {}

    def pick(key, env, default):
        if os.environ.get(env):
            out[key] = (os.path.expanduser(os.environ[env]), "environment " + env)
        elif f.get(key):
            out[key] = (f[key], "config file " + config_file())
        else:
            out[key] = (default, "default")

    home = os.path.expanduser("~")
    pick("cases", "MESHDOCTOR_CASES", os.environ.get("FOAM_RUN") or os.path.join(home, "OpenFOAM", "run"))
    pick("workspace", "MESHDOCTOR_WORKSPACE", os.path.join(out["cases"][0], "meshdoctor"))
    wm = os.environ.get("WM_PROJECT_DIR")
    pick("bashrc", "MESHDOCTOR_FOAM_BASHRC",
         os.path.join(wm, "etc", "bashrc") if wm else "/opt/openfoam14/etc/bashrc")
    pick("live_case", "MESHDOCTOR_LIVE_CASE", "")
    pick("flow_axis", "MESHDOCTOR_FLOW_AXIS", "")
    pick("up_axis", "MESHDOCTOR_UP_AXIS", "")
    pick("ram_limit_mb", "MESHDOCTOR_RAM_LIMIT_MB", "")
    pick("app_origins", "MESHDOCTOR_APP_ORIGINS", DEFAULT_APP_ORIGINS)
    return out


def settings():
    """Plain values {setting: value}."""
    return {k: v for k, (v, _) in resolve().items()}


def ensure_workspace(path=None):
    """Create the workspace readable by its owner only (700).  An existing folder
    is left as it is; the warning returned says when others can read it (on a
    shared machine or cluster node, they could read the copied cases)."""
    path = path or settings()["workspace"]
    if not os.path.isdir(path):
        os.makedirs(path, mode=0o700, exist_ok=True)
        os.chmod(path, 0o700)          # makedirs' mode is masked by umask
        return None
    mode = stat.S_IMODE(os.stat(path).st_mode)
    if mode & 0o077:
        return (f"workspace {path} is open to other users (mode {mode:o}); "
                f"on a shared machine run: chmod 700 '{path}'")
    return None


if __name__ == "__main__":
    vals = resolve()
    if "--json" in sys.argv:
        print(json.dumps({k: v for k, (v, _) in vals.items()}))
    else:
        for k, (v, src) in vals.items():
            print(f"{k:11s} {v or '(none)'}    [{src}]")
