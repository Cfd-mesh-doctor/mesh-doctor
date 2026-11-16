# Vortex pictures of a solved OpenFOAM case with ParaView 5.10 (pvbatch, offscreen): iso-surfaces of the Q-criterion,
#   Q = 0.5 (|Omega|^2 - |S|^2)   (Omega = rotation rate, S = strain rate of the velocity gradient),
# which is positive where the air spins faster than it is being sheared, so its iso-surfaces wrap the vortex cores.
# A low Q shows many vortices (and some rolled-up shear layers); a high Q keeps only the strongest cores.
# The surfaces are coloured by the x-vorticity w_x (car axes, x forward): red = the air turns clockwise when seen from
# behind the car, blue = anticlockwise, white = it turns about another axis (e.g. a wake's spanwise rollers).
# On a Q = q surface |w| >= 2 sqrt(q), so the colour range is +-2 sqrt(q), rounded: a fully streamwise vortex is full colour.
#
# Usage (WSL): PYTHONPATH=/usr/lib/python3/dist-packages pvbatch --force-offscreen-rendering vortex_views.py \
#              CASE.foam OUTDIR "Q1,Q2,..." --walls p1,p2,... [--views rear34,top,side,front34,zoom]
#              [--zoom PATCH] [--note "text; {it}"]
# Axes: x forward (the flow goes toward -x), z up, the model on a ground at z = 0. --zoom PATCH adds a close-up view
# around that patch.
#              vortex_views.py --selftest OUTDIR      (a synthetic vortex: checks the pipeline and the colour sign)
# Q values in 1/s^2. Files: OUTDIR/Q<value>_<view>.png. Q comes from the reader's point velocity (cell-to-point) with
# the Gradient filter's faster approximation (cell gradients averaged to the points), so it is a little smoothed:
# the Q values are levels to look at, not the solver's own numbers. Read-only on the case.
import math
import os
import sys
import time
import traceback

from paraview.simple import *

SELFTEST = sys.argv[1] == '--selftest'
if SELFTEST:
    CASE, OUT, QS = None, sys.argv[2], '10,40'
else:
    CASE, OUT, QS = sys.argv[1:4]


