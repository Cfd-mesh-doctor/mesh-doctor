# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Two runs' results compared over the same window: is each force's difference real, or inside the noise?

    python3 -m meshdoctor compare <a> <b> [--from T] [--to T] [--mesh] [--json]
    python3 -m meshdoctor compare --abtest <name> [--from T] [--to T] [--json]

<a> and <b> are cases in the cases folder with a force history (runs Mesh Doctor solved, or cases you solved
yourself), or their folders; --abtest compares an A/B test's two runs: its original mesh's as a, its repaired mesh's
as b (of a test of solver settings on one mesh: its settings' run as a, the variant's as b; of a test that reused an
earlier test's original-mesh run, with --base-from, that run as a).  They are only read.

The window is the same for both: up to the shorter run's end (or --to), from the later of their judges' starts (or
--from), each as results.py averages it.  Two runs that aren't both steady or both transient can't share one (its
iterations and seconds of flow): each is then averaged over its own judge's window.

For each force group in both (by name; the two total groups go together when their names differ), its drag and its
vertical force: each side's mean, b's difference from a in N and in % of a's, and the noise it is judged against: the
two sides' noise added in quadrature, each side's the larger of its mean's uncertainty (abtest.batch_means', which a
slow oscillation widens) and its drift in N.  A difference larger than its noise is real; else it is inside the
noise, as the cfd-results skill says.  A force under 1 % of the total drag is marked small.  Two cases made from the
same template at two mesh sizes are a mesh study (any two are with --mesh: one design meshed twice): each force then
also says whether it moves less between the two meshes than it swings (the larger standard deviation), the skill's
test of mesh independence.  Plain warnings: a design comparison's meshes more than CELLS_SAME apart in cells, a half
model against a whole one, vertical forces that point opposite ways, a run still drifting, too few values to judge,
and groups only one of them has.
GET /api/v1/compare?a=&b= (or ?abtest=) answers the same, and GET /api/v1/abtests/{name}/forces?side=base|fixed
gives each run of an A/B test its force history for charts, as GET /api/v1/results/{case}/forces gives a case's.
"""
import argparse, json, math, os, sys

import caseinfo
import prog
import results
import schema
import tplan

CELLS_SAME = 0.02    # a design comparison's meshes: cells within 2 % of each other (the cfd-results skill's 1 to 2 %)
CHAIN = 8            # how many copies and transient runs origin() follows back
KINDS = {"design": "two designs", "mesh": "a mesh study: one design at two mesh sizes",
         "abtest": "an A/B test's two runs"}


def origin(case):
    """The template and mesh size case folder `case` was made from, {"template", "size"}, following a run back
    through the case it is a copy or a transient run of (md_api.made); None for a case you made yourself."""
    import jobs, md_api
    for _ in range(CHAIN):
        doc = md_api._read_json(os.path.join(case, jobs.CASE_MARKER))
        if not isinstance(doc, dict) or doc.get("state") != "done":
            return None
        back = doc.get("copyOf") or doc.get("transientOf")
        if not back:
            t, s = doc.get("template"), doc.get("size")
            return {"template": str(t), "size": str(s)} if t and s else None
        if not md_api.SAFE.match(str(back)):
            return None
        case = os.path.join(md_api.run_dir(), str(back))
    return None


def noise(v):
    """How far a force's mean (results.quantity's) may still move, in N: the larger of its uncertainty and its drift;
    None while its uncertainty isn't known (fewer than 25 values)."""
    if not v or v.get("u") is None:
        return None
    return max(v["u"], abs((v.get("drift") or 0.0) * v["mean"]))


