# Find surface faces with unphysical pressure (Cp below LIM) on a solved OpenFOAM case, say how much
# extra force each spot carries against its surroundings, and render close-ups of the worst spot.
#   pvbatch --force-offscreen-rendering pressure_spots.py <case.foam> decomposed|reconstructed OUTDIR PREFIX \n#       --walls p1,p2,... [--uinf 15] [--rho 1.205]
# Axes: x forward (flow toward -x), z up. Read-only on the case. Forces use OpenFOAM's sign convention: drag = -Fx, downforce = -Fz.
import math
import os
import sys

import numpy as np
from paraview.simple import *
from paraview import servermanager as sm
from vtk.util.numpy_support import vtk_to_numpy as v2n

CASE, KIND, OUT, PREFIX = sys.argv[1:5]
# Options after PREFIX:
#   --note "first line of the picture note, {it} = iteration"   (default: 'OpenFOAM result, iteration {it}')
#   --at x,y,z,nx,ny,nz    render the three pictures at this place (normal into the wall) even when no spot is found
#   --atnote "second line of the note at --at; {cpmin} = the lowest Cp within 10 cm of the place"


def opt(name):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv[5:-1] else None


NOTE1 = opt('--note') or 'OpenFOAM result, iteration {it}'
AT = [float(v) for v in opt('--at').split(',')] if opt('--at') else None
ATNOTE = opt('--atnote') or 'At the chosen place the lowest Cp within 10 cm is {cpmin}.'
os.makedirs(OUT, exist_ok=True)
if not opt('--walls'):
    sys.exit('give the wall patches of the model: --walls body,wing,wheel')
UINF = float(opt('--uinf') or 15)
RHO = float(opt('--rho') or 1.205)   # the forces function object's rhoInf
Q = 0.5 * UINF ** 2                  # kinematic dynamic pressure (p is p/rho)
LIM, NEAR = -5.0, 0.05        # Cp below LIM is a spot; spot faces within NEAR (m) of each other form one spot
CAR = opt('--walls').split(',')
W, H = 1920, 1080
INK = [0.12, 0.12, 0.14]


def setp(proxy, **kw):
    for k, val in kw.items():
        try:
            setattr(proxy, k, val)
        except Exception as e:
            print('  note: could not set %s: %s' % (k, e))


def reader(patches):
    r = OpenFOAMReader(FileName=CASE)
    r.CaseType = 'Decomposed Case' if KIND == 'decomposed' else 'Reconstructed Case'
    r.SkipZeroTime = 1
    r.UpdatePipelineInformation()
    r.MeshRegions = ['patch/' + p for p in patches]
    r.CellArrays = ['p']
    return r


def faces(patch, t):
    """Face area vectors (pointing out of the fluid, like OpenFOAM's Sf), face centres and p."""
    m = MergeBlocks(Input=reader([patch]))
    m.UpdatePipeline(t)
    g = sm.Fetch(m)
    pts = v2n(g.GetPoints().GetData()).astype(float)
    ca = g.GetCells()
    off = v2n(ca.GetOffsetsArray()).astype(np.int64)
    con = v2n(ca.GetConnectivityArray()).astype(np.int64)
    p = v2n(g.GetCellData().GetArray('p')).astype(float)
    n = np.diff(off)
    nxt = np.arange(len(con)) + 1
    nxt[off[1:] - 1] = off[:-1]
    R = pts[con] - pts[np.repeat(con[off[:-1]], n)]          # relative to each face's first point
    S = 0.5 * np.add.reduceat(np.cross(R, R[nxt]), off[:-1], axis=0)   # Newell area vector
    C = np.add.reduceat(pts[con], off[:-1], axis=0) / n[:, None]
    return S, C, p


t = max(reader(CAR[:1]).TimestepValues)
print('time', t)
spots, tot, at_low = [], np.zeros(3), []
for patch in CAR:
    S, C, p = faces(patch, t)
    A = np.linalg.norm(S, axis=1)
    Cp = p / Q
    F = RHO * p[:, None] * S
    tot += F.sum(0)
    f = F.sum(0)
    print('%s: %d faces, %.3f m2, pressure force (%.2f, %.2f, %.2f) N, Cp %.1f .. %.2f'
          % (patch, len(p), A.sum(), f[0], f[1], f[2], Cp.min(), Cp.max()))
    low = []                                                  # the lowest Cp, at up to 3 places NEAR apart
    for i in np.argsort(Cp)[:5000]:
        if all(np.linalg.norm(C[i] - C[j]) > NEAR for j in low):
            low.append(i)
            if len(low) == 3:
                break
    print('   lowest Cp: ' + ';  '.join('%.1f at (%.3f, %.3f, %.3f)' % (Cp[i], C[i][0], C[i][1], C[i][2])
                                       for i in low))
    if AT:
        near = np.where(np.linalg.norm(C - np.array(AT[:3]), axis=1) < 2 * NEAR)[0]
        if len(near):
            j = near[np.argmin(Cp[near])]
            at_low.append((Cp[j], patch, C[j]))
    idx = np.where(Cp < LIM)[0]
    left = set(idx.tolist())
    while left:
        i0 = min(left, key=lambda i: Cp[i])
        cl = idx[np.linalg.norm(C[idx] - C[i0], axis=1) < NEAR]
        cl = np.array([i for i in cl if i in left])
        left -= set(cl.tolist())
        nb = (np.linalg.norm(C - C[i0], axis=1) < 2 * NEAR) & (Cp >= LIM)
        pref = (p[nb] * A[nb]).sum() / A[nb].sum()
        dF = RHO * ((p[cl] - pref)[:, None] * S[cl]).sum(0)
        c = (C[cl] * A[cl, None]).sum(0) / A[cl].sum()
        nrm = S[cl].sum(0)
        nrm = nrm / np.linalg.norm(nrm)
        print('   spot at (%.3f, %.3f, %.3f): %d faces, %.0f mm2, Cp min %.1f, surroundings Cp %.2f;'
              ' vs surroundings it adds drag %.2f N, downforce %.2f N, side %.2f N; normal into the wall (%.2f, %.2f, %.2f)'
              % (c[0], c[1], c[2], len(cl), A[cl].sum() * 1e6, Cp[cl].min(), pref / Q,
                 -dF[0], -dF[2], dF[1], nrm[0], nrm[1], nrm[2]))
        spots.append((Cp[cl].min(), c, nrm, patch, dF))
