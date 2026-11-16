# Close-up plane cuts through a solved OpenFOAM case, coloured by speed (U), pressure (Cp) or total pressure (Cpt), with the
# model cut away on the camera's side so the cut shows. The cuts are listed in a JSON file (see cuts_example.json):
#   {"cuts": [{"name": "...", "title": "...", "plane": "x|y|z", "at": 0.39,
#              "box": [x0, x1, y0, y1, z0, z1]  (the area to show; the plane's own axis is ignored),
#              "colours": ["U", "Cp", "Cpt"], "step": 0.001 (optional probe spacing in m, default 0.002)}]}
# Axes: x forward (flow toward -x), z up. Cameras: a y cut is seen from +y, a z cut from above, an x cut from behind. The box is framed
# with a clear band at the top for the title and one at the right for the colour bar.
# Usage (WSL): PYTHONPATH=/usr/lib/python3/dist-packages pvbatch --force-offscreen-rendering cut_views.py \
#              CASE.foam decomposed|reconstructed OUTDIR CUTS.json "note under every title; {it} = iteration" \n#              --walls p1,p2,... [--uinf 15]   (p must be kinematic, p/rho, as in incompressible solvers)
import json
import math
import os
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


rs = reader(['patch/' + p for p in CAR], ['p'])
tv = rs.TimestepValues
tv = list(tv) if hasattr(tv, '__len__') else [tv]
TIME = max(tv)
V.ViewTime = TIME
NOTE = NOTE.replace('{it}', '%g' % TIME)
car = MergeBlocks(Input=rs)
ri = reader(['internalMesh'], ['p', 'U'])
vol = CellDatatoPointData(Input=ri) if KIND == 'decomposed' else ri   # a reconstructed read interpolates itself
vol = Calculator(Input=vol, AttributeType='Point Data', ResultArrayName='Cp', Function='p/%g' % QINF)
vol = Calculator(Input=vol, AttributeType='Point Data', ResultArrayName='Cpt',
                 Function='(p+0.5*(U_X*U_X+U_Y*U_Y+U_Z*U_Z))/%g' % QINF)
vol.UpdatePipeline(TIME)
log('time', TIME, 'volume', vol.GetDataInformation().GetNumberOfCells(), 'cells')

LUTS = {
    'U': (('POINTS', 'U', 'Magnitude'), '|U| (m/s)', '%.0f', None, 'Viridis (matplotlib)', (0.0, 1.5 * UINF)),
    'Cp': (('POINTS', 'Cp'), 'Cp', '%.1f', [-2.5, 0.231, 0.299, 0.754, 0.0, 0.865, 0.865, 0.865,
                                            1.0, 0.706, 0.016, 0.150], None, (-2.5, 1.0)),
    'Cpt': (('POINTS', 'Cpt'), 'Cp,t', '%.1f', None, 'Inferno (matplotlib)', (0.0, 1.0)),
}
WORDS = {'U': 'speed', 'Cp': 'pressure coefficient Cp', 'Cpt': 'total pressure coefficient Cp,t (1 = no losses)'}


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


done, failed = [], []
for cut in json.load(open(SPEC))['cuts']:
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
    for name in cut['colours']:
        out = '%s_%s' % (cut['name'], name)
        try:
            clear()
            show_grey(cc)
            show_field(keep, name)
            frame(bb, d, up)
            TXT.Text = '%s: %s\n%s' % (cut['title'], WORDS[name], NOTE)
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