def differ(a, b, ref, mesh):
    """Force a against force b (results.quantity's), or None without both: their means, b's difference from a in N
    and in % of a's, its noise and whether it is larger (real: None when the noise isn't known), the swing (the larger
    standard deviation), whether it is small (under results.SMALL of the total drag `ref`), and in a mesh study
    whether it moves no more between the meshes than it swings (meshOk)."""
    if not a or not b:
        return None
    diff = b["mean"] - a["mean"]
    na, nb = noise(a), noise(b)
    n = math.hypot(na, nb) if na is not None and nb is not None else None
    swing = max(a["sd"], b["sd"])
    return {"a": a["mean"], "b": b["mean"], "diff": diff, "pct": diff / abs(a["mean"]) * 100 if a["mean"] else None,
            "noise": n, "real": None if n is None else abs(diff) > n, "swing": swing,
            "meshOk": abs(diff) <= swing if mesh else None,
            "small": max(abs(a["mean"]), abs(b["mean"])) < results.SMALL * ref}


def _end(case, name):
    """When case's total force group ends (results.of_case's `end`); raises its not-ready without a force history."""
    frc = {g: F for g, F in caseinfo.parse_forces(case).items() if F.get("Time")}
    if not frc:
        raise ValueError("not-ready", f"{name} has no force history yet: its forces or forceCoeffs function objects "
                                      "write one, in postProcessing, as it solves")
    return frc[caseinfo.describe(case, frc)["total"]]["Time"][-1]


def _total(doc):
    return next((g for g in doc["groups"] if g["total"]), None)


def _side(doc, made):
    """One side's own results, briefly."""
    return {"case": doc["case"], "transient": doc["transient"], "cells": doc["cells"], "start": doc["start"],
            "end": doc["end"], "window": doc["window"], "verdict": doc["verdict"],
            "vertical": doc["axes"]["vertical"], "symmetry": doc["symmetry"], "made": made,
            "warnings": doc["warnings"]}


