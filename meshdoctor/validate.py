# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Verify install: how a run of the Ahmed body template compares with the wind tunnel, and with the accuracy check's
own run of the same mesh (docs/validation.md).  Its drag and lift are taken over the last quarter of its iterations,
as Allvalidate takes them, and the drift is the change between that quarter's two halves.

GET /api/v1/runs/{name}/validation answers it.  The app's Verify install makes the coarse mesh and solves it to
iteration 2000 in one solve job (with the template: solve.py), then shows this beside the accuracy check's chart.  An
install that gives the accuracy check's drag (within MATCH) works as ours does.
"""
import os

import caseinfo
import jobs
import md_api
import solve

TEMPLATE = "ahmed-body"
SLANT = 25                       # degrees: the template's rear slant (its Allmesh's own)
ITERATIONS = 2000                # the accuracy check's runs (Allvalidate 6 2000)
MATCH = 2.0                      # percent: an install whose drag is this close to the accuracy check's gives its answer
TUNNEL = 0.285                   # the wind tunnel's drag coefficient at a 25 degree slant: Ahmed, Ramm & Faltin 1984
# docs/validation.md, "Results": the accuracy check's run of each mesh, Cd and Cl over iterations 1501 to 2000 (the
# engine's tests check these against the doc).
PUBLISHED = {"coarse": {"cd": 0.299, "cl": 0.298}, "medium": {"cd": 0.280, "cl": 0.295},
             "fine": {"cd": 0.280, "cl": 0.292}}


def coefficients(case):
    """[(iteration, Cd, Cl)] from the run's forceCoeffs function object, oldest first.  A continuation writes a file of
    its own (postProcessing/forceCoeffs/<its start>/); where two have the same iteration, the later file's wins."""
    files = caseinfo.force_files(case)
    paths = [p for p in files.get("forceCoeffs", []) if p.endswith("forceCoeffs.dat")]
    rows = {}
    for path in paths:
        try:
            lines = caseinfo.read_text(path).splitlines()
        except OSError:
            continue
        cols = None
        for line in lines:
            if line.startswith("#"):
                head = line[1:].split()
                if head[:1] == ["Time"]:
                    cols = head
                continue
            if not cols or "Cd" not in cols or "Cl" not in cols:
                continue
            t = line.split()
            try:
                rows[int(round(float(t[0])))] = (float(t[cols.index("Cd")]), float(t[cols.index("Cl")]))
            except (ValueError, IndexError):
                pass
    return [(i, *rows[i]) for i in sorted(rows)]


def _mean(xs):
    return sum(xs) / len(xs)


def _percent(a, b):
    return round((a - b) / b * 100, 2) + 0.0     # + 0.0: never -0.0


def of_run(name):
    """(the comparison, None), or (None, (code, message)) naming no folders."""
    if not md_api.SAFE.match(name):
        return None, ("bad-request", "bad run name")
    run = solve.describe(name)
    if run is None:
        return None, ("not-found", f"no run {name}")
    made = md_api._read_json(os.path.join(solve.case_dir(name), jobs.CASE_MARKER))
    size = made.get("size") if isinstance(made, dict) and made.get("template") == TEMPLATE else None
    if size not in PUBLISHED:
        return None, ("unsupported", f"{name} isn't made from the Ahmed body template: the accuracy check has only "
                                     "that template's runs to compare with")
    rows = coefficients(solve.case_dir(name))
    if len(rows) < 8:
        return None, ("not-ready", f"{name} has no drag to compare yet: its solve writes it as it goes")
    w = len(rows) // 4                                  # Allvalidate's window: the last quarter of the iterations
    window = rows[-w:]
    half = w // 2
    cd, cl = _mean([r[1] for r in window]), _mean([r[2] for r in window])
    early, late = _mean([r[1] for r in window[:w - half]]), _mean([r[1] for r in window[w - half:]])
    ours = PUBLISHED[size]
    iterations = rows[-1][0]
    comparable = iterations >= ITERATIONS
    vs_ours = _percent(cd, ours["cd"])
    cells = made.get("cells")
    return {"name": name, "state": run["state"], "template": TEMPLATE, "size": size, "slant": SLANT,
            "cells": cells if isinstance(cells, int) and not isinstance(cells, bool) else None,
            "iterations": iterations, "window": w, "cd": round(cd, 4), "cl": round(cl, 4),
            "drift": _percent(late, early) if early else 0.0,
            "tunnel": {"cd": TUNNEL, "difference": _percent(cd, TUNNEL)},
            "published": {"cd": ours["cd"], "cl": ours["cl"], "iterations": ITERATIONS, "difference": vs_ours},
            "comparable": comparable, "matches": comparable and abs(vs_ours) <= MATCH}, None
