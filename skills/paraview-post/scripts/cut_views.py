# Close-up plane cuts through a solved OpenFOAM case, coloured by speed (U), pressure (Cp) or total pressure (Cpt), with the
# model cut away on the camera's side so the cut shows. The cuts are listed in a JSON file (see cuts_example.json):
#   {"cuts": [{"name": "...", "title": "...", "plane": "x|y|z", "at": 0.39,
#              "box": [x0, x1, y0, y1, z0, z1]  (the area to show; the plane's own axis is ignored),
#              "colours": ["U", "Cp", "Cpt"], "step": 0.001 (optional probe spacing in m, default 0.002)}]}
# Axes: x forward (flow toward -x), z up. Cameras: a y cut is seen from +y, a z cut from above, an x cut from behind. The box is framed
# with a clear band at the top for the title and one at the right for the colour bar.
# With `auto` for CUTS.json (a case with no cut list), three cuts are made from the walls' bounds: a side cut on the
# model's centre plane (on its symmetry plane, for a half model), a flat cut halfway up it seen from above, and a cross
# cut one model height behind it; they are written to OUTDIR/cuts.json, so their titles go with the pictures.
# Usage (WSL): PYTHONPATH=/usr/lib/python3/dist-packages pvbatch --force-offscreen-rendering cut_views.py \
#              CASE.foam decomposed|reconstructed OUTDIR CUTS.json "note under every title; {it} = iteration"
#              --walls p1,p2,... [--uinf 15] [--mean] [--over-time]   (p must be kinematic, p/rho, as in
#              incompressible solvers)
# --mean: a transient run's mean flow (UMean and pMean, from its fieldAverage) in place of U and p; each cut also
# shows how much the speed swings about it (Urms: the rms of its fluctuations, from UPrime2Mean, over the free-stream
# speed) when the case has UPrime2Mean.
# --over-time: the first cut's speed at each time the case has, oldest first, one picture each, named
# <cut>_U_at_<time>.png with the time as its folder names it, in place of each cut's colours at the latest time.
import json
import math
import os
import re
import sys
import time
import traceback

from paraview.simple import *

