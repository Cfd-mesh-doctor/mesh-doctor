# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Portable report bundles: a run's results in one file that opens anywhere.

    python3 -m meshdoctor report <name> [--ab <label>] [-o <file>] [--html | --gzip]
    python3 -m meshdoctor report --viewer [-o <file>]

A report is one JSON file (schemas/report.schema.json) that holds the run's
versioned documents: the repair result, its repair map and its A/B test, when
they exist.  Paths on this machine are replaced (workspace/..., cases/...,
else the file name only), so the file can be shared; it still holds the case's
geometry coordinates, patch and force-group names and numbers.

Open it in the viewer (web/report.html): `meshdoctor serve` then /report, a
static host that serves web/ (the page reads the file in the browser and sends
nothing), or --html, which writes the viewer with the report inside, one file
to email.  --viewer writes that one-file viewer with no report in it: a page
anyone can open a report file in, from a disk or any static web host.

Default output: <workspace>/.reports/<name>.mdreport.json (.html, .json.gz).
"""
import argparse, base64, gzip, hashlib, json, os, re, sys, time

import config
import schema
import version

HERE = os.path.dirname(os.path.abspath(__file__))
VIEWER = os.path.join(HERE, "web", "report.html")
SLOT = '<script type="application/json" id="md-report"></script>'
SCRIPT_TAG = re.compile(r'<script src="js/([a-z0-9][a-z0-9-]{0,40}\.js)"></script>')
SCRIPT_POLICY = "script-src 'self'"          # the viewer's meta CSP; the export pins each inlined script by hash
KIND = "meshdoctor-report"
SAFE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$")
# an absolute path: at the start, or after a space, quote, =, bracket, comma or colon ("m/s", "</b>" are not paths)
PATH = re.compile(r"""(?<![^\s"'=(\[,:])/(?:[\w.@%+-]+/)*[\w.@%+-]+""")
BASE64 = re.compile(r"[A-Za-z0-9+/]+={0,2}")
BLOBS = {"data"}                     # map.json side/top images


class Redactor:
    """Replaces absolute paths in every string of a document."""

    def __init__(self, roots):
        self.roots = [(r.rstrip("/") + "/", label) for r, label in roots if r]
        self.count = 0

    def path(self, m):
        p = m.group(0)
        self.count += 1
        for root, label in self.roots:
            if p == root[:-1]:
                return label
            if p.startswith(root):
                return label + "/" + p[len(root):]
        return p.rsplit("/", 1)[-1]

    def __call__(self, v, key=None):
        if isinstance(v, str):
            # never touch encoded data (the map's base64 images contain "+/..." that looks like a path)
            if key in BLOBS or (len(v) >= 1024 and BASE64.fullmatch(v)) or "/" not in v:
                return v
            return PATH.sub(self.path, v)
        if isinstance(v, list):
            return [self(x) for x in v]
        if isinstance(v, dict):
            return {k: self(x, k) for k, x in v.items()}
        return v


def digest(doc):
    return hashlib.sha256(json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _load(path, kind):
    try:
        return schema.read(path, kind)
    except FileNotFoundError:
        return None


def build(name, ab=None, ws=None, cases=None):
    """The report dict for workspace run `name` (and A/B test `ab`, default <name>_ab)."""
    s = config.settings()
    ws, cases = ws or s["workspace"], cases or s["cases"]
    if not SAFE.match(name) or (ab and not SAFE.match(ab)):
        raise ValueError("plain run names only")
    files = {"repair": os.path.join(ws, name, "meshDoctor", "result.json"),
             "map": os.path.join(ws, name, "meshDoctor", "map.json"),
             "abtest": os.path.join(ws, (ab or name) + "_ab", "ab_result.json")}
    docs = {k: _load(p, k) for k, p in files.items()}
    if docs["repair"] is None:
        raise FileNotFoundError(f"no finished repair {name} in the workspace")
    if ab and docs["abtest"] is None:
        raise FileNotFoundError(f"no finished A/B test {ab} in the workspace")
    red = Redactor([(ws, "workspace"), (cases, "cases")])
    documents, contents = {}, {}
    for k, d in docs.items():
        if d is None:
            continue
        d = red(d)
        documents[k] = d
        problems = schema.validate(d, k) if "schemaVersion" in d else []
        contents[k] = {"schemaVersion": d.get("schemaVersion", "legacy"), "sha256": digest(d),
                       "bytes": len(json.dumps(d)), "problems": problems[:5]}
    return schema.stamp({
        "kind": KIND, "name": name, "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "generator": {"meshdoctor": version.VERSION, "openfoam": docs["repair"].get("openfoam")},
        "redacted": {"paths": red.count,
                     "note": "paths on the worker replaced by workspace/..., cases/... or the file name"},
        "contents": contents, "documents": documents}, "report")


def csp_hash(js):
    """The CSP source that allows exactly this inline script ('sha256-...')."""
    return "'sha256-" + base64.b64encode(hashlib.sha256(js.encode("utf-8")).digest()).decode() + "'"


def html(report=None):
    """The viewer as one file: its scripts inlined, each allowed by its hash only, and
    no network access at all.  With a report, the report is inside; without, it is the
    empty viewer that opens report files."""
    with open(VIEWER, encoding="utf-8") as f:
        page = f.read()
    if SLOT not in page or page.count(SCRIPT_POLICY) != 1:
        raise RuntimeError("viewer page has no report slot or no script policy")
    hashes = []

    def inline(m):
        # text mode reads \r\n as \n, as the browser's parser does, so the hash matches either way
        with open(os.path.join(HERE, "web", "js", m.group(1)), encoding="utf-8") as f:
            js = f.read()
        if re.search(r"</script|<!--", js, re.I):            # would end the inline script early
            raise RuntimeError(f"web/js/{m.group(1)} cannot be inlined")
        hashes.append(csp_hash(js))
        return f"<script>{js}</script>"

    page = SCRIPT_TAG.sub(inline, page)
    if not hashes:
        raise RuntimeError("viewer page loads no scripts")
    page = page.replace(SCRIPT_POLICY, "script-src " + " ".join(hashes))
    page = page.replace("connect-src 'self'", "connect-src 'none'")
    if report is None:
        return page
    data = json.dumps(report, separators=(",", ":")).replace("<", "\\u003c")   # never closes the script tag
    return page.replace(SLOT, f'<script type="application/json" id="md-report">{data}</script>')


def write(report, path, fmt="json"):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    if fmt == "html":
        with open(path, "w", encoding="utf-8") as f:
            f.write(html(report))
    elif fmt == "gzip":
        with gzip.open(path, "wt", encoding="utf-8") as f:
            json.dump(report, f, separators=(",", ":"))
    else:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(report, f, separators=(",", ":"))
    return path


def main(argv=None):
    ap = argparse.ArgumentParser(prog="meshdoctor report", description=__doc__.split("\n\n")[0])
    ap.add_argument("name", nargs="?", help="workspace run (a finished repair)")
    ap.add_argument("--ab", help="A/B test label to include (default <name>, if it exists)")
    ap.add_argument("-o", "--out", help="output file (default <workspace>/.reports/<name>.mdreport.<ext>)")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--html", action="store_true", help="the viewer page with the report inside, one file")
    g.add_argument("--gzip", action="store_true", help="gzip the JSON (the viewer opens it as it is)")
    g.add_argument("--viewer", action="store_true", help="only the one-file viewer, no report in it (for a static host)")
    a = ap.parse_args(argv)
    if a.viewer:
        if a.name or a.ab:
            ap.error("--viewer takes no run name")
        out = a.out or os.path.join(config.settings()["workspace"], ".reports", "meshdoctor-viewer.html")
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            f.write(html())
        print(f"viewer: {out}  {os.path.getsize(out) / 1e3:.0f} kB")
        print("  open it, or put it on any static host; it reads report files in the browser and sends nothing")
        return 0
    if not a.name:
        ap.error("give a run name (or --viewer)")
    fmt = "html" if a.html else "gzip" if a.gzip else "json"
    try:
        rep = build(a.name, a.ab)
    except (ValueError, FileNotFoundError, schema.SchemaError) as e:
        sys.exit(str(e))
    ext = {"html": "html", "gzip": "json.gz", "json": "json"}[fmt]
    out = a.out or os.path.join(config.settings()["workspace"], ".reports", f"{a.name}.mdreport.{ext}")
    write(rep, out, fmt)
    parts = ", ".join(f"{k} ({c['schemaVersion']})" for k, c in rep["contents"].items())
    print(f"report: {out}  {os.path.getsize(out) / 1e6:.2f} MB")
    print(f"  holds {parts}; {rep['redacted']['paths']} worker paths replaced")
    for k, c in rep["contents"].items():
        if c["problems"]:
            print(f"  WARNING {k} does not match its schema: {c['problems'][0]}")
    print("  open it in the viewer: meshdoctor serve, then http://localhost:8765/report"
          + ("" if fmt != "html" else " (or just open this .html file)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