def opt(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv[:-1] else default


os.makedirs(OUT, exist_ok=True)
QV = [float(x) for x in QS.split(',')]
ALLVIEWS = ['rear34', 'top', 'side', 'front34', 'zoom']
VIEWS = opt('--views', ','.join(ALLVIEWS if opt('--zoom') else ALLVIEWS[:4])).split(',')
NOTE = opt('--note', 'OpenFOAM result, iteration {it}')
W, H = 1920, 1080
ASPECT = W / H
CAR = opt('--walls', 'none').split(',')
GREY = [0.78, 0.78, 0.80]
INK = [0.12, 0.12, 0.14]
T0 = time.time()
TIME = None
DONE, FAILED, SHOWN = [], [], []


def mem():
    try:
        with open('/proc/self/status') as fh:
            s = {l.split(':')[0]: int(l.split()[1]) for l in fh if l.startswith(('VmRSS', 'VmHWM'))}
        return '| memory %.1f GB, peak %.1f GB' % (s['VmRSS'] / 1048576, s['VmHWM'] / 1048576)
    except Exception:
        return ''


def log(*a):
    print('[%5.0f s]' % (time.time() - T0), *a, flush=True)


def setp(proxy, **kw):
    for k, val in kw.items():
        try:
            setattr(proxy, k, val)
        except Exception as e:
            log('  note: could not set %s: %s' % (k, e))


def set_any(proxy, prop, values):
    for val in values:
        try:
            setattr(proxy, prop, val)
            return
        except Exception:
            pass
    log('  note: could not set %s to any of %s' % (prop, values))


def sub(a, b):
    return [a[i] - b[i] for i in range(3)]


def add(a, b):
    return [a[i] + b[i] for i in range(3)]


def mul(a, s):
    return [x * s for x in a]


def dot(a, b):
    return sum(a[i] * b[i] for i in range(3))


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def unit(a):
    n = math.sqrt(dot(a, a))
    return [x / n for x in a]


def nice(v):
    """The smallest 'round' number (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 x a power of ten) at or above v."""
    p = 10 ** math.floor(math.log10(v))
    for m in (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10):
        if m * p >= v * 0.999:
            return m * p
    return 10 * p


def fmtq(q):
    return '{:,.0f}'.format(q) if q >= 1 else '%g' % q


# ---------------------------------------------------------------- one view for everything (as render_cfd.py)
V = CreateView('RenderView')
V.ViewSize = [W, H]
setp(V, OrientationAxesVisibility=0, UseColorPaletteForBackground=0)
setp(V, Background=[1.0, 1.0, 1.0], UseFXAA=1)
TXT = Text(Text=' ')
TD = Show(TXT, V)
setp(TD, FontSize=22, Color=INK, Justification='Left')
set_any(TD, 'WindowLocation', ['Upper Left Corner', 'UpperLeftCorner'])
try:
    _DisableFirstRenderCameraReset()
except Exception:
    pass
Render(V)


def wx_lut(r):
    """Blue - white - red for the x-vorticity, symmetric about 0, fixed range +-r."""
    l = GetColorTransferFunction('Vorticity')
    setp(l, AutomaticRescaleRangeMode='Never', ColorSpace='Diverging', VectorMode='Component', VectorComponent=0)
    l.RGBPoints = [-r, 0.231, 0.299, 0.754, 0.0, 0.865, 0.865, 0.865, r, 0.706, 0.016, 0.150]
    l.RescaleTransferFunction(-r, r)
    GetOpacityTransferFunction('Vorticity').RescaleTransferFunction(-r, r)
    return l


def show(src, wx=None, solid=GREY):
    d = Show(src, V)
    d.SetRepresentationType('Surface')
    if wx:
        ColorBy(d, ('POINTS', 'Vorticity', 'X'))
        l = wx_lut(wx)                                  # ColorBy resets the range: put the fixed one back
        d.SetScalarBarVisibility(V, True)
        sb = GetScalarBar(l, V)
        setp(sb, Title='x-vorticity (1/s)', ComponentTitle='', TitleColor=INK, LabelColor=INK, TitleFontSize=22,
             LabelFontSize=20, ScalarBarLength=0.4, ScalarBarThickness=22, RangeLabelFormat='%.0f')
        set_any(sb, 'WindowLocation', ['Lower Right Corner', 'LowerRightCorner'])
    else:
        d.ColorArrayName = ['POINTS', '']
        d.AmbientColor = list(solid)
        d.DiffuseColor = list(solid)
    SHOWN.append((src, d))
    return d


def clear():
    for src, d in SHOWN:
        try:
            d.SetScalarBarVisibility(V, False)
            Hide(src, V)
        except Exception:
            pass
    del SHOWN[:]


def frame(b, d, up=(0, 0, 1), parallel=False, pad=1.04, angle=30.0, zoom=1.0):
    """Point the camera along -d at the box b = [x0,x1,y0,y1,z0,z1] and fit the box's corners in the image."""
    c = [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2]
    d = unit(d)
    f = mul(d, -1)
    r = unit(cross(f, up))
    u = cross(r, f)
    pts = [[x, y, z] for x in b[0:2] for y in b[2:4] for z in b[4:6]]
    V.CameraFocalPoint = c
    V.CameraViewUp = u
    V.CameraViewAngle = angle
    if parallel:
        wr = max(abs(dot(sub(p, c), r)) for p in pts)
        hu = max(abs(dot(sub(p, c), u)) for p in pts)
        dep = max(dot(sub(p, c), d) for p in pts)
        V.CameraParallelProjection = 1
        V.CameraParallelScale = max(hu, wr / ASPECT) * pad / zoom
        V.CameraPosition = add(c, mul(d, dep + 20.0))
    else:
        t = math.tan(math.radians(angle / 2))
        D = max(dot(sub(p, c), d) + max(abs(dot(sub(p, c), u)) / t, abs(dot(sub(p, c), r)) / (ASPECT * t))
                for p in pts)
        V.CameraParallelProjection = 0
        V.CameraPosition = add(c, mul(d, D * pad / (1.2 * zoom)))


def shot(name, title, *steps):
    try:
        clear()
        for s in steps:
            s()
        TXT.Text = title + '\n' + NOTE
        Render(V)
        SaveScreenshot(os.path.join(OUT, name + '.png'), V, ImageResolution=[W, H])
        DONE.append(name)
        log('saved', name)
    except Exception:
        FAILED.append(name)
        log('FAILED', name)
        traceback.print_exc()


def update(src):
    if TIME is None:
        src.UpdatePipeline()
    else:
        src.UpdatePipeline(TIME)
    return src


def bounds(src):
    return list(update(src).GetDataInformation().GetBounds())


def reader(regions, arrays, poly=None):
    r = OpenFOAMReader(FileName=CASE)
    r.CaseType = 'Reconstructed Case'
    setp(r, SkipZeroTime=1)
    if poly is not None:
        setp(r, Decomposepolyhedra=poly)
    r.UpdatePipelineInformation()
    r.MeshRegions = regions
    r.CellArrays = arrays
    return r


def times(r):
    tv = r.TimestepValues
    try:
        return [float(t) for t in tv]
    except TypeError:
        return [] if tv is None else [float(tv)]


def qcriterion(vol):
    """Point arrays 'Q' and 'Vorticity' from the point velocity U (no 9-component gradient array kept)."""
    for name in ('Gradient', 'GradientOfUnstructuredDataSet'):
        maker = globals().get(name)
        if maker is None:
            continue
        g = maker(Input=vol)
        setp(g, ScalarArray=['POINTS', 'U'], ComputeGradient=0, ComputeVorticity=1, ComputeQCriterion=1,
             FasterApproximation=1, VorticityArrayName='Vorticity', QCriterionArrayName='Q')
        update(g)
        keys = g.PointData.keys()
        if 'Q' in keys and 'Vorticity' in keys:
            log('gradient filter', name, 'arrays', keys, mem())
            return g
        log('  %s gave %s; trying the next filter' % (name, keys))
        Delete(g)
    raise RuntimeError('no gradient filter produced Q and Vorticity')


def clip_x(src, x0):
    """Keep x > x0 (drops the far wake, which would sit between the rear cameras and the car)."""
    c = Clip(Input=src)
    c.ClipType = 'Plane'
    c.ClipType.Origin = [x0, 0, 0]
    c.ClipType.Normal = [1, 0, 0]
    setp(c, Invert=0)
    return c


VIEWDEF = {
    # key: (words, direction to the camera, up, parallel, box key)
    'rear34': ('rear three-quarter view', (-1, -0.8, 0.8), (0, 0, 1), False, 'car'),
    'top': ('top view', (0, 0, 1), (0, -1, 0), True, 'car'),
    'side': ('side view, from the left', (0, 1, 0), (0, 0, 1), True, 'car'),
    'front34': ('front three-quarter view', (1, 1, 0.6), (0, 0, 1), False, 'car'),
    'zoom': ('close-up of %s, from behind and to the side' % opt('--zoom', 'the zoom patch'),
             (-0.9, 1, 0.6), (0, 0, 1), False, 'wheel'),
}


def pictures(car_src, field, boxes, wake_x):
    q_range = field.PointData['Q'].GetRange()
    log('Q range %.3g to %.3g 1/s^2' % q_range)
    for q in QV:
        if q >= q_range[1]:
            log('skipped Q = %g: above the largest Q (%.3g)' % (q, q_range[1]))
            continue
        iso = Contour(Input=field, ContourBy=['POINTS', 'Q'], Isosurfaces=[q])
        setp(iso, ComputeNormals=1, ComputeScalars=0)
        src = clip_x(iso, wake_x) if wake_x is not None else iso
        update(src)
        r = nice(2 * math.sqrt(q))
        log('Q = %g: %d triangles; colour range +-%g 1/s' % (q, src.GetDataInformation().GetNumberOfCells(), r), mem())
        for key in VIEWS:
            words, d, up, par, bk = VIEWDEF[key]
            title = ('Vortices: Q-criterion iso-surface at Q = %s 1/s^2;  %s\n'
                     'Coloured by x-vorticity: red = the air turns clockwise seen from behind, blue = anticlockwise, '
                     'white = it turns about another axis' % (fmtq(q), words))
            steps = [lambda: show(src, wx=r), lambda: frame(boxes[bk], d, up, par)]
            if car_src is not None:
                steps.insert(0, lambda: show(car_src))
            shot('Q%s_%s' % ('%g' % q, key), title, *steps)
        clear()                                         # hide it before deleting (SHOWN must not keep dead proxies)
        if src is not iso:
            Delete(src)
        Delete(iso)


def selftest():
    """A Gaussian vortex turning about +x (w_x > 0) in a uniform -x stream: its Q tube must come out red."""
    global NOTE, VIEWS
    NOTE = 'Self-test: a synthetic vortex turning about +x (w_x > 0), so it must be red (clockwise seen from behind)'
    VIEWS = ['rear34', 'side']
    wv = Wavelet()
    wv.WholeExtent = [-10, 10, -10, 10, -10, 10]
    ug = Tetrahedralize(Input=wv)                                   # an unstructured grid, like the OpenFOAM read
    vel = Calculator(Input=ug, AttributeType='Point Data', ResultArrayName='U',
                     Function='-15*iHat + (-5*coordsZ*exp(-(coordsY^2+coordsZ^2)/9))*jHat'
                              ' + (5*coordsY*exp(-(coordsY^2+coordsZ^2)/9))*kHat')
    g = qcriterion(vel)
    b = [-10, 10, -10, 10, -10, 10]
    pictures(None, g, {'car': b, 'wheel': b}, None)
    from paraview import servermanager as sm
    from vtk.numpy_interface import dataset_adapter as dsa
    iso = Contour(Input=g, ContourBy=['POINTS', 'Q'], Isosurfaces=[10.0])
    w = dsa.WrapDataObject(sm.Fetch(iso)).PointData['Vorticity']
    log('self-test: on the Q = 10 tube, w_x averages %.2f and w_y, w_z %.2f, %.2f (expected: w_x positive, the others '
        'about 0)' % (float(w[:, 0].mean()), float(w[:, 1].mean()), float(w[:, 2].mean())))


def main():
    global TIME, NOTE
    rs = reader(['patch/' + p for p in CAR], [])
    TIME = max(times(rs))
    V.ViewTime = TIME
    NOTE = NOTE.replace('{it}', '%g' % TIME)
    car = MergeBlocks(Input=rs)
    cb = bounds(car)
    boxes = {'car': [cb[0] - 1.2, cb[1] + 0.1, cb[2] - 0.1, cb[3] + 0.1, cb[4], cb[5] + 0.1]}
    if opt('--zoom'):
        zr = reader(['patch/' + opt('--zoom')], [])
        zb = bounds(zr)
        Delete(zr)
        pad = 0.5 * max(zb[1] - zb[0], zb[3] - zb[2], zb[5] - zb[4])
        boxes['wheel'] = [zb[0] - pad, zb[1] + pad, zb[2] - pad, zb[3] + pad, max(cb[4], zb[4] - pad), zb[5] + pad]
    log('case', CASE, 'time', TIME, 'model', cb, mem())
    ri = reader(['internalMesh'], ['U'], poly=0)                   # poly 0: a third fewer cells than split polyhedra
    update(ri)
    log('volume', ri.GetDataInformation().GetNumberOfCells(), 'cells', mem())
    g = qcriterion(ri)
    pictures(car, g, boxes, cb[0] - 1.25)


try:
    selftest() if SELFTEST else main()
finally:
    log('done: %d images, failed: %s' % (len(DONE), FAILED or 'none'), mem())
