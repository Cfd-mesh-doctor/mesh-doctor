# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""What a case says about itself: force groups, flow direction, up axis, density.

Nothing here knows any particular model.  Everything comes from the case
(postProcessing/, 0*/U, system/) or from config.py:

  force groups   every postProcessing/<name>/<time>/forces.dat (or force.dat)
  total group    the group with the largest mean |drag| (it contains the others)
  flow           the freestream vector in 0*/U (inlet patch first; binary fields and
                 `$variables` are handled), else the config `flow_axis` (+x)
  up             the config `up_axis`, else a forceCoeffs `liftDir`, else whichever
                 cross-flow axis carries the larger mean total force (downforce/lift
                 beats side force on cars and wings); vertical force is "downforce"
                 when it points down
  rho, |U|       rhoInf in system/, |freestream| from 0*/U

Standard library only.
"""
import os, re

import config

NUM = r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?"
VEC = re.compile(r"^(\S+)\s+\(\(([^)]*)\)\s+\(([^)]*)\)\)")      # t ((px py pz) (vx vy vz))
AXES = "xyz"


def read_text(path, n=-1):
    """Text of a file (at most n characters); raises OSError like open()."""
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read(n)


def _time_dirs(d):
    try:
        ts = [(float(t), os.path.join(d, t)) for t in os.listdir(d) if re.fullmatch(NUM, t)]
    except OSError:
        return []
    return [p for _, p in sorted(ts)]


def force_files(case, pp_dir="postProcessing"):
    """{group: [forces.dat files in time order]} for every forces function object."""
    out = {}
    pp = os.path.join(case, pp_dir)
    try:
        groups = sorted(os.listdir(pp))
    except OSError:
        return out
    for g in groups:
        files = []
        for td in _time_dirs(os.path.join(pp, g)):
            for name in ("forces.dat", "force.dat", "forceCoeffs.dat"):
                f = os.path.join(td, name)
                if os.path.isfile(f):
                    files.append(f)
                    break
        if files:
            out[g] = files
    return out


def _header_vec(line):
    m = re.search(r"\(\s*(" + NUM + r")\s+(" + NUM + r")\s+(" + NUM + r")\s*\)", line)
    return [float(m.group(i)) for i in (1, 2, 3)] if m else None


def _coeff_rows(lines, rho):
    """forceCoeffs.dat back to forces: F = 1/2 rho U^2 A (Cd dragDir + Cl liftDir).
    The file has no side-force coefficient, so the third axis stays 0."""
    hv, cols, rows = {}, None, []
    for line in lines:
        if line.startswith("#"):
            m = re.match(r"#\s*(\w+)\s*:\s*(.+)$", line)
            if m:
                hv[m.group(1)] = m.group(2).strip()
            h = line[1:].split()
            if h[:1] == ["Time"]:
                cols = h
            continue
        if not cols or "Cd" not in cols or "Cl" not in cols:
            continue
        try:
            q = 0.5 * rho * float(hv["magUInf"]) ** 2 * float(hv["Aref"])
            dd, ld = _header_vec(hv["dragDir"]), _header_vec(hv["liftDir"])
            t = line.split()
            cd, cl = float(t[cols.index("Cd")]), float(t[cols.index("Cl")])
            rows.append((float(t[0]), *(q * (cd * dd[i] + cl * ld[i]) for i in range(3))))
        except (KeyError, ValueError, IndexError, TypeError):
            pass
    return rows


def _rows(path, rho=1.0):
    """[(t, Fx, Fy, Fz)] from one forces file; handles both OpenFOAM forces
    layouts and forceCoeffs.dat (converted with rho = rhoInf)."""
    rows, idx = [], None
    try:
        lines = read_text(path).splitlines()
    except OSError:
        return rows
    if os.path.basename(path) == "forceCoeffs.dat":
        return _coeff_rows(lines, rho)
    for line in lines:
        if line.startswith("#"):
            h = line[1:].split()
            if "total_x" in h:
                idx = h.index("total_x")
            continue
        m = VEC.match(line)
        try:
            if m:
                p = [float(x) for x in m.group(2).split()]
                v = [float(x) for x in m.group(3).split()]
                rows.append((float(m.group(1)), p[0] + v[0], p[1] + v[1], p[2] + v[2]))
            elif idx is not None:
                t = line.split()
                rows.append((float(t[0]), float(t[idx]), float(t[idx + 1]), float(t[idx + 2])))
        except (ValueError, IndexError):
            pass
    return rows


def parse_forces(case, pp_dir="postProcessing"):
    """{group: {"Time": [...], "Fx": [...], "Fy": [...], "Fz": [...]}}; a restart's later file wins."""
    out = {}
    ff = force_files(case, pp_dir)
    rho = (rho_inf(case) or 1.0) if any(f.endswith("forceCoeffs.dat") for fs in ff.values() for f in fs) else 1.0
    for g, files in ff.items():
        byt = {}
        for f in files:
            for t, fx, fy, fz in _rows(f, rho):
                byt[t] = (fx, fy, fz)
        if byt:
            ts = sorted(byt)
            out[g] = {"Time": ts, "Fx": [byt[t][0] for t in ts], "Fy": [byt[t][1] for t in ts],
                      "Fz": [byt[t][2] for t in ts]}
    return out


