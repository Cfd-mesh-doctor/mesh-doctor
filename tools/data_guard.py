#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Data guard: keeps simulation data, CAD and private names out of this repository.

    python3 tools/data_guard.py --staged    # files staged for commit (the pre-commit hook)
    python3 tools/data_guard.py --tree      # every file git would see in the working tree
    python3 tools/data_guard.py --history   # every file version and commit in the history (pre-push)

Built-in rules (always on):
  * no case or mesh folders: polyMesh, processorN, postProcessing, triSurface,
    dynamicCode, time folders (0, 100, 0.5, 0.orig ...);
  * no CAD, mesh, result, archive or spreadsheet files (.stl .step .sldprt .vtk
    .foam .xlsx .zip ...), no OpenFOAM logs (log.<name>), no Mesh Doctor result files;
    .dat files only under tests/fixtures/;
  * no file over 1 MB; no binary file except images under docs/images/;
  * no personal paths (/home/<name>/, /mnt/c/Users/<name>, C:\\Users\\<name>,
    WSL network shares) and no e-mail addresses except @example.invalid,
    @users.noreply.github.com, noreply@... and GitHub's own support@github.com
    (Dependabot signs off with it), in files and in commit authors
    and messages.

Private rules: extra words that must never appear (team, project and case names),
one per line, case-insensitive, '#' starts a comment.  They are read from
.data-guard-private.txt in the repository root (git-ignored, never committed) and
from the DATA_GUARD_PATTERNS environment variable (newline-separated; set it as a
CI secret).  The words themselves are never printed.