CASE, KIND, OUT, SPEC, NOTE = sys.argv[1:6]
os.makedirs(OUT, exist_ok=True)
W, H = 1920, 1080
def _opt(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv[:-1] else default


if '--walls' not in sys.argv and '--selftest' not in sys.argv:
    sys.exit('give the wall patches of the model: --walls body,wing,wheel (names from constant/polyMesh/boundary)')
CAR = _opt('--walls', 'none').split(',')
UINF = float(_opt('--uinf', '15'))
MEAN = '--mean' in sys.argv          # a transient run's mean flow, in place of U and p
PF, UF = ('pMean', 'UMean') if MEAN else ('p', 'U')
OVER_TIME = '--over-time' in sys.argv  # the first cut's speed at each time, in place of each cut's colours
QINF = 0.5 * UINF ** 2             # p is kinematic (p/rho): Cp = p / QINF
INK, GREY = [0.12, 0.12, 0.14], [0.78, 0.78, 0.80]
STEP = 0.002                        # probe spacing (m); a cut may set its own "step"
TOP, RIGHT = 0.065, 0.06            # parts of the frame kept clear for the title (top) and the colour bar (right)
AXIS = {'x': 0, 'y': 1, 'z': 2}
CAMERA = {'y': ((0, 1, 0), (0, 0, 1)), 'z': ((0, 0, 1), (0, -1, 0)), 'x': ((-1, 0, 0), (0, 0, 1))}
T0 = time.time()
SHOWN = []


def log(*a):
    print('[%5.0f s]' % (time.time() - T0), *a, flush=True)


def setp(proxy, **kw):
    for k, val in kw.items():
        try:
            setattr(proxy, k, val)
        except Exception as e:
            log('  note: could not set %s: %s' % (k, e))


V = CreateView('RenderView')
V.ViewSize = [W, H]
setp(V, OrientationAxesVisibility=0, UseColorPaletteForBackground=0, Background=[1.0, 1.0, 1.0], UseFXAA=1)
TXT = Text(Text=' ')
TD = Show(TXT, V)
setp(TD, FontSize=22, Color=INK, Justification='Left')   # 5.10 draws no text background, so frame() keeps a band clear
for loc in ('Upper Left Corner', 'UpperLeftCorner'):
    try:
        TD.WindowLocation = loc
        break
    except Exception:
        pass
try:
    _DisableFirstRenderCameraReset()
except Exception:
    pass
Render(V)


def reader(regions, arrays):
    r = OpenFOAMReader(FileName=CASE)
    r.CaseType = 'Decomposed Case' if KIND == 'decomposed' else 'Reconstructed Case'
    setp(r, SkipZeroTime=1, Decomposepolyhedra=0)
    r.UpdatePipelineInformation()
    r.MeshRegions = regions
    r.CellArrays = arrays
    return r


def available(r):
    """The cell arrays the case has, as the reader offers them."""
    try:
        return list(r.CellArrays.Available)
    except Exception:
        try:
            info = r.GetProperty('CellArrayInfo')
            return [info[i] for i in range(0, len(info), 2)]
        except Exception:
            return []


rs = reader(['patch/' + p for p in CAR], [PF])
tv = rs.TimestepValues
tv = list(tv) if hasattr(tv, '__len__') else [tv]
TIME = max(tv)
V.ViewTime = TIME
RAW_NOTE, NOTE = NOTE, NOTE.replace('{it}', '%g' % TIME)


def time_names():
    """{time: its folder's name} of the times the case has (processor0's, when it is read split)."""
    base = os.path.dirname(os.path.abspath(CASE))
    out = {}
    for n in os.listdir(os.path.join(base, 'processor0') if KIND == 'decomposed' else base):
        try:
            out[float(n)] = n
        except ValueError:
            pass
    return out


TNAME = time_names()
car = MergeBlocks(Input=rs)
ri = reader(['internalMesh'], [PF, UF])
RMS = MEAN and not OVER_TIME and 'UPrime2Mean' in available(ri)      # how much the mean flow's speed swings
if RMS:
    ri.CellArrays = [PF, UF, 'UPrime2Mean']
vol = CellDatatoPointData(Input=ri) if KIND == 'decomposed' else ri   # a reconstructed read interpolates itself
vol = Calculator(Input=vol, AttributeType='Point Data', ResultArrayName='Cp', Function='%s/%g' % (PF, QINF))
vol = Calculator(Input=vol, AttributeType='Point Data', ResultArrayName='Cpt',
                 Function='({p}+0.5*({u}_X*{u}_X+{u}_Y*{u}_Y+{u}_Z*{u}_Z))/{q:g}'.format(p=PF, u=UF, q=QINF))
if RMS:     # the rms of the speed's fluctuations over the free-stream speed: a third of UPrime2Mean's trace, rooted
    vol = Calculator(Input=vol, AttributeType='Point Data', ResultArrayName='Urms',
                     Function='sqrt(abs(UPrime2Mean_XX+UPrime2Mean_YY+UPrime2Mean_ZZ)/3)/%g' % UINF)
vol.UpdatePipeline(TIME)
log('time', TIME, 'volume', vol.GetDataInformation().GetNumberOfCells(), 'cells', 'with Urms' if RMS else '')

LUTS = {
    'U': (('POINTS', UF, 'Magnitude'), '|%s| (m/s)' % UF, '%.0f', None, 'Viridis (matplotlib)', (0.0, 1.5 * UINF)),
    'Cp': (('POINTS', 'Cp'), 'Cp', '%.1f', [-2.5, 0.231, 0.299, 0.754, 0.0, 0.865, 0.865, 0.865,
                                            1.0, 0.706, 0.016, 0.150], None, (-2.5, 1.0)),
    'Cpt': (('POINTS', 'Cpt'), 'Cp,t', '%.1f', None, 'Inferno (matplotlib)', (0.0, 1.0)),
    'Urms': (('POINTS', 'Urms'), "u' rms / U", '%.2f', None, 'Plasma (matplotlib)', (0.0, 0.3)),
}
WORDS = {'U': 'speed', 'Cp': 'pressure coefficient Cp', 'Cpt': 'total pressure coefficient Cp,t (1 = no losses)'}
if MEAN:
    WORDS = {'U': 'speed of the mean flow', 'Cp': 'pressure coefficient Cp of the mean flow',
             'Cpt': 'total pressure coefficient Cp,t of the mean flow (1 = no losses)',
             'Urms': 'how much the speed swings about its mean (rms / free-stream speed)'}


def apply_lut(name):
    by, title, fmt, points, preset, rng = LUTS[name]
    l = GetColorTransferFunction(by[1])
    setp(l, AutomaticRescaleRangeMode='Never')
    if name == 'U':
        setp(l, VectorMode='Magnitude')
    if points:
        setp(l, ColorSpace='Diverging')
        l.RGBPoints = points
    else:
        l.ApplyPreset(preset, True)
    l.RescaleTransferFunction(rng[0], rng[1])
    GetOpacityTransferFunction(by[1]).RescaleTransferFunction(rng[0], rng[1])
    return l


def clear():
    for src, d in SHOWN:
        try:
            d.SetScalarBarVisibility(V, False)
        except Exception:
            pass
        Hide(src, V)
    del SHOWN[:]


def show_grey(src):
    d = Show(src, V)
    d.ColorArrayName = ['POINTS', '']
    d.AmbientColor = list(GREY)
    d.DiffuseColor = list(GREY)
    SHOWN.append((src, d))


def show_field(src, name):
    by, title, fmt = LUTS[name][:3]
    d = Show(src, V)
    ColorBy(d, by)
    l = apply_lut(name)                     # ColorBy rescales to the data; put the fixed range back
    d.SetScalarBarVisibility(V, True)
    sb = GetScalarBar(l, V)
    setp(sb, Title=title, ComponentTitle='', TitleColor=INK, LabelColor=INK, TitleFontSize=22, LabelFontSize=20,
         ScalarBarLength=0.4, ScalarBarThickness=22, RangeLabelFormat=fmt)   # 5.10's bar has no background
    for loc in ('Lower Right Corner', 'LowerRightCorner'):
        try:
            sb.WindowLocation = loc
            break
        except Exception:
            pass
    SHOWN.append((src, d))


def frame(b, d, up, pad=1.03):
    c = [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2]
    f = [-x for x in d]
    r = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]]
    pts = [[x, y, z] for x in b[0:2] for y in b[2:4] for z in b[4:6]]
    wr = max(abs(sum((p[k] - c[k]) * r[k] for k in range(3))) for p in pts)
    hu = max(abs(sum((p[k] - c[k]) * up[k] for k in range(3))) for p in pts)
    a = W / H
    s = max(hu * pad / (1 - TOP), wr * pad / (a * (1 - RIGHT)))      # half the frame height (m)
    fc = [c[k] + TOP * s * up[k] + RIGHT * s * a * r[k] for k in range(3)]   # box sits below/left of the bands
    V.CameraFocalPoint = fc
    V.CameraViewUp = list(up)
    V.CameraParallelProjection = 1
    V.CameraParallelScale = s
    V.CameraPosition = [fc[k] + 20.0 * d[k] for k in range(3)]