CHUNK = 400_000
NCOMP = {b"scalar": 1, b"vector": 3, b"symmTensor": 6, b"tensor": 9}


def field_text(path):
    """A field file as text with a big nonuniform internalField list left out.

    A binary list is seeked over (its length is in the header), so a field of
    millions of cells costs two small reads.  An ASCII list is scanned in chunks
    until boundaryField.  Returns None when the file can't be read."""
    try:
        fh = open(path, "rb")
    except OSError:
        return None
    with fh:
        head = fh.read(CHUNK)
        m = re.search(rb"internalField\s+nonuniform\s+List<(\w+)>\s*(\d+)\s*\(", head)
        if not m:
            return head.decode("utf-8", "replace")
        if re.search(rb"\bformat\s+binary", head[:m.start()]):
            size = 4 if re.search(rb"scalar\s*=\s*32", head[:m.start()]) else 8
            fh.seek(m.end() + int(m.group(2)) * NCOMP.get(m.group(1), 3) * size)
            return (head[:m.start()] + fh.read(CHUNK)).decode("utf-8", "replace")
        buf, at = head, head.find(b"boundaryField", m.end())
        while at < 0:
            more = fh.read(4 * CHUNK)
            if not more:
                return head[:m.start()].decode("utf-8", "replace")
            buf = buf[-32:] + more
            at = buf.find(b"boundaryField")
        return (head[:m.start()] + buf[at:at + CHUNK]).decode("utf-8", "replace")


def _vector(txt, value, variables):
    """(x, y, z) from `uniform (x y z)`, `uniform $name` or `$name`, else None."""
    value = value.strip()
    v = re.fullmatch(r"(?:uniform\s+)?\$\{?(\w+)\}?", value)
    if v:
        value = variables.get(v.group(1), "")
    m = re.search(r"\(\s*(" + NUM + r")\s+(" + NUM + r")\s+(" + NUM + r")\s*\)", value)
    return [float(m.group(i)) for i in (1, 2, 3)] if m else None


def _variables(txt, path, case):
    """`name (x y z);` entries of the file and of the files it #includes."""
    out = {}
    texts = [txt]
    for inc in re.findall(r'#include(?:Etc)?\s+"([^"]+)"', txt)[:8]:
        f = inc.replace("$FOAM_CASE", case).replace("${FOAM_CASE}", case)
        f = f if os.path.isabs(f) else os.path.join(os.path.dirname(path), f)
        try:
            texts.append(read_text(f, CHUNK))
        except OSError:
            pass
    for t in texts:
        for k, val in re.findall(r"^\s*(\w+)\s+(\([^;()]*\))\s*;", t, re.M):
            out.setdefault(k, val)
    return out


TIME_LINE = re.compile(r"^Time = (" + NUM + r")s?\s*$")
RES_LINE = re.compile(r"Solving for (\w+), Initial residual = (" + NUM + r")")


PIMPLE_LINE = re.compile(r"^PIMPLE: Iteration (\d+)")
COURANT_LINE = re.compile(r"^Courant Number mean: (" + NUM + r") max: (" + NUM + r")")
BOUNDING_LINE = re.compile(r"^bounding (\w+)")


def transient(case):
    """True unless system/fvSchemes says ddtSchemes { default steadyState; }."""
    path = os.path.join(case, "system", "fvSchemes")
    m = re.search(r"ddtSchemes\s*\{([^}]*)\}", read_text(path) if os.path.isfile(path) else "")
    d = re.search(r"default\s+(\w+)", m.group(1)) if m else None
    return bool(d) and d.group(1) != "steadyState"


