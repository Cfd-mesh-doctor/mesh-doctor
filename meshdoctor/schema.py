# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Versioned result files (standard library only).

Every file Mesh Doctor writes for another program carries
"schemaVersion": "<major>.<minor>" and has a JSON Schema in schemas/:

  kind     file                              schema
  repair   <run>/meshDoctor/result.json       schemas/repair.schema.json
  abtest   <run>_ab/ab_result.json            schemas/abtest.schema.json
  judge    output of `judge` (and fixedJudge) schemas/judge.schema.json
  map      <run>/meshDoctor/map.json          schemas/map.schema.json
  job      .jobs/<id>.json                    schemas/job.schema.json
  report   meshdoctor report <name>           schemas/report.schema.json

A minor version only adds fields; a major version changes or removes them.
Readers accept every minor version of the major they know, files written
before versioning existed ("legacy"), and refuse a newer major version.

    python3 -m meshdoctor schema <kind> <file>     # validate a file
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
VERSIONS = {"repair": "1.0", "abtest": "1.0", "judge": "1.1", "map": "1.0", "job": "1.0", "report": "1.0"}
_cache = {}


class SchemaError(ValueError):
    """A file this version of Mesh Doctor cannot read."""


def stamp(doc, kind):
    """The same dict with schemaVersion first (key order is kept in the JSON)."""
    return {"schemaVersion": VERSIONS[kind], **{k: v for k, v in doc.items() if k != "schemaVersion"}}


def schema(kind):
    if kind not in _cache:
        with open(os.path.join(HERE, "schemas", f"{kind}.schema.json"), encoding="utf-8") as f:
            _cache[kind] = json.load(f)
    return _cache[kind]


def compatible(doc, kind):
    """(True, note) when this code can read doc, else (False, reason)."""
    v = doc.get("schemaVersion") if isinstance(doc, dict) else None
    if v is None:
        return True, "legacy (written before schema versions)"
    m = re.fullmatch(r"(\d+)\.(\d+)", str(v))
    if not m:
        return False, f"unreadable schemaVersion {v!r}"
    have = int(VERSIONS[kind].split(".")[0])
    if int(m.group(1)) > have:
        return False, (f"{kind} file version {v} is newer than this Mesh Doctor understands "
                       f"({VERSIONS[kind]}); update Mesh Doctor")
    return True, f"version {v}"


def read(path, kind):
    """Load a result file; SchemaError if it is from a newer major version."""
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    ok, why = compatible(doc, kind)
    if not ok:
        e = SchemaError(f"{path}: {why}")
        e.why = why                       # the reason without the path (for API answers)
        raise e
    return doc


def write(path, doc, kind=None, **dump):
    """Write a result file (stamped with the current version when kind is given)."""
    if kind:
        doc = stamp(doc, kind)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, **dump)
    return doc


# --- a small validator for the JSON Schema keywords the schemas use ---------
_TYPES = {"object": dict, "array": list, "string": str, "boolean": bool, "null": type(None)}


def _is(value, t):
    if t == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if t == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return isinstance(value, _TYPES[t])


def _check(value, sch, root, path, errors):
    if "$ref" in sch:                                   # local refs only: #/$defs/<name>
        name = sch["$ref"].split("/")[-1]
        sch = root["$defs"][name]
    types = sch.get("type")
    if types:
        types = [types] if isinstance(types, str) else types
        if not any(_is(value, t) for t in types):
            errors.append(f"{path}: expected {' or '.join(types)}, got {type(value).__name__}")
            return
    if value is None:
        return
    if "enum" in sch and value not in sch["enum"]:
        errors.append(f"{path}: {value!r} not one of {sch['enum']}")
    if "pattern" in sch and isinstance(value, str) and not re.search(sch["pattern"], value):
        errors.append(f"{path}: {value!r} does not match {sch['pattern']}")
    if "minimum" in sch and _is(value, "number") and value < sch["minimum"]:
        errors.append(f"{path}: {value} < {sch['minimum']}")
    if "maximum" in sch and _is(value, "number") and value > sch["maximum"]:
        errors.append(f"{path}: {value} > {sch['maximum']}")
    if isinstance(value, dict):
        for k in sch.get("required", []):
            if k not in value:
                errors.append(f"{path}: missing {k}")
        props = sch.get("properties", {})
        extra = sch.get("additionalProperties", True)
        for k, v in value.items():
            if k in props:
                _check(v, props[k], root, f"{path}.{k}", errors)
            elif extra is False:
                errors.append(f"{path}: unexpected {k}")
            elif isinstance(extra, dict):
                _check(v, extra, root, f"{path}.{k}", errors)
    if isinstance(value, list) and "items" in sch:
        for i, v in enumerate(value):
            _check(v, sch["items"], root, f"{path}[{i}]", errors)


def validate(doc, kind):
    """List of problems (empty when doc matches the schema for kind)."""
    return check(doc, schema(kind))


def check(value, sch):
    """List of problems with value against any schema written with the keywords
    above (local $refs resolve inside sch).  The API checks requests with it."""
    errors = []
    _check(value, sch, sch, "$", errors)
    return errors


def main(argv):
    if len(argv) != 2 or argv[0] not in VERSIONS:
        print(__doc__)
        return 2
    kind, path = argv
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    ok, why = compatible(doc, kind)
    errors = validate(doc, kind) if ok else [why]
    print(f"{path}: {kind} {why}: " + ("valid" if not errors else f"{len(errors)} problem(s)"))
    for e in errors[:50]:
        print("  " + e)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
