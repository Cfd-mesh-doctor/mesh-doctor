#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
#
# Integration test on OpenFOAM's own motorBike tutorial (no other data):
#   mesh it -> repair -> no checkMesh count worse, source unchanged
#   -> short A/B with residual hotspots -> repair map with the ground found
#   -> transient plan of the A/B run (case unchanged).
#
#   . /opt/openfoam14/etc/bashrc && ./Allwmake && tests/integration_motorbike.sh
#
# Works only in a new temporary folder; NP ranks for the A/B (default 2).
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
NP=${NP:-2}
[ -n "${FOAM_TUTORIALS:-}" ] || { echo "source OpenFOAM 14 first" >&2; exit 2; }
T=$(mktemp -d /tmp/md_it_XXXXXX)
export MESHDOCTOR_CONFIG=/dev/null MESHDOCTOR_CASES=$T/cases MESHDOCTOR_WORKSPACE=$T/work
SRC=$T/cases/motorBikeSteady
mkdir -p "$T/cases"
cp -r "$FOAM_TUTORIALS/incompressibleFluid/motorBikeSteady" "$T/cases/"
cp "$FOAM_TUTORIALS/resources/geometry/motorBike.obj.gz" "$SRC/constant/geometry/"
step() { echo "== $(date +%H:%M:%S) $*"; }

step "meshing (serial snappyHexMesh)"
( cd "$SRC" && surfaceFeatures > log.surfaceFeatures 2>&1 && blockMesh > log.blockMesh 2>&1 \
  && snappyHexMesh > log.snappyHexMesh 2>&1 ) || { tail -20 "$SRC"/log.*; exit 1; }
cd "$REPO"

step "repair"
python3 -m meshdoctor full "$SRC" it_mb
python3 - "$T/work/it_mb/meshDoctor/result.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
assert r["sourceCheck"]["unchanged"], "source case changed"
assert not r["verdict"]["regressions"], "checkMesh got worse: %s" % r["verdict"]["regressions"]
assert r["verdict"]["improved"], "nothing improved"
print("repair ok: improved", ", ".join(r["verdict"]["improved"]))
PY

step "A/B, 30 iterations on $NP ranks"
python3 -m meshdoctor ab "$SRC" it_mb --iters 30 --np "$NP"      # no --init, as in the README's first run
python3 - "$T/work/it_mb_ab/ab_result.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
assert r["sourceCheck"]["unchanged"], "source case changed"
assert r["init"] == "0", "started from %s, not the tutorial's own 0" % r["init"]   # it has no 0.warm
assert r["residualRatioFixedOverBase"], "no residual comparison"
assert r["base"]["forces"] and r["fixed"]["forces"], "no forces read"
assert r.get("baseHotspots") and r.get("fixedHotspots"), "no hotspot maps"
print("A/B ok: residual ratios", {k: round(v, 2) for k, v in r["residualRatioFixedOverBase"].items()})
PY

step "judge and repair map"
python3 -m meshdoctor judge "$T/work/it_mb_ab/fixed" 10 | python3 -c \
  "import json,sys; j=json.load(sys.stdin); assert j['axes']['up']=='z', j['axes']; print('judge ok:', j['verdict'])"
python3 -m meshdoctor map it_mb --hot "Original=$T/work/it_mb_ab/base" --hot "Repaired=$T/work/it_mb_ab/fixed"
python3 -c "import json,sys; m=json.load(open('$T/work/it_mb/meshDoctor/map.json')); \
assert m['ground']==['lowerWall'], m['ground']; print('map ok: ground', m['ground'], 'axes', m['axes'])"

step "result files match their schemas"
python3 -m meshdoctor schema repair "$T/work/it_mb/meshDoctor/result.json"
python3 -m meshdoctor schema abtest "$T/work/it_mb_ab/ab_result.json"
python3 -m meshdoctor schema map "$T/work/it_mb/meshDoctor/map.json"
python3 -m meshdoctor judge "$T/work/it_mb_ab/fixed" 10 > "$T/judge.json"
python3 -m meshdoctor schema judge "$T/judge.json"
python3 -m meshdoctor judge "$T/work/it_mb_ab/base" auto --to 28 > "$T/judge_to.json"
python3 -m meshdoctor schema judge "$T/judge_to.json"
python3 - "$T/judge_to.json" <<'PY'
import json, sys
j = json.load(open(sys.argv[1]))
assert (j["to"], j["window"]) == (28, 14), (j.get("to"), j["window"])   # auto: half the 28 iterations
assert j["average"] and all(a["to"] <= 28 for a in j["average"].values()), j["average"]   # nothing after 28
print("judge --to ok:", j["verdict"], "over", j["window"], "iterations up to", j["to"])
PY

step "portable report: one file, every document valid, no paths of this machine"
python3 -m meshdoctor report it_mb -o "$T/it_mb.mdreport.json"
python3 -m meshdoctor schema report "$T/it_mb.mdreport.json"
python3 - "$T/it_mb.mdreport.json" "$T" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
assert sorted(r["documents"]) == ["abtest", "map", "repair"], sorted(r["documents"])
bad = {k: c for k, c in r["contents"].items() if c["schemaVersion"] == "legacy" or c["problems"]}
assert not bad, bad
assert sys.argv[2] not in open(sys.argv[1]).read(), "a path of this machine is in the report"
print("report ok:", {k: c["schemaVersion"] for k, c in r["contents"].items()}, r["redacted"]["paths"], "paths replaced")
PY
python3 -m meshdoctor report it_mb --html -o "$T/it_mb.html"
python3 - "$T/it_mb.html" "$T/it_mb.mdreport.json" <<'PY'
import json, re, sys
page, r = open(sys.argv[1]).read(), json.load(open(sys.argv[2]))
assert "<script src=" not in page, "the export loads a script from elsewhere"
slot = page.split('<script type="application/json" id="md-report">')[1].split("</script>")[0]
assert json.loads(slot)["documents"] == r["documents"], "the export holds a different report"
pinned = re.search(r"script-src ([^;]+)", page).group(1).split()
assert len(pinned) == 3 and all(p.startswith("'sha256-") for p in pinned), pinned
assert "connect-src 'none'" in page
print("html export ok:", round(len(page) / 1e6, 2), "MB, one file, its 3 scripts pinned by hash")
PY

step "transient plan: time step and cost of a transient run; the case is only read"
F=$T/work/it_mb_ab/fixed
stamp() { (cd "$F" && find . -printf '%p %s %T@\n' | sort | md5sum); }
before=$(stamp)
python3 -m meshdoctor transient-plan "$F" --co 1,5 -o "$T/tplan.json"
[ "$before" = "$(stamp)" ] || { echo "transient-plan changed the case" >&2; exit 1; }
python3 -m meshdoctor schema tplan "$T/tplan.json"
python3 - "$T/tplan.json" <<'PY'
import json, sys
p = json.load(open(sys.argv[1]))
o1, o5 = p["options"]
assert p["cells"] > 100000 and p["regions"] and p["speed"] == 20, p
assert abs(o5["deltaT"] / o1["deltaT"] - 5) < 1e-9 and o1["deltaT"] <= o1["deltaTWithoutTop"], p["options"]
print("transient plan ok: dt", f"{o1['deltaT']:.3g}", "s at max Co 1, set by", p["cellsWithin2x"], "cells")
PY

step "jobs through /api/v1: repair, one job at a time, cancel an A/B mid-solve"
python3 tests/api_jobs_check.py motorBikeSteady
for f in "$T"/work/.jobs/*.json; do python3 -m meshdoctor schema job "$f"; done

step "PASS (temporary folder $T can be deleted)"