def step_stats(paths, field="p"):
    """Per time step of a transient log: [{t, first, last, outer, coMean, coMax,
    bounded}].  `first` is the initial residual of the first `field` solve in the
    step, `last` that of the first solve in the last PIMPLE outer iteration (how
    far the outer loop converged the step), `bounded` the names of fields
    bounded in the step.  Values are None where the log does not say."""
    steps, byt = [], {}
    for path in paths:
        try:
            fh = open(path, encoding="utf-8", errors="replace")
        except OSError:
            continue
        with fh:
            cur = None
            for line in fh:
                m = TIME_LINE.match(line)
                if m:
                    t = float(m.group(1))
                    cur = byt[t] = {"t": t, "first": None, "last": None, "outer": 0,
                                    "coMean": None, "coMax": None, "bounded": [], "_new": True}
                    continue
                if cur is None:
                    continue
                m = PIMPLE_LINE.match(line)
                if m:
                    cur["outer"], cur["_new"] = int(m.group(1)), True
                    continue
                m = RES_LINE.search(line)
                if m and m.group(1) == field and cur["_new"]:
                    r = float(m.group(2))
                    if cur["first"] is None:
                        cur["first"] = r
                    cur["last"], cur["_new"] = r, False
                    continue
                m = COURANT_LINE.match(line)
                if m:
                    cur["coMean"], cur["coMax"] = float(m.group(1)), float(m.group(2))
                    continue
                m = BOUNDING_LINE.match(line)
                if m and m.group(1) not in cur["bounded"]:
                    cur["bounded"].append(m.group(1))
    for t in sorted(byt):
        s = byt[t]
        s.pop("_new")
        if s["first"] is not None:
            steps.append(s)
    return steps


def solver_logs(case, names=("log.foamRun*",)):
    """The case's solver logs, oldest first (a later log wins where times repeat)."""
    import glob
    files = [f for n in names for f in glob.glob(os.path.join(case, n))]
    return sorted(set(files), key=lambda f: os.path.getmtime(f))


def log_residuals(paths):
    """Initial residuals per time step read from solver logs, for cases without a
    `residuals` function object: {"Time": [...], field: [...]} (None where a field
    was not solved).  The first solve of a field in a time step counts, which is
    what the residuals function object records."""
    byt, fields = {}, []
    for path in paths:
        try:
            fh = open(path, encoding="utf-8", errors="replace")
        except OSError:
            continue
        with fh:
            cur = None
            for line in fh:
                m = TIME_LINE.match(line)
                if m:
                    cur = byt[float(m.group(1))] = {}
                    continue
                if cur is None:
                    continue
                m = RES_LINE.search(line)
                if m and m.group(1) not in cur:
                    cur[m.group(1)] = float(m.group(2))
                    if m.group(1) not in fields:
                        fields.append(m.group(1))
    ts = [t for t in sorted(byt) if byt[t]]
    if not ts:
        return {}
    out = {"Time": ts}
    for f in fields:
        out[f] = [byt[t].get(f) for t in ts]
    return out


_fs_cache = {}


def freestream(case):
    """freestream_uncached, remembered until one of the U files changes."""
    names = ["0", "0.orig", "0.warm", "0.cold"]
    stamp = []
    for f in [os.path.join(case, n, "U") for n in names] + \
             [os.path.join(case, "processor0", n, "U") for n in names]:
        try:
            stamp.append(os.stat(f).st_mtime)
        except OSError:
            stamp.append(None)
    hit = _fs_cache.get(case)
    if hit and hit[0] == stamp:
        return hit[1]
    v = freestream_uncached(case)
    _fs_cache[case] = (stamp, v)
    return v


def freestream_uncached(case):
    """The freestream velocity vector from the case's initial U.

    Looks at 0, 0.orig, 0.warm, 0.cold (also in processor0): first the value of a
    patch whose name contains "inlet" or whose type is freestream-like, then a
    uniform internalField, then any non-zero uniform vector."""
    names = ["0", "0.orig", "0.warm", "0.cold"]
    cands = [os.path.join(case, n, "U") for n in names] + \
            [os.path.join(case, "processor0", n, "U") for n in names]
    for f in cands:
        txt = field_text(f)
        if not txt:
            continue
        var = _variables(txt, f, case)
        i = txt.find("boundaryField")
        bnd = txt[i:] if i >= 0 else ""
        tries = []
        for name, body in re.findall(r'("?[\w.*|()-]+"?)\s*\{([^{}]*)\}', bnd):
            typ = re.search(r"\btype\s+(\w+)", body)
            inletish = "inlet" in name.lower() or (typ and "freestream" in typ.group(1).lower())
            for key in ("freestreamValue", "inletValue", "value"):
                m = re.search(r"\b" + key + r"\s+([^;]+);", body)
                if m:
                    tries.append((0 if inletish else 2, m.group(1)))
        m = re.search(r"internalField\s+([^;]+);", txt)
        if m:
            tries.append((1, m.group(1)))
        for _, val in sorted(tries, key=lambda x: x[0]):
            v = _vector(txt, val, var)
            if v and any(abs(x) > 1e-12 for x in v):
                return v
    return None