def symmetry_patches():
    """The symmetry patches of the mesh the time is read on: processor0's boundary for a case read split (it lists
    every patch of the whole mesh), the whole mesh's otherwise, each falling back to the other when it has none (a
    case split onto its processes may have no whole mesh, or only the background mesh it was meshed from)."""
    base = os.path.dirname(os.path.abspath(CASE))
    places = [os.path.join(base, 'processor0'), base]
    for where in places if KIND == 'decomposed' else places[::-1]:
        try:
            with open(os.path.join(where, 'constant', 'polyMesh', 'boundary')) as f:
                text = f.read()
        except OSError:
            continue
        names = re.findall(r'([^\s{}();]+)\s*\{[^{}]*\btype\s+(?:symmetryPlane|symmetry)\s*;', text)
        if names:
            return names
    return []


def symmetry_at(b):
    """A half model's symmetry plane: the y of a symmetry patch of the case (symmetry_patches) lying flat on one side
    of the model's bounds b; None for a whole model."""
    span = b[3] - b[2]
    for name in symmetry_patches():
        s = reader(['patch/' + name], [])
        s.UpdatePipeline(TIME)
        sb = s.GetDataInformation().GetBounds()
        Delete(s)
        for y in (b[2], b[3]):
            if abs(sb[2] - y) < 0.01 * span and abs(sb[3] - y) < 0.01 * span:
                return y
    return None