def compare(case_a, case_b, t_from=None, t_to=None, names=(None, None), abtest=False, study=False):
    """The comparison of case folders case_a and case_b (see the module's help), a mesh study if `study`; raises
    ValueError(code, message), the message naming no folders."""
    na, nb = (n or os.path.basename(os.path.normpath(c)) for n, c in zip(names, (case_a, case_b)))
    if t_from is not None and t_to is not None and t_from >= t_to:
        raise ValueError("bad-request", f"the window's from ({t_from:g}) must come before its to ({t_to:g})")
    if caseinfo.transient(case_a) != caseinfo.transient(case_b):
        if t_from is not None or t_to is not None:
            raise ValueError("bad-request", f"{na} and {nb} aren't both steady or both transient, so their windows "
                                            "are in different units (iterations and seconds of flow): leave from and "
                                            "to out, and each is averaged over its own judge's window")
        A, B, shared = results.of_case(case_a, name=na), results.of_case(case_b, name=nb), None
    else:
        ends = _end(case_a, na), _end(case_b, nb)
        to = min(ends)                                                  # up to the shorter run's end
        if t_from is not None and t_from >= to:
            raise ValueError("not-ready", f"{na if ends[0] <= ends[1] else nb}'s forces end at {to:g}, before the "
                                          f"window's from ({t_from:g}): pick an earlier from, or let it solve longer")
        to = to if t_to is None else min(to, t_to)
        if t_from is not None:
            frm, how = t_from, "given"
            A, B = results.of_case(case_a, frm, to, na), results.of_case(case_b, frm, to, nb)
        else:                                                           # the later of their judges' starts
            A, B = results.of_case(case_a, None, to, na), results.of_case(case_b, None, to, nb)
            starts = [A["window"]["from"], B["window"]["from"]]
            frm, how = (None if None in starts else max(starts)), "judges"
            if frm is not None:
                A = A if starts[0] == frm else results.of_case(case_a, frm, to, na)
                B = B if starts[1] == frm else results.of_case(case_b, frm, to, nb)
        shared = {"from": frm, "to": to, "how": how}
    oa, ob = (None, None) if abtest else (origin(case_a), origin(case_b))
    mesh = study or bool(oa and ob and oa["template"] == ob["template"] and oa["size"] != ob["size"])
    kind = "abtest" if abtest else "mesh" if mesh else "design"
    ta, tb = _total(A), _total(B)
    ref = max(abs(t["drag"]["mean"]) for t in (ta, tb) if t) if ta or tb else 0.0
    same_up = A["axes"]["vertical"] == B["axes"]["vertical"]
    by_b = {g["name"]: g for g in B["groups"]}
    pairs = [(g, by_b[g["name"]]) for g in A["groups"] if g["name"] in by_b]      # like with like, by name
    if ta and tb and all(g is not ta and h is not tb for g, h in pairs):
        pairs.insert(0, (ta, tb))                                       # else the two totals, whatever their names
    pairs.sort(key=lambda p: p[0] is not ta)                            # a's total first
    groups = [{"name": g["name"], "nameB": h["name"], "total": g is ta, "patches": g["patches"],
               "drag": differ(g["drag"], h["drag"], ref, mesh),
               "vertical": differ(g["vertical"], h["vertical"], ref, mesh) if same_up else None} for g, h in pairs]
    only = [(n, [g["name"] for g in d["groups"] if all(g is not p[i] for p in pairs)])
            for i, (n, d) in enumerate(((na, A), (nb, B)))]

    warnings = []
    if shared is None:
        warnings.append(f"{na} and {nb} aren't both steady or both transient: each is averaged over its own judge's "
                        "window.")
    ca, cb = A["cells"], B["cells"]
    cells = (cb - ca) / ca if ca and cb else None
    if kind == "design" and cells is not None and abs(cells) > CELLS_SAME:
        warnings.append(f"Their meshes differ by {abs(cells) * 100:.1f} % in cells ({ca:,} and {cb:,}): a design "
                        "comparison wants both meshed the same way, with cells within 2 %, or part of the difference "
                        "is the mesh's.")
    if not same_up:
        warnings.append(f"{na}'s vertical force is {A['axes']['vertical']} and {nb}'s is {B['axes']['vertical']}: "
                        "they point opposite ways, so only their drag is compared.")
    half = [d["case"] for d in (A, B) if len(d["symmetry"]) == 1]
    if len(half) == 1:
        warnings.append(f"Only {half[0]} has a symmetry plane: if it is half a model, double its forces before "
                        "comparing them with the other's.")
    drifting = [d["case"] for d in (A, B) if any(w.startswith("Still drifting") for w in d["warnings"])]
    if drifting:
        one = len(drifting) == 1
        warnings.append(f"{' and '.join(drifting)} {'is' if one else 'are'} still drifting over the window (over 1 % "
                        f"between {'its' if one else 'their'} halves): run longer before trusting a small difference.")
    if any(x and x["real"] is None for r in groups for x in (r["drag"], r["vertical"])):
        warnings.append("Too few values in the window (under 25) to say how sure each mean is, so no difference is "
                        "judged: pick a longer window, or let them solve longer.")
    if any(x for _, x in only):
        warnings.append("Not compared, as only one of them has it: "
                        + "; ".join(f"{n}'s {', '.join(x)}" for n, x in only if x) + ".")
    return {"a": _side(A, oa), "b": _side(B, ob), "kind": kind, "window": shared,
            "vertical": A["axes"]["vertical"] if same_up else None, "cells": cells, "groups": groups,
            "warnings": warnings}


def ab_names(abtest, result):
    """What an A/B test's two runs are called, from its ab_result.json (abtest.py's, or None while it has none): its
    original and repaired mesh's, the repaired one with its settings variant if it has one; or, for a test of solver
    settings on one mesh (no fixedName), its settings' and the variant's."""
    variant = result.get("variant") if isinstance(result, dict) else None
    if variant and isinstance(result, dict) and result.get("fixedName") is None:
        return f"{abtest} (its settings)", f"{abtest} ({variant})"
    return f"{abtest} (original mesh)", f"{abtest} (repaired mesh{f', {variant}' if variant else ''})"


def reused_base(test):
    """The A/B test folder (its name in the workspace) whose original-mesh run the test in folder `test` reused
    (--base-from), if any.  Only its folder name is taken from the file, so the answer stays in the workspace."""
    import md_api
    try:
        prev = schema.read(os.path.join(md_api.md_dir(), test, "ab_result.json"), "abtest").get("baseReusedFrom")
    except (OSError, ValueError):
        return None
    prev = os.path.basename(str(prev or "").rstrip("/"))
    return prev if prev.endswith("_ab") and md_api.SAFE.match(prev[:-3]) and prev != test else None