print('model pressure force (%.2f, %.2f, %.2f) N' % tuple(tot))
if spots:
    dsum = sum(s[4] for s in spots)
    print('all spots together add drag %.2f N, downforce %.2f N' % (-dsum[0], -dsum[2]))
if not spots and not AT:
    sys.exit(0)

# ---------------------------------------------------------------- pictures of the worst spot (or of the --at place)
if AT:
    c, nrm = np.array(AT[:3]), np.array(AT[3:6]) / np.linalg.norm(AT[3:6])
    best = min(at_low, key=lambda s: s[0]) if at_low else None
    NOTE2 = ATNOTE.replace('{cpmin}', '%.1f (on the %s)' % (best[0], best[1]) if best else 'not found (no wall faces)')
    WHAT = 'the place'
    print('lowest Cp within %.0f cm of the place: %s' % (200 * NEAR, NOTE2))
else:
    worst = min((s for s in spots if s[1][1] >= 0), key=lambda s: s[0], default=min(spots, key=lambda s: s[0]))
    cmin, c, nrm, patch, dF = worst
    NOTE2 = ('Spot on the %s at x %.3f, y %.3f, z %.3f m: Cp down to %.0f, far below anything the real flow can reach.'
             % (patch, c[0], c[1], c[2], cmin))
    WHAT = 'the spot'
V = CreateView('RenderView')
V.ViewSize = [W, H]
setp(V, OrientationAxesVisibility=0, UseColorPaletteForBackground=0)
setp(V, Background=[1.0, 1.0, 1.0], UseFXAA=1)
try:
    _DisableFirstRenderCameraReset()
except Exception:
    pass
cpf = Calculator(Input=reader(CAR))
cpf.AttributeType = 'Cell Data'
cpf.ResultArrayName = 'Cp'
cpf.Function = 'p/%g' % Q
d = Show(cpf, V)
ColorBy(d, ('CELLS', 'Cp'))
l = GetColorTransferFunction('Cp')
setp(l, AutomaticRescaleRangeMode='Never')
l.RGBPoints = [LIM, 0.231, 0.299, 0.754, 0.0, 0.865, 0.865, 0.865, 1.0, 0.706, 0.016, 0.150]
l.RescaleTransferFunction(LIM, 1.0)
setp(l, UseBelowRangeColor=1, BelowRangeColor=[0.85, 0.0, 0.85])
d.SetScalarBarVisibility(V, True)
sb = GetScalarBar(l, V)
setp(sb, Title='Cp  (magenta: below %g)' % LIM, ComponentTitle='', TitleColor=INK, LabelColor=INK,
     TitleFontSize=22, LabelFontSize=20, ScalarBarLength=0.4, ScalarBarThickness=22, RangeLabelFormat='%.0f')
TXT = Text(Text=' ')
TD = Show(TXT, V)
setp(TD, FontSize=22, Color=INK, Justification='Left')
for loc in ['Upper Left Corner', 'UpperLeftCorner']:
    try:
        TD.WindowLocation = loc
        break
    except Exception:
        pass
Render(V)
NOTE = NOTE1.replace('{it}', '%g' % t) + ': Cp on the model (cell values).\n' + NOTE2


def look(name, title, dirn, dist, edges=False):
    dirn = np.array(dirn, float)
    dirn = dirn / np.linalg.norm(dirn)
    up = np.array([0.0, 0.0, 1.0]) if abs(dirn[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    d.SetRepresentationType('Surface With Edges' if edges else 'Surface')
    if edges:
        d.EdgeColor = [0.20, 0.20, 0.26]
    V.CameraFocalPoint = list(c)
    V.CameraPosition = list(c + dirn * dist)
    V.CameraViewUp = list(up)
    V.CameraViewAngle = 30.0
    V.CameraParallelProjection = 0
    TXT.Text = title + '\n' + NOTE
    Render(V)
    SaveScreenshot(os.path.join(OUT, name + '.png'), V, ImageResolution=[W, H])
    print('saved', name)


side = 1.0 if c[1] >= 0 else -1.0
look(PREFIX + '_Cp_spot_closeup', 'Close-up, looking straight at %s from the air side, with the surface mesh' % WHAT,
     -nrm, 0.16, edges=True)
look(PREFIX + '_Cp_spot_normal', 'Same direction, further back', -nrm, 0.7)
look(PREFIX + '_Cp_spot_side', 'From the side of the model', [0.15, side, 0.25], 1.3)
