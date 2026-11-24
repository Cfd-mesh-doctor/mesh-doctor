# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""A transient run of a solved steady run: a new case with the steady run's mesh and settings, its latest result as
the start, and settings for a transient solve.  solve.py makes it and solves it:

    python3 -m meshdoctor solve <name> --steady <run> [--co C] [--model DDES|URANS] [--to SECONDS] [--np P]

DDES (the default) resolves the wake's eddies and keeps the boundary layers RANS: kOmegaSSTDES with F2 shielding,
second-order time steps (backward) and a less dissipative scheme for U (LUST), at a largest Courant number of about 1.
URANS keeps the steady run's own RAS model, in time, and can run at a larger Courant number.  Both solve with PIMPLE,
3 outer correctors a time step (as the transient plan's hours assume), and a time step that OpenFOAM adjusts to the
Courant number asked for.  The new case's times are seconds of flow from 0; by default it runs 8 flow times over the
body (8 L/U, from its force coefficients' lRef and its freestream speed, as the transient plan takes them).  The
steady run is only read, and its latest result must be joined (solve.py joins it when a stretch ends).
"""
import math, os, re, shutil

import caseinfo
import templates
import tplan

MODELS = ("DDES", "URANS")
MAX_CO = 20.0                    # PIMPLE with 3 outer correctors; past this the time step outruns them
MAX_DDES_CO = 2.0                # DDES resolves eddies: about 1, as the transient plan says
OUTER = tplan.OUTER
LES = """LES
{
    model           kOmegaSSTDES;
    turbulence      on;
    printCoeffs     on;
    kOmegaSSTDESCoeffs { FSST 2; }      // F2 shielding: the boundary layers stay RANS (delayed DES)
    delta           maxDeltaxyz;
    maxDeltaxyzCoeffs { deltaCoeff 1; }
}"""


def read(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def plain(text):
    """An OpenFOAM dictionary's text without its comments."""
    return re.sub(r"/\*.*?\*/|//[^\n]*", "", text, flags=re.S)


def block(text, name):
    """(start, end) of the dictionary `name { ... }` that starts a line of `text`, braces matched and comments left
    out (blanked, so the places are the text's own); None when it has none."""
    text = re.sub(r"/\*.*?\*/|//[^\n]*", lambda m: re.sub(r"[^\n]", " ", m.group(0)), text, flags=re.S)
    m = re.search(r"^[ \t]*" + re.escape(name) + r"\s*\{", text, re.M)
    if not m:
        return None
    depth, i = 0, m.end() - 1
    while i < len(text):
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        if depth == 0:
            return m.start(), i + 1
        i += 1
    return None


def _need(span, what):
    """A block() that must be there: unsupported() checks first, so this is a file changed in between."""
    if span is None:
        raise ValueError(f"its {what} couldn't be read")
    return span


def times(folder):
    """The written times in a folder, as {name: value}."""
    out = {}
    try:
        names = os.listdir(folder)
    except OSError:
        return out
    for n in names:
        try:
            v = float(n)
        except ValueError:
            continue
        if v > 0 and os.path.isdir(os.path.join(folder, n)):
            out[n] = v
    return out


def result(case):
    """The steady run's latest result in its own folder, joined: (time name, folder), or None when it has none or the
    processors hold a later one (it ended without reconstructPar)."""
    own = times(case)
    if not own:
        return None
    name = max(own, key=own.get)
    split = times(os.path.join(case, "processor0"))
    if split and max(split.values()) > own[name]:
        return None
    return name, os.path.join(case, name)


def flow_time(case):
    """8 flow times over the body (8 L/U) in s, from its force coefficients' lRef and its freestream speed (0/U), to 4
    digits; None when the case doesn't say them."""
    u, length = caseinfo.freestream(case), tplan.ref_length(case)
    speed = math.sqrt(sum(x * x for x in u)) if u else 0.0
    if not length or speed <= 0:
        return None
    return float(f"{tplan.FLOW_THROUGHS * length / speed:.4g}")


def unsupported(case, model):
    """Why the steady case's settings can't be made transient for `model`, naming no folders, or None."""
    schemes = plain(read(os.path.join(case, "system", "fvSchemes")))
    if not re.search(r"\bddtSchemes\s*\{[^}]*\bdefault\s+steadyState\s*;", schemes):
        return "its fvSchemes has no steadyState time scheme to make transient"
    if not block(plain(read(os.path.join(case, "system", "fvSolution"))), "SIMPLE"):
        return "its fvSolution has no SIMPLE dictionary to make a PIMPLE one of"
    if model == "DDES":
        mt = plain(read(os.path.join(case, "constant", "momentumTransport")))
        ras = block(mt, "RAS")
        if not re.search(r"^\s*simulationType\s+RAS\s*;", mt, re.M) or not ras:
            return "DDES here starts from a RAS run, and its momentumTransport isn't one"
        if not re.search(r"\bmodel\s+kOmegaSST\s*;", mt[ras[0]:ras[1]]):
            return "DDES here starts from a kOmegaSST run: solve a transient run of it as URANS"
    return None


def make(steady, case, co, model, to):
    """Make the new folder `case` a transient run of the steady run in folder `steady`: its mesh and settings
    (templates.copy), its latest result as the start (0), and transient settings (settings()).  The new case's cell
    count."""
    cells = templates.copy(steady, case)
    _, src = result(steady)
    zero = os.path.join(case, "0")
    fields = {n for n in os.listdir(zero) if os.path.isfile(os.path.join(zero, n))}
    for n in os.listdir(src):                    # the solved fields, and the flux: not what function objects wrote
        if n in fields or n == "phi":
            shutil.copyfile(os.path.join(src, n), os.path.join(zero, n))
    settings(case, co, model, to, start_dt(os.path.basename(steady), result(steady)[0], co, to))
    return cells


def start_dt(steady, at, co, to):
    """The first time step: the transient plan's at this Courant number when one was made of the same result, else a
    small one (OpenFOAM cuts the first step to the Courant number, then grows it at most 20 % a step)."""
    doc, _ = tplan.of(steady)
    rate = (doc or {}).get("courantPerSecond", {}).get("max")
    if doc and doc.get("time") == at and rate:
        return float(f"{co / rate:.4g}")
    return float(f"{to / 20000:.4g}")


def _entry(text, entry, value):
    """Set `entry value;` at the top level of a dictionary's text, added at the end when it isn't there."""
    pattern = re.compile(r"^(" + re.escape(entry) + r"\s+)[^;\n]*(;)", re.M)
    text, n = pattern.subn(lambda m: m.group(1) + str(value) + m.group(2), text, count=1)
    return text if n else text.rstrip("\n") + f"\n{entry:<15} {value};\n"


def _edit(case, rel, change):
    path = os.path.join(case, rel)
    text = change(read(path))
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def settings(case, co, model, to, dt):
    """Turn the copied steady settings transient (unsupported() says which it can)."""
    def control(t):
        for entry, value in (("startFrom", "startTime"), ("startTime", 0), ("beginTime", 0), ("endTime", to),
                             ("deltaT", dt), ("adjustTimeStep", "yes"), ("maxCo", co),
                             ("writeControl", "adjustableRunTime"), ("writeInterval", f"{to / 4:.6g}")):
            t = _entry(t, entry, value)
        return t

    def schemes(t):
        t = re.sub(r"(\bddtSchemes\s*\{[^}]*?\bdefault\s+)steadyState", r"\1backward", t, count=1)
        t = re.sub(r"\bbounded\s+(?=Gauss\b)", "", t)          # the steady-state form of a convection scheme
        if model == "DDES":
            t = re.sub(r"^([ \t]*div\(phi,U\)\s+)[^;\n]*;", r"\1Gauss LUST grad(U);", t, flags=re.M)
        return t

    def solution(t):
        s = block(t, "solvers")
        if s and not re.search(r"\bpFinal\b", t[s[0]:s[1]]):
            final = ("    pFinal          { $p; relTol 0; }\n"
                     "    \"(U|k|omega|epsilon|nuTilda)Final\" { $U; relTol 0; }\n")
            t = t[:s[1] - 1] + final + t[s[1] - 1:]
        s = _need(block(t, "SIMPLE"), "fvSolution's SIMPLE dictionary")
        m = re.search(r"\bnNonOrthogonalCorrectors\s+(\d+)\s*;", t[s[0]:s[1]])
        pimple = ("PIMPLE\n{\n"
                  f"    nOuterCorrectors {OUTER};\n    nCorrectors      2;\n"
                  f"    nNonOrthogonalCorrectors {m.group(1) if m else 0};\n}}")
        t = t[:s[0]] + pimple + t[s[1]:]
        relax = ('relaxationFactors\n{\n    equations { ".*" 1; }\n}' if co <= 1 else
                 'relaxationFactors\n{\n    fields { p 0.3; pFinal 1; }\n'
                 '    equations { "(U|k|omega|epsilon|nuTilda)" 0.7; ".*Final" 1; }\n}')
        r = block(t, "relaxationFactors")
        return t[:r[0]] + relax + t[r[1]:] if r else t.rstrip("\n") + "\n" + relax + "\n"

    def transport(t):
        t = re.sub(r"^(\s*simulationType\s+)RAS(\s*;)", r"\1LES\2", t, count=1, flags=re.M)
        r = _need(block(t, "RAS"), "momentumTransport's RAS dictionary")
        return t[:r[0]] + LES + t[r[1]:]

    _edit(case, os.path.join("system", "controlDict"), control)
    _edit(case, os.path.join("system", "fvSchemes"), schemes)
    _edit(case, os.path.join("system", "fvSolution"), solution)
    if model == "DDES":
        _edit(case, os.path.join("constant", "momentumTransport"), transport)