Exit status 1, with a list of findings, if anything matches.
"""
import os, re, subprocess, sys

MAX_BYTES = 1_000_000
BAD_DIRS = re.compile(r"^(polyMesh|processor\d+|postProcessing|triSurface|dynamicCode|"
                      r"\d+(\.\d+)?|0\.(orig|warm|cold))$")
BAD_EXT = {".stl", ".obj", ".ply", ".3mf", ".step", ".stp", ".igs", ".iges", ".x_t", ".x_b",
           ".sldprt", ".sldasm", ".slddrw", ".prt", ".catpart", ".msh", ".cgns", ".vtk", ".vtu",
           ".vtp", ".vtm", ".pvsm", ".foam", ".xlsx", ".xls", ".xlsm", ".h5", ".hdf5", ".npy",
           ".npz", ".pkl", ".zip", ".7z", ".tar", ".gz", ".tgz", ".rar", ".bak"}
BAD_NAMES = {".meshDoctorCopy", "result.json", "ab_result.json", "map.json", "hotspots.json",
             "status.json", "ab_status.json"}
OF_LOG = re.compile(r"^log\.[A-Za-z][\w.-]*$")
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
PERSONAL = [
    ("personal Linux path", re.compile(r"/home/(?!(user|you|runner|ubuntu|<)[/\s<])[A-Za-z0-9_.-]+/")),
    ("personal Windows path", re.compile(r"[A-Za-z]:(\\\\|\\|/)+Users(\\\\|\\|/)+(?!<)[^\\/\s\"'<>]+", re.I)),
    ("personal WSL path", re.compile(r"/mnt/[a-z]/Users/(?!<)[^/\s\"']+", re.I)),
    ("personal WSL network path",
     re.compile(r"\\+wsl(\.localhost|\$)\\+[^\\\s\"'{}]+\\+home\\+(?!<)[^\\\s\"'{}]+", re.I)),
]
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
# allowed: placeholder addresses, GitHub's private commit addresses, and no-reply addresses
EMAIL_OK = re.compile(r"(@(example\.invalid|users\.noreply\.github\.com)$)|(^noreply@)"
                      r"|(^support@github\.com$)", re.I)       # Dependabot's sign-off line


def git(*args, inp=None):
    return subprocess.run(["git", *args], input=inp, capture_output=True, check=True).stdout


def private_words(root):
    words = []
    p = os.path.join(root, ".data-guard-private.txt")
    if os.path.isfile(p):
        words += open(p, encoding="utf-8").read().splitlines()
    words += os.environ.get("DATA_GUARD_PATTERNS", "").splitlines()
    return [w.strip().lower() for w in words if w.strip() and not w.strip().startswith("#")]


def path_findings(path, size):
    out = []
    parts = path.replace("\\", "/").split("/")
    name = parts[-1]
    ext = os.path.splitext(name)[1].lower()
    for d in parts[:-1]:
        if BAD_DIRS.match(d):
            out.append(f"case/mesh folder '{d}'")
            break
    if ext in BAD_EXT:
        out.append(f"blocked file type '{ext}'")
    if ext == ".dat" and not path.startswith("tests/fixtures/"):
        out.append("'.dat' outside tests/fixtures/")
    if name in BAD_NAMES:
        out.append("Mesh Doctor result file")
    if OF_LOG.match(name) and ext not in {".py", ".md", ".txt", ".sh"}:
        out.append("OpenFOAM log file")
    if size > MAX_BYTES:
        out.append(f"larger than 1 MB ({size:,} bytes)")
    return out


def text_findings(text, words, what="line"):
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        low = line.lower()
        for label, rx in PERSONAL:
            if rx.search(line):
                out.append(f"{what} {i}: {label}")
        for m in EMAIL.finditer(line):
            if not EMAIL_OK.search(m.group(0)):
                out.append(f"{what} {i}: e-mail address")
        for k, w in enumerate(words):
            if w in low:
                out.append(f"{what} {i}: private word #{k + 1}")
    return out


def check_blob(path, data, words):
    out = path_findings(path, len(data))
    ext = os.path.splitext(path)[1].lower()
    if b"\0" in data[:8192]:
        if not (ext in IMAGE_EXT and path.startswith("docs/images/")):
            out.append("binary file (only images under docs/images/ are allowed)")
        return out
    out += text_findings(data.decode("utf-8", "replace"), words)
    return out


def staged(words):
    names = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").decode().split("\0")
    return {p: check_blob(p, git("show", f":{p}"), words) for p in names if p}


def tree(words):
    names = git("ls-files", "-co", "--exclude-standard", "-z").decode().split("\0")
    res = {}
    for p in names:
        if p and os.path.isfile(p):
            with open(p, "rb") as f:
                res[p] = check_blob(p, f.read(), words)
    return res


def history(words):
    res = {}
    objs = [l.split(" ", 1) for l in git("rev-list", "--objects", "--all").decode().splitlines()]
    named = [(o[0], o[1]) for o in objs if len(o) == 2 and o[1]]
    if named:
        info = git("cat-file", "--batch-check=%(objectname) %(objecttype)",
                   inp="\n".join(s for s, _ in named).encode()).decode().split("\n")
        blobs = [(s, p) for (s, p), i in zip(named, info) if i.endswith(" blob")]
        raw = git("cat-file", "--batch", inp="\n".join(s for s, _ in blobs).encode())
        pos = 0
        for sha, path in blobs:
            nl = raw.index(b"\n", pos)
            size = int(raw[pos:nl].split()[2])
            data = raw[nl + 1:nl + 1 + size]
            pos = nl + 1 + size + 1
            res[f"{path} @ {sha[:10]}"] = check_blob(path, data, words)
    try:
        meta = git("log", "--all", "--format=commit %h%n%an <%ae>%n%cn <%ce>%n%B%n").decode("utf-8", "replace")
    except subprocess.CalledProcessError:
        meta = ""                             # no commits yet
    res["(commit authors and messages)"] = text_findings(meta, words, what="commit-log line")
    return res


def main(argv):
    mode = argv[0] if argv else "--staged"
    root = git("rev-parse", "--show-toplevel").decode().strip()
    os.chdir(root)
    words = private_words(root)
    run = {"--staged": staged, "--tree": tree, "--history": history}.get(mode)
    if not run:
        print(__doc__)
        return 2
    res = run(words)
    bad = {p: f for p, f in res.items() if f}
    print(f"data guard {mode}: {len(res)} item(s) checked, {len(words)} private word(s) loaded, "
          f"{len(bad)} with findings")
    for p, f in sorted(bad.items()):
        print(f"  BLOCKED {p}")
        for x in f[:12]:
            print(f"      {x}")
        if len(f) > 12:
            print(f"      ... and {len(f) - 12} more")
    if bad:
        print("Remove or fix these before committing or pushing. Simulation data, CAD and team names "
              "never go in this repository.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
