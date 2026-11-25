# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""A solved case's results: each force group's drag and vertical force over an averaging window, how sure they are,
its coefficients, how far its residuals fell, and plain warnings.

    python3 -m meshdoctor results <case> [--from T] [--to T] [--json]

<case> is a case in the cases folder with a force history (a run Mesh Doctor solved, or a case you solved yourself),
or its folder; it is only read.  The averaging window is the judge's by default (abtest.judge): a steady run's last
two judge windows (each half the run's iterations, 10 to 200), a transient run's from when its forces settled, else
its last two windows of time steps.  --from and --to set it (iterations, or seconds of flow); --to alone takes the run
as it was then, as the judge's --to does.

For each force group (caseinfo: every forces or forceCoeffs function object's postProcessing folder), its drag and its
vertical force (downforce or lift, as caseinfo.describe reads the case) over the window: the mean, the standard
deviation, the drift (the change between the window's two halves, over the mean) and the uncertainty of the mean
(abtest.batch_means: the larger of the 95 % interval of 5 batch means and half their spread), in N.  CdA and ClA are
those forces over q = 1/2 rho U^2 (m^2: rho the case's rhoInf, U its freestream speed), and L/D the vertical force over
the drag.  Cd and Cl are given only for a group whose patches a forceCoeffs function object covers with its own Aref,
with its own magUInf and rhoInf, as OpenFOAM's forceCoeffs takes them; like ClA, Cl is in the vertical force's own
direction (positive downforce, for a car with downforce).  Each residual's first level (the largest of its first
values), its final level (the median of its last values up to the window's end) and how many orders it fell; and the
judge's verdict on the run.  Plain warnings: a drift over DRIFT_WARN says to run longer before comparing; a single
symmetry plane in the mesh's boundary says the forces may be for half a model.  GET /api/v1/results answers the same.
"""
import argparse, json, math, os, re, statistics, sys

import abtest
import caseinfo
import pictures
import prog
import ramguard
import schema
import tplan
import transient

DRIFT_WARN = 0.01    # a drift over 1 %: run longer before comparing (the cfd-results skill's rule)
SMALL = 0.01         # a force under 1 % of the total group's drag is too small for its drift to be judged
FIRST = 10           # a residual's first level: the largest of its first FIRST values
LAST = 20            # its final level: the median of its last LAST values up to the window's end
SYMMETRY = ("symmetryPlane", "symmetry")
WORDS = {"drag": "drag", "downforce": "downforce", "lift": "lift"}
NAMED = re.compile(r"(?<![\w.:#$-])([A-Za-z_][\w.:-]*)\s*\{")    # a dictionary's name and its opening brace


def _own(body):
    """A dictionary's own entries: the text of `name { ... }` at its first level, its sub-dictionaries left out."""
    out, depth = [], 0
    for ch in body:
        if ch in "{}":
            depth += 1 if ch == "{" else -1
        elif depth == 1:
            out.append(ch)
    return "".join(out)


def _dicts(text):
    """(name, its own entries' text) of each dictionary `name { ... }` in `text`, at any depth, wherever its name
    stands on its line (a generated case may write one after other entries), its braces matched."""
    for m in NAMED.finditer(text):
        depth, i = 0, m.end() - 1
        while i < len(text):
            depth += {"{": 1, "}": -1}.get(text[i], 0)
            if depth == 0:
                yield m.group(1), _own(text[m.end() - 1:i + 1])
                break
            i += 1


def function_objects(case):
    """{name: {"type", "patches", "Aref", "magUInf", "rhoInf"}} of the forces and forceCoeffs function objects in
    system/controlDict and system/functions, comments left out (a number None where the object doesn't give it; the
    first of a name counts)."""
    out = {}
    for f in ("controlDict", "functions"):
        for name, body in _dicts(transient.blank(transient.read(os.path.join(case, "system", f)))):
            kind = re.search(r"\btype\s+(forces|forceCoeffs)\s*;", body)
            if name in out or not kind:
                continue
            pats = re.search(r"\bpatches\s*\(([^)]*)\)", body)

            def number(key):
                v = re.search(r"\b" + key + r"\s+(" + caseinfo.NUM + r")\s*;", body)
                return float(v.group(1)) if v else None
            out[name] = {"type": kind.group(1), "patches": [w.strip('"') for w in pats.group(1).split()] if pats else None,
                         "Aref": number("Aref"), "magUInf": number("magUInf"), "rhoInf": number("rhoInf")}
    return out


def _coeff_header(path):
    """{"Aref", "magUInf"} from the header of a forceCoeffs.dat, as OpenFOAM writes them."""
    head = {}
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if not line.startswith("#"):
                    break
                m = re.match(r"#\s*(Aref|magUInf)\s*:\s*(" + caseinfo.NUM + r")\s*$", line)
                if m:
                    head[m.group(1)] = float(m.group(2))
    except OSError:
        pass
    return head


def reference(case, group, objects, rho):
    """(Aref, q) of the forceCoeffs function object that covers group `group`'s patches (the group's own, or one with
    the same patches), q = 1/2 rhoInf magUInf^2 with its own settings (rho, the case's, where it gives none); (None,
    None) when none does."""
    own = objects.get(group) or {}
    found = [own] if own.get("type") == "forceCoeffs" else []
    if own.get("patches"):
        found += [o for o in objects.values() if o["type"] == "forceCoeffs" and o is not own
                  and sorted(o["patches"] or []) == sorted(own["patches"])]
    for o in found:
        a, u, r = o["Aref"], o["magUInf"], o["rhoInf"] or rho
        if a and u and r:
            return a, 0.5 * r * u * u
    files = caseinfo.force_files(case).get(group) or []
    if files and files[-1].endswith("forceCoeffs.dat") and rho:     # a forceCoeffs group set up outside system/
        head = _coeff_header(files[-1])
        if head.get("Aref") and head.get("magUInf"):
            return head["Aref"], 0.5 * rho * head["magUInf"] ** 2
    return None, None


def symmetry_planes(case):
    """The symmetry patches of the case's mesh (its whole mesh's boundary, else processor0's)."""
    procs = pictures.processors(case)
    b = pictures.boundary(case) or (pictures.boundary(case, procs[0]) if procs else {})
    return [p for p, (kind, _) in b.items() if kind in SYMMETRY]


def quantity(values):
    """The mean, standard deviation, drift and uncertainty of the mean (None with fewer than 25 values) of a force
    over the window, in N; None with fewer than 2 values.  Values that aren't finite (a diverged run's) are left out."""
    values = [v for v in values if math.isfinite(v)]
    if len(values) < 2:
        return None
    mean = statistics.fmean(values)
    half = len(values) // 2
    a, b = statistics.fmean(values[:half]), statistics.fmean(values[half:])
    bm = abtest.batch_means(values)
    return {"mean": mean, "sd": statistics.pstdev(values),
            "drift": abs(b - a) / abs(mean) if mean else (0.0 if a == b else None),
            "u": bm["u"] if bm else None, "n": len(values)}


def _upto(table, to):
    return abtest.upto(table, to) if to is not None else table


def window(res, frc, d, total, unsteady, t_from=None, t_to=None):
    """(from, to, how) of the averaging window: the forces after `from` up to and with `to`.  How: "given" (--from),
    "settled" (a transient run's forces, from when they settled), or "judge" (the judge's: a steady run's last two
    windows of iterations, a transient run's last two windows of time steps)."""
    s = caseinfo.series(frc, d, total, "drag")
    end = s[-1][0] if s else None
    to = end if t_to is None or end is None else min(t_to, end)
    if t_from is not None:
        return t_from, to, "given"
    if not s:
        return None, to, "judge"
    w = abtest.auto_window(len(res.get("Time") or []) or len(s))
    if unsteady:
        settled = abtest.settled_at(frc, d, total)
        if settled is not None:
            return settled, to, "settled"
        return s[max(0, len(s) - 2 * w - 1)][0], to, "judge"
    return to - 2 * w, to, "judge"


def residual_levels(res):
    """{field: {"first", "final", "orders"}}: the largest of its first FIRST values, the median of its last LAST
    values, and how many orders of ten it fell between them (None where it can't say)."""
    out = {}
    for k, v in res.items():
        if k == "Time":
            continue
        x = [r for r in v if r is not None]
        if not x:
            continue
        first, final = max(x[:FIRST]), statistics.median(x[-LAST:])
        orders = math.log10(first / final) if first > 0 and final > 0 else None
        out[k] = {"first": first, "final": final, "orders": round(orders, 2) + 0.0 if orders is not None else None}
    return out


def of_case(case, t_from=None, t_to=None, name=None):
    """The results document of case folder `case` (results schema), or raises ValueError(code, message), the message
    naming no folders."""
    name = name or os.path.basename(os.path.normpath(case))
    if t_from is not None and t_to is not None and t_from >= t_to:
        raise ValueError("bad-request", f"the window's from ({t_from:g}) must come before its to ({t_to:g})")
    frc = caseinfo.parse_forces(case)
    if not frc:
        raise ValueError("not-ready", f"{name} has no force history yet: its forces or forceCoeffs function objects "
                                      "write one, in postProcessing, as it solves")
    res = abtest.parse_residuals(case)
    res, frc_to = _upto(res, t_to), {g: _upto(F, t_to) for g, F in frc.items()}
    frc_to = {g: F for g, F in frc_to.items() if F.get("Time")}
    if not frc_to:
        raise ValueError("not-ready", f"{name}'s force history starts after {t_to:g}")
    unsteady = caseinfo.transient(case)
    d = caseinfo.describe(case, frc_to)
    total = d["total"]
    t0, t1, how = window(res, frc_to, d, total, unsteady, t_from, t_to)
    if t0 is not None and t1 is not None and t0 >= t1:
        raise ValueError("not-ready", f"{name}'s forces end at {t1:g}, before the window's from ({t0:g}): pick an "
                                      "earlier from, or let it solve longer")
    rho, uinf = d["rho"], d["Uinf"]
    q = 0.5 * rho * uinf * uinf if rho and uinf else None
    objects = function_objects(case)
    vert = d["vertical"]
    groups, drift = [], []
    ref = None
    for g in d["groups"]:
        got = {}
        for what in ("drag", "vertical"):
            got[what] = quantity([v for t, v in caseinfo.series(frc_to, d, g, what) if t0 < t <= t1])
        if got["drag"] is None:
            continue
        if g == total:
            ref = abs(got["drag"]["mean"])
        area, qc = reference(case, g, objects, rho)
        dm = got["drag"]["mean"]
        vm = got["vertical"]["mean"] if got["vertical"] else None
        groups.append({
            "name": g, "total": g == total, "patches": (objects.get(g) or {}).get("patches"),
            "drag": got["drag"], "vertical": got["vertical"],
            "CdA": dm / q if q else None, "ClA": vm / q if q and vm is not None else None,
            "LD": vm / dm if vm is not None and dm else None,
            "Aref": area, "Cd": dm / (qc * area) if area else None,
            "Cl": vm / (qc * area) if area and vm is not None else None})
    if not groups:
        raise ValueError("not-ready", f"{name} has no forces to average between {t0:g} and {t1:g}: pick a wider "
                                      "window, or let it solve longer")
    groups.sort(key=lambda r: (not r["total"], -abs(r["drag"]["mean"])))
    for r in groups:
        for what, word in (("drag", "drag"), ("vertical", WORDS[vert])):
            v = r[what]
            if v and v["drift"] is not None and v["drift"] > DRIFT_WARN and abs(v["mean"]) >= SMALL * (ref or 0):
                drift.append(f"{r['name']} {word} {v['drift'] * 100:.1f} %")
    warnings = []
    if drift:
        warnings.append("Still drifting over the window (over 1 % between its two halves): " + ", ".join(drift)
                        + ". Run longer before comparing these with another run.")
    sym = symmetry_planes(case)
    if len(sym) == 1:
        warnings.append(f"Its mesh has a symmetry plane ({sym[0]}): if it is half a model, its forces, CdA and ClA "
                        "are for the half, so double them for the whole; Cd and Cl are as its forceCoeffs takes them.")
    if q is None:
        warnings.append("No CdA or ClA: " + ("its freestream speed isn't found in its 0/U" if not uinf
                                             else "its rhoInf isn't found in its system folder") + ".")
    judged = abtest.judge(case, None, to=t_to)
    times = frc_to[total]["Time"]
    doc = {"case": name, "transient": unsteady,
           "axes": {"flow": ("-" if d["flowSign"] < 0 else "+") + "xyz"[d["flowAxis"]], "up": "xyz"[d["upAxis"]],
                    "vertical": vert, "source": d["source"]},
           "Uinf": uinf, "rho": rho, "q": q, "cells": ramguard.mesh_cells(case),
           "start": times[0], "end": times[-1],
           "window": {"from": t0, "to": t1, "how": how, "n": groups[0]["drag"]["n"]},
           "groups": groups, "residuals": residual_levels(abtest.upto(res, t1) if res.get("Time") else res),
           "verdict": judged.get("verdict"), "symmetry": sym, "warnings": warnings}
    return schema.stamp(doc, "results")


def of(name, t_from=None, t_to=None):
    """GET /results?case=: (the results document of case `name` in the cases folder, None), or (None, (code,
    message)) naming no folders."""
    import md_api
    if not md_api.SAFE.match(name):
        return None, ("bad-request", "bad case name")
    case = tplan._case(name)
    if not case:
        return None, ("not-found", f"no case {name} in the cases folder")
    try:
        return of_case(case, t_from, t_to, name), None
    except ValueError as e:
        return None, (e.args[0], e.args[1])


def _n(x, digits=3):
    return "-" if x is None else f"{x:.{digits}g}"


def text(doc):
    """The results document as plain lines, for a terminal."""
    w = doc["window"]
    unit = "s" if doc["transient"] else ""
    span = (f"from {w['from']:g}{unit} to {w['to']:g}{unit}" if w["from"] is not None else f"to {w['to']:g}{unit}")
    how = {"given": "as asked", "settled": "from when its forces settled", "judge": "the judge's window"}[w["how"]]
    vert = WORDS[doc["axes"]["vertical"]]
    cells = f"{doc['cells']:,}" if doc["cells"] else "?"
    lines = [f"{doc['case']}: {'transient' if doc['transient'] else 'steady'}, {cells} cells, forces "
             f"{doc['start']:g}{unit} to {doc['end']:g}{unit}; averaged {span} ({how}, {w['n']} values)",
             f"verdict: {doc['verdict']}",
             f"q = {_n(doc['q'], 4)} Pa (rho {_n(doc['rho'], 4)} kg/m3, U {_n(doc['Uinf'], 4)} m/s)", ""]
    head = f"{'group':<24} {'drag N':>10} {'sd':>8} {'drift':>7} {'+/-':>8} {vert + ' N':>12} {'drift':>7} {'+/-':>8}" \
           f" {'CdA':>7} {'ClA':>7} {'L/D':>6} {'Cd':>6} {'Cl':>6}"
    lines.append(head)
    for r in doc["groups"]:
        dr, vt = r["drag"], r["vertical"] or {}
        pct = lambda v: "-" if v.get("drift") is None else f"{v['drift'] * 100:.1f}%"     # noqa: E731
        lines.append(f"{(r['name'] + (' *' if r['total'] else ''))[:24]:<24} {_n(dr['mean'], 5):>10} "
                     f"{_n(dr['sd'], 3):>8} {pct(dr):>7} {_n(dr['u'], 2):>8} {_n(vt.get('mean'), 5):>12} "
                     f"{pct(vt):>7} {_n(vt.get('u'), 2):>8} {_n(r['CdA'], 3):>7} {_n(r['ClA'], 3):>7} "
                     f"{_n(r['LD'], 3):>6} {_n(r['Cd'], 3):>6} {_n(r['Cl'], 3):>6}")
    lines.append("(* the total group: the one with the most drag)")
    if doc["residuals"]:
        lines.append("")
        lines.append("residuals: " + ", ".join(
            f"{k} {_n(v['first'], 2)} to {_n(v['final'], 2)}"
            + (f" ({v['orders']:.1f} orders)" if v["orders"] is not None else "") for k, v in doc["residuals"].items()))
    for w_ in doc["warnings"]:
        lines.append("")
        lines.append("warning: " + w_)
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(prog=prog.name() + " results", description=__doc__.split("\n\n")[0])
    ap.add_argument("case", help="a case with a force history: its name in the cases folder, or its folder (only "
                                 "read)")
    ap.add_argument("--from", dest="t_from", type=float, help="average from this iteration or time on (default: the "
                                                              "judge's window)")
    ap.add_argument("--to", dest="t_to", type=float, help="up to this iteration or time: the run as it was then "
                                                          "(default: its end)")
    ap.add_argument("--json", action="store_true", help="the results document (results schema) as JSON")
    a = ap.parse_args(argv)
    case = a.case if os.path.isdir(a.case) else tplan._case(a.case)
    if not case:
        sys.exit(f"results: no case {a.case} in the cases folder")
    try:
        doc = of_case(os.path.abspath(case), a.t_from, a.t_to)
    except ValueError as e:
        sys.exit(f"results: {e.args[1]}")
    print(json.dumps(doc, indent=1) if a.json else text(doc))


if __name__ == "__main__":
    main(sys.argv[1:])