def ab_run(abtest, side):
    """The folder of A/B test `abtest`'s run on `side`, or None while it has none: base, its original mesh's (of a
    test of solver settings on one mesh, its settings'); fixed, its repaired mesh's (or the variant's).  A test made
    with --base-from keeps only the forces of the earlier test's original-mesh run it reused: that run is its base."""
    import md_api

    def is_run(test):
        return os.path.isfile(os.path.join(md_api.md_dir(), test, side, "system", "controlDict"))
    test = abtest + "_ab"
    if side == "base" and not is_run(test):
        test = reused_base(test) or test
    return os.path.join(md_api.md_dir(), test, side) if is_run(test) else None


def ab_forces(abtest, side):
    """GET /abtests/{name}/forces: (the force history of A/B test `abtest`'s run on `side` (base or fixed), as
    results.history gives a case's, named as its comparison names that run, None), or (None, (code, message)) naming
    no folders."""
    import md_api
    if not md_api.SAFE.match(abtest):
        return None, ("bad-request", "bad A/B test name")
    if side not in ("base", "fixed"):
        return None, ("bad-request", "side is base (the original mesh's run) or fixed (the repaired mesh's)")
    case = ab_run(abtest, side)
    if not case:
        return None, ("not-found", f"no {side} run in A/B test {abtest}")
    names = ab_names(abtest, md_api._read_json(os.path.join(md_api.md_dir(), abtest + "_ab", "ab_result.json")))
    try:
        return results.history(case, names[side == "fixed"]), None
    except ValueError as e:
        return None, (e.args[0], e.args[1])


def of(a=None, b=None, abtest=None, t_from=None, t_to=None, mesh=None):
    """GET /compare: (the comparison of cases a and b in the cases folder, a mesh study if `mesh`, or of A/B test
    `abtest`'s two runs, None), or (None, (code, message)) naming no folders."""
    import md_api
    if abtest is not None:
        if a is not None or b is not None:
            return None, ("bad-request", "give a and b (two cases) or abtest (an A/B test's two runs), not both")
        if mesh:
            return None, ("bad-request", "mesh is for two cases, a and b, not an A/B test")
        if not md_api.SAFE.match(abtest):
            return None, ("bad-request", "bad A/B test name")
        cases = [ab_run(abtest, t) for t in ("base", "fixed")]      # a test made with --base-from: the run it reused
        if not all(cases):
            return None, ("not-found", f"no A/B test {abtest} with both its runs")
        names = ab_names(abtest, md_api._read_json(os.path.join(md_api.md_dir(), abtest + "_ab", "ab_result.json")))
    else:
        if a is None or b is None:
            return None, ("bad-request", "give a and b (two cases to compare), or abtest (an A/B test's two runs)")
        if not (md_api.SAFE.match(a) and md_api.SAFE.match(b)):
            return None, ("bad-request", "bad case name")
        if a == b:
            return None, ("bad-request", "pick two different cases to compare")
        cases = [tplan._case(n) for n in (a, b)]
        for n, c in zip((a, b), cases):
            if not c:
                return None, ("not-found", f"no case {n} in the cases folder")
        names = (a, b)
    try:
        return compare(cases[0], cases[1], t_from, t_to, names, abtest is not None, bool(mesh)), None
    except ValueError as e:
        return None, (e.args[0], e.args[1])


def _n(x, digits=4):
    return "-" if x is None else f"{x:.{digits}g}"


def verdict(x):
    """A compared force's verdict in words."""
    words = "too few values to judge" if x["real"] is None else "real" if x["real"] else "inside the noise"
    if x["meshOk"] is not None:
        words += "; moves less than it swings" if x["meshOk"] else "; moves more than it swings: not mesh-independent"
    return words + (" (small)" if x["small"] else "")