def lift_dir(case):
    """liftDir of a forceCoeffs function object in system/, as (axis, sign), else None."""
    sysd = os.path.join(case, "system")
    try:
        names = sorted(os.listdir(sysd))
    except OSError:
        return None
    for n in names:
        try:
            txt = read_text(os.path.join(sysd, n), CHUNK)
        except OSError:
            continue
        m = re.search(r"^\s*liftDir\s*\(\s*(" + NUM + r")\s+(" + NUM + r")\s+(" + NUM + r")\s*\)", txt, re.M)
        if m:
            v = [float(m.group(i)) for i in (1, 2, 3)]
            a = max(range(3), key=lambda i: abs(v[i]))
            if abs(v[a]) > 0.9 * sum(x * x for x in v) ** 0.5:      # axis-aligned only
                return a, (1 if v[a] > 0 else -1)
    return None


def rho_inf(case):
    """rhoInf from the case's function-object settings (None if not found)."""
    sysd = os.path.join(case, "system")
    try:
        names = os.listdir(sysd)
    except OSError:
        return None
    for n in sorted(names):
        try:
            txt = read_text(os.path.join(sysd, n), CHUNK)
        except OSError:
            continue
        m = re.search(r"^\s*rhoInf\s+(" + NUM + r")\s*;", txt, re.M)
        if m:
            return float(m.group(1))
    return None


def _axis_setting(key):
    v = (config.settings().get(key) or "").strip().lower()
    m = re.fullmatch(r"([+-]?)([xyz])", v)
    return (AXES.index(m.group(2)), -1 if m.group(1) == "-" else 1) if m else None


def flow(case):
    """(axis index, sign, |U| or None, where it came from)."""
    u = freestream(case)
    if u:
        a = max(range(3), key=lambda i: abs(u[i]))
        return a, (1 if u[a] > 0 else -1), sum(x * x for x in u) ** 0.5, "0/U"
    s = _axis_setting("flow_axis")
    if s:
        return s[0], s[1], None, "config flow_axis"
    return 0, 1, None, "default +x"


def _mean(x):
    return sum(x) / len(x) if x else 0.0


def describe(case, frc=None):
    """How to read the forces of this case.

    Returns {"total": group, "flowAxis", "flowSign", "upAxis", "upSign", "vertical":
    "downforce"|"lift", "Uinf", "rho", "groups": [...], "source": {...}}.
    Drag of a row = flowSign * F[flowAxis]; vertical = upSign * F[upAxis].
    """
    frc = parse_forces(case) if frc is None else frc
    fa, fs, uinf, fsrc = flow(case)
    keys = ("Fx", "Fy", "Fz")
    groups = sorted(frc, key=lambda g: -abs(_mean(frc[g][keys[fa]][-200:])))
    total = groups[0] if groups else None
    cross = [i for i in range(3) if i != fa]
    s = _axis_setting("up_axis")
    ld = lift_dir(case)
    if s and s[0] != fa:
        ua, usrc = s[0], "config up_axis"
    elif ld and ld[0] != fa:
        ua, usrc = ld[0], "forceCoeffs liftDir"
    elif total:
        ua = max(cross, key=lambda i: abs(_mean(frc[total][keys[i]][-200:])))
        usrc = "largest cross-flow force"
    else:
        ua, usrc = cross[0], "default"
    fz = _mean(frc[total][keys[ua]][-200:]) if total else 0.0
    down = fz < 0
    return {"total": total, "groups": groups, "flowAxis": fa, "flowSign": fs,
            "upAxis": ua, "upSign": -1 if down else 1, "vertical": "downforce" if down else "lift",
            "Uinf": uinf, "rho": rho_inf(case),
            "source": {"flow": fsrc, "up": usrc}}


def series(frc, d, group, what):
    """[(t, value)] for one group: what = "drag" or "vertical"."""
    F = frc.get(group)
    if not F:
        return []
    keys = ("Fx", "Fy", "Fz")
    if what == "drag":
        k, s = keys[d["flowAxis"]], d["flowSign"]
    else:
        k, s = keys[d["upAxis"]], d["upSign"]
    return [(t, s * v) for t, v in zip(F["Time"], F[k])]