def auto_cuts():
    """Three cuts made from the walls' bounds (flow toward -x, z up), written to OUT/cuts.json."""
    car.UpdatePipeline(TIME)
    b = list(car.GetDataInformation().GetBounds())
    x0, x1, y0, y1, z0, z1 = b
    L, B, Hm = x1 - x0, y1 - y0, z1 - z0
    ys = symmetry_at(b)
    if ys is None:
        yc, at, ya, yb = (y0 + y1) / 2, (y0 + y1) / 2, y0 - 0.7 * B, y1 + 0.7 * B
    elif ys == y0:
        yc, at, ya, yb = y0, y0 + 0.001 * B, y0, y1 + 1.3 * B      # just off the symmetry plane, in the flow
    else:
        yc, at, ya, yb = y1, y1 - 0.001 * B, y0 - 1.3 * B, y1
    xa, xb, za, zb = x0 - 1.0 * L, x1 + 0.3 * L, z0 - 0.25 * Hm, z1 + 1.0 * Hm
    step, zc, xw = max(STEP, L / 600), (z0 + z1) / 2, x0 - Hm
    where = 'symmetry' if ys is not None else 'centre'
    cuts = [
        {'name': 'a1_side_centre', 'plane': 'y', 'at': at, 'box': [xa, xb, 0, 0, za, zb], 'step': step,
         'title': "Side cut on the model's %s plane (y = %.3f m), seen from the side (+y), nose to the left" % (where, yc),
         'colours': ['U', 'Cp', 'Cpt']},
        {'name': 'a2_top_middle', 'plane': 'z', 'at': zc, 'box': [xa, xb, ya, yb, 0, 0], 'step': step,
         'title': 'Flat cut halfway up the model (z = %.3f m), seen from above' % zc, 'colours': ['U', 'Cpt']},
        {'name': 'a3_cross_wake', 'plane': 'x', 'at': xw, 'box': [0, 0, ya, yb, za, z1 + 0.6 * Hm], 'step': step,
         'title': 'Cross cut one model height (%.3f m) behind the model (x = %.3f m), seen from behind' % (Hm, xw),
         'colours': ['U', 'Cpt']},
    ]
    with open(os.path.join(OUT, 'cuts.json'), 'w') as f:
        json.dump({'about': 'cuts made from the walls\' bounds by cut_views.py (auto)', 'cuts': cuts}, f, indent=1)
    log('cuts made from the walls: x %.3f to %.3f, y %.3f to %.3f, z %.3f to %.3f m%s'
        % (x0, x1, y0, y1, z0, z1, ', a half model' if ys is not None else ''))
    return cuts


done, failed = [], []
CUTS = auto_cuts() if SPEC == 'auto' else json.load(open(SPEC))['cuts']
for cut in CUTS[:1] if OVER_TIME else CUTS:
    ax, v, b = cut['plane'], float(cut['at']), list(cut['box'])
    step = float(cut.get('step', STEP))
    i = AXIS[ax]
    j, k = [m for m in range(3) if m != i]
    o = [0.0, 0.0, 0.0]
    o[i], o[j], o[k] = v, b[2 * j], b[2 * k]
    p1, p2 = list(o), list(o)
    p1[j], p2[k] = b[2 * j + 1], b[2 * k + 1]
    try:
        pl = Plane(Origin=o, Point1=p1, Point2=p2, XResolution=max(2, int((p1[j] - o[j]) / step)),
                   YResolution=max(2, int((p2[k] - o[k]) / step)))
        pr = ResampleWithDataset(SourceDataArrays=vol, DestinationMesh=pl)
        setp(pr, MarkBlankPointsAndCells=1, PassPointArrays=0)
        keep = Clip(Input=pr)                       # drop probe points inside solids, so they show the grey car
        keep.ClipType = 'Scalar'
        keep.Scalars = ['POINTS', 'vtkValidPointMask']
        keep.Value = 0.5
        setp(keep, Invert=0)
        keep.UpdatePipeline(TIME)
        d, up = CAMERA[ax]
        cc = Clip(Input=car)                        # the car, cut away on the camera's side
        cc.ClipType = 'Plane'
        cc.ClipType.Origin = o
        n = [0.0, 0.0, 0.0]
        n[i] = 1.0
        cc.ClipType.Normal = n
        setp(cc, Invert=1 if d[i] > 0 else 0)
        log(cut['name'], keep.GetDataInformation().GetNumberOfPoints(), 'points in the flow')
    except Exception:
        failed.append(cut['name'])
        traceback.print_exc()
        continue
    bb = list(b)
    bb[2 * i], bb[2 * i + 1] = v, v
    if OVER_TIME:                       # its speed at each time, oldest first
        shots = [('U', t) for t in sorted(tv)]
    else:
        shots = [(name, None) for name in list(cut['colours'])
                 + (['Urms'] if RMS and 'Urms' not in cut['colours'] else [])]
    for name, t in shots:
        at = None if t is None else TNAME.get(t, '%g' % t)
        out = '%s_%s' % (cut['name'], name) if t is None else '%s_U_at_%s' % (cut['name'], at)
        try:
            if t is not None:
                V.ViewTime = t
                keep.UpdatePipeline(t)
            clear()
            show_grey(cc)
            show_field(keep, name)
            frame(bb, d, up)
            TXT.Text = '%s: %s\n%s' % (cut['title'], WORDS[name], NOTE if t is None else RAW_NOTE.replace('{it}', at))
            Render(V)
            SaveScreenshot(os.path.join(OUT, out + '.png'), V, ImageResolution=[W, H])
            done.append(out)
            log('saved', out)
        except Exception:
            failed.append(out)
            traceback.print_exc()
    clear()
    Delete(cc)
    Delete(keep)
    Delete(pr)
    Delete(pl)
log('done: %d images, failed: %s' % (len(done), failed or 'none'))