def text(doc):
    """The comparison as plain lines, for a terminal."""
    A, B, w = doc["a"], doc["b"], doc["window"]
    lines = [f"{A['case']} (a) against {B['case']} (b): {KINDS[doc['kind']]}"]
    for tag, s in (("a", A), ("b", B)):
        made = f", made from {s['made']['template']} ({s['made']['size']})" if s["made"] else ""
        cells = f"{s['cells']:,}" if s["cells"] else "?"
        lines.append(f"  {tag}: {'transient' if s['transient'] else 'steady'}, {cells} cells{made}; verdict: "
                     f"{s['verdict']}")
    if w:
        unit = "s" if A["transient"] else ""
        span = (f"after {w['from']:g}{unit} up to {w['to']:g}{unit}" if w["from"] is not None
                else f"up to {w['to']:g}{unit}")
        how = "as asked" if w["how"] == "given" else "from the later of their judges' starts"
        lines.append(f"averaged {span} ({how}, up to the shorter run's end)")
    else:
        lines.append("each averaged over its own judge's window")
    lines.append("")
    lines.append(f"{'group':<24} {'force':<10} {'a N':>10} {'b N':>10} {'b - a N':>10} {'%':>7} {'noise N':>9}  "
                 "verdict")
    vert = results.WORDS[doc["vertical"]] if doc["vertical"] else None
    for r in doc["groups"]:
        name = r["name"] if r["name"] == r["nameB"] else f"{r['name']}/{r['nameB']}"
        label = name[:22] + " *" if r["total"] else name[:24]
        for key, word in (("drag", "drag"), ("vertical", vert)):
            x = r[key]
            if not x:
                continue
            pct = "-" if x["pct"] is None else f"{x['pct']:+.1f}"
            lines.append(f"{label:<24} {word:<10} {_n(x['a'], 5):>10} "
                         f"{_n(x['b'], 5):>10} {_n(x['diff'], 3):>10} {pct:>7} {_n(x['noise'], 2):>9}  {verdict(x)}")
    lines.append("(* a's total group; noise: both means' uncertainty and drift)")
    for w_ in doc["warnings"]:
        lines.append("")
        lines.append("warning: " + w_)
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(prog=prog.name() + " compare", description=__doc__.split("\n\n")[0])
    ap.add_argument("cases", nargs="*", metavar="case", help="two cases with a force history: their names in the "
                                                             "cases folder, or their folders (only read)")
    ap.add_argument("--abtest", help="an A/B test's name: its two runs, its original mesh's against its repaired "
                                     "mesh's (or its settings' against the variant's)")
    ap.add_argument("--from", dest="t_from", type=float, help="average both after this iteration or time (default: "
                                                              "the later of their judges' starts)")
    ap.add_argument("--to", dest="t_to", type=float, help="up to this iteration or time (default: the shorter run's "
                                                          "end)")
    ap.add_argument("--mesh", action="store_true", help="compare them as a mesh study: one design at two mesh sizes "
                                                        "(two cases made from one template at two sizes are one by "
                                                        "themselves)")
    ap.add_argument("--json", action="store_true", help="the comparison as JSON")
    a = ap.parse_args(argv)
    if a.abtest is not None:
        if a.cases or a.mesh:
            ap.error("give two cases (with --mesh for a mesh study), or --abtest, not both")
        doc, why = of(abtest=a.abtest, t_from=a.t_from, t_to=a.t_to)
    else:
        if len(a.cases) != 2:
            ap.error("give two cases to compare, or --abtest <name>")
        cases = [c if os.path.isdir(c) else tplan._case(c) for c in a.cases]
        for n, c in zip(a.cases, cases):
            if not c:
                sys.exit(f"compare: no case {n} in the cases folder")
        if os.path.realpath(cases[0]) == os.path.realpath(cases[1]):
            sys.exit("compare: pick two different cases to compare")
        try:
            doc, why = compare(os.path.abspath(cases[0]), os.path.abspath(cases[1]), a.t_from, a.t_to,
                               study=a.mesh), None
        except ValueError as e:
            doc, why = None, (e.args[0], e.args[1])
    if why:
        sys.exit(f"compare: {why[1]}")
    print(json.dumps(doc, indent=1) if a.json else text(doc))


if __name__ == "__main__":
    main(sys.argv[1:])
