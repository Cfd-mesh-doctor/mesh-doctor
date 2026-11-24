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
steady run is only read, and its latest result must be joined (solve.py joins it when a stretch ends).  Each stretch
writes WRITES times (4) evenly to its end, or as many as the run asks for (--writes, at most MAX_WRITES), and a
transient run keeps every time it writes (purgeWrite 0), for pictures of the flow over time: on several processes the
latest of each stretch is joined, and the others stay split on its processes.

Its function objects go in system/functions, which OpenFOAM 14 reads again when the file changes as the run solves (a
controlDict's own `functions` it reads only at the start), with one more that is off at first: a fieldAverage
(meanFlow) of U and p.  solve.py switches it on once the run's forces have settled, as the transient judge finds
that (abtest.settled_at), so each time written from then on holds the mean flow and how much it swings: UMean, pMean,
UPrime2Mean and pPrime2Mean, which a continuation averages on.  averaging() says from when.
"""
import gzip, math, os, re, shutil, statistics, textwrap, time, zlib

import abtest
import caseinfo
import templates
import tplan

MODELS = ("DDES", "URANS")
MAX_CO = 20.0                    # PIMPLE with 3 outer correctors; past this the time step outruns them
MAX_DDES_CO = 2.0                # DDES resolves eddies: about 1, as the transient plan says
WRITES = 4                       # the times a stretch of a transient run writes, unless it asks for more or fewer
MAX_WRITES = 200                 # the most a stretch may write: a transient run keeps every one (purgeWrite 0)
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
AVERAGE = "meanFlow"             # the fieldAverage that averages a transient run's flow, in system/functions
AVERAGE_ENTRY = AVERAGE + """    // the mean flow and how much it swings: UMean, pMean, UPrime2Mean, pPrime2Mean
{                   // off until the forces settle, when Mesh Doctor switches it on as the run solves
    type            fieldAverage;
    libs            ("libfieldFunctionObjects.so");
    writeControl    writeTime;
    enabled         false;
    mean            yes;
    prime2Mean      yes;
    fields          (U p);
}"""
FUNCTIONS = ('FoamFile\n{\n    format      ascii;\n    class       dictionary;\n    location    "system";\n'
             '    object      functions;\n}\n')
MOVED = "// functions: in system/functions, which OpenFOAM reads again when it changes as the run solves (Mesh Doctor)"
OFF = r"(?m)^([ \t]*enabled[ \t]+)(?:false|no|off)([ \t]*;)"


def read(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def plain(text):
    """An OpenFOAM dictionary's text without its comments."""
    return re.sub(r"/\*.*?\*/|//[^\n]*", "", text, flags=re.S)


def blank(text):
    """An OpenFOAM dictionary's text with its comments blanked: the same places, so what is found in it is found in
    the text too."""
    return re.sub(r"/\*.*?\*/|//[^\n]*", lambda m: re.sub(r"[^\n]", " ", m.group(0)), text, flags=re.S)


def block(text, name):
    """(start, end) of the dictionary `name { ... }` that starts a line of `text`, braces matched and comments left
    out (blanked, so the places are the text's own); None when it has none."""
    text = blank(text)
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


def make(steady, case, co, model, to, writes=WRITES):
    """Make the new folder `case` a transient run of the steady run in folder `steady`: its mesh and settings
    (templates.copy), its latest result as the start (0), and transient settings (settings()), writing `writes` times
    to `to`.  The new case's cell count."""
    cells = templates.copy(steady, case)
    _, src = result(steady)
    zero = os.path.join(case, "0")
    fields = {n for n in os.listdir(zero) if os.path.isfile(os.path.join(zero, n))}
    for n in os.listdir(src):                    # the solved fields, and the flux: not what function objects wrote
        if n in fields or n == "phi":
            shutil.copyfile(os.path.join(src, n), os.path.join(zero, n))
    settings(case, co, model, to, start_dt(os.path.basename(steady), result(steady)[0], co, to), writes)
    return cells


def make_size(steady, case=None):
    """The bytes make() writes for a transient run of the steady run in folder `steady` (into the new folder
    `case`): its copy (templates.copy_size), with its latest result's fields and flux in place of the initial fields
    they replace; None when it has no joined result to start from."""
    res = result(steady)
    if res is None:
        return None
    total, src = templates.copy_size(steady, case), res[1]
    zero = next((z for z in (os.path.join(steady, "0"), os.path.join(steady, "0.orig")) if os.path.isdir(z)), None)
    fields = {n for n in os.listdir(zero) if os.path.isfile(os.path.join(zero, n))} if zero else set()
    for n in os.listdir(src):
        if (n in fields or n == "phi") and os.path.isfile(os.path.join(src, n)):
            total += os.path.getsize(os.path.join(src, n)) - (os.path.getsize(os.path.join(zero, n)) if n in fields
                                                              else 0)
    return total


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


def settings(case, co, model, to, dt, writes=WRITES):
    """Turn the copied steady settings transient (unsupported() says which it can): `writes` times written to `to`,
    and every one kept."""
    def control(t):
        for entry, value in (("startFrom", "startTime"), ("startTime", 0), ("beginTime", 0), ("endTime", to),
                             ("deltaT", dt), ("adjustTimeStep", "yes"), ("maxCo", co),
                             ("writeControl", "adjustableRunTime"), ("writeInterval", f"{to / writes:.6g}"),
                             ("purgeWrite", 0)):
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
    functions(case)


def _write(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def _fieldAverage(text):
    return re.search(r"\btype\s+fieldAverage\s*;", plain(text)) is not None


def functions(case):
    """Put the new run's function objects in system/functions with its averaging (AVERAGE_ENTRY, off at first):
    OpenFOAM 14 reads that file again when it changes as the run solves, so switch_on() can start the averaging then;
    a controlDict's own `functions` it reads only at the start, and not at all once system/functions is there.  The
    controlDict's top-level entries that the functions name ($forceDefaults) go with them, removed once read
    (#remove).  No averaging is added to a case with a fieldAverage of its own (both would write UMean), nor to one
    whose functions name an entry some other way ($:name, $../name), which the move could break: False then."""
    own = os.path.join(case, "system", "functions")
    if os.path.isfile(own):                     # the steady run's own: OpenFOAM leaves the controlDict's out then
        text = read(own)
        if _fieldAverage(text) or block(text, AVERAGE):
            return False
        _write(own, text.rstrip("\n") + "\n\n" + AVERAGE_ENTRY + "\n")
        return True
    path = os.path.join(case, "system", "controlDict")
    text = read(path)
    span = block(text, "functions")
    inner = text[blank(text).index("{", span[0]) + 1:span[1] - 1] if span else ""
    bare = plain(inner)
    if _fieldAverage(inner) or re.search(r"\$(?![\w{])", bare):
        return False
    rest = text[:span[0]] + text[span[1]:] if span else text
    carried, names = [], []
    for name in dict.fromkeys(re.findall(r"\$\{?(\w+)", bare)):
        got = block(rest, name)
        if got is None:
            m = re.search(r"(?m)^[ \t]*" + re.escape(name) + r"[ \t]+[^;{}\n]*;", blank(rest))
            if m is None:
                continue                        # not the controlDict's: an environment variable, say
            got = m.span()
        carried.append(rest[got[0]:got[1]].strip())
        names.append(name)
    parts = [FUNCTIONS, "\n// The run's function objects, from its controlDict, and its averaging (Mesh Doctor)\n"]
    parts += ["\n" + c + "\n" for c in carried]
    body = textwrap.dedent(inner).strip()
    if body:
        parts.append("\n" + body + "\n")
    parts.append("\n" + AVERAGE_ENTRY + "\n")
    parts += ["\n" + "".join(f"#remove {n}\n" for n in names)] if names else []
    _write(own, "".join(parts))
    if span:
        _write(path, text[:span[0]] + MOVED + text[span[1]:])
    return True


def average_state(case):
    """The run's averaging (AVERAGE in system/functions): "off" until switch_on(), "on", or None when it has none."""
    text = blank(read(os.path.join(case, "system", "functions")))
    span = block(text, AVERAGE)
    if span is None:
        return None
    return "off" if re.search(OFF, text[span[0]:span[1]]) else "on"


def switch_on(case, skew):
    """Switch the run's averaging on (enabled true in system/functions), then move the file's time on past OpenFOAM's
    fileModificationSkew (by `skew` s, as Stop does controlDict's), so the solver reads it again at its next time step
    and averages from there.  True once it is on; False when the run has no averaging to switch on."""
    path = os.path.join(case, "system", "functions")
    text = read(path)
    span = block(text, AVERAGE)
    if span is None:
        return False
    m = re.search(OFF, blank(text)[span[0]:span[1]])
    if m is None:
        return True                             # on already
    try:
        old = os.stat(path).st_mtime
    except OSError:
        return False
    _write(path, text[:span[0] + m.start()] + m.group(1) + "true" + m.group(2) + text[span[0] + m.end():])
    t = max(time.time(), old + skew)
    os.utime(path, (t, t))
    return True


def forces_settled(case):
    """When the run's forces settled, in s, as the transient judge finds it (abtest.settled_at: its total force
    group's drag and vertical force, by MSER-5); None while they haven't, or when it has no forces to read."""
    try:
        frc = abtest.parse_forces(case)
        d = caseinfo.describe(case, frc)
        return abtest.settled_at(frc, d, d["total"])
    except (OSError, ValueError, KeyError, IndexError, ZeroDivisionError, statistics.StatisticsError):
        return None


def _averaged(case):
    """(from, written): the latest written time that holds the averaging's own record (uniform/meanFlowProperties), in
    the run's own folder or its processor0, and that time less the record's totalTime of U; None before one."""
    best = None
    for root in (case, os.path.join(case, "processor0")):
        for name, value in times(root).items():
            props = os.path.join(root, name, "uniform", AVERAGE + "Properties")
            if (best is None or value > best[1]) and (os.path.isfile(props) or os.path.isfile(props + ".gz")):
                best = (props, value)
    if best is None:
        return None
    props, value = best
    text = read(props)
    if not text and os.path.isfile(props + ".gz"):
        try:
            with gzip.open(props + ".gz", "rt", encoding="utf-8", errors="replace") as f:
                text = f.read()
        except (OSError, EOFError, zlib.error):
            return None
    m = re.search(r"(?<![\w.])U\s*\{[^}]*?\btotalTime\s+(" + caseinfo.NUM + r")\s*;", plain(text))
    if m is None:
        return None
    return float(f"{value - float(m.group(1)):.6g}"), value


def averaging(case, doc=None):
    """A transient run's averaging, as GET /runs/{name} gives it: {from, settled, written} in s; None when it has none
    (made before Mesh Doctor averaged a transient run's flow, or with a fieldAverage of its own).  All three are None
    until it is switched on.  `from`: when it began, from the latest time written with it (that time less its
    totalTime), else as its status says (`doc`: the time the solver was at when it was switched on); `settled`: when
    the forces had settled then; `written`: that latest time, None before one."""
    state = average_state(case)
    if state is None:
        return None
    out = {"from": None, "settled": None, "written": None}
    if state == "on":
        rec = (doc or {}).get("averaging") or {}
        out.update({"from": rec.get("from"), "settled": rec.get("settled")})
        got = _averaged(case)
        if got:
            out["from"], out["written"] = got
    return out
