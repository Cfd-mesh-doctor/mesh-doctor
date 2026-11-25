# The cells that set a run's time step, drawn with its model's walls, with ParaView 5.10 (pvbatch, offscreen).
# They are the cells with the highest Courant number at the time pictured (Mesh Doctor's foamCourantCells, in its
# transient plan), which foamToVTK -cellSet fastestCells writes as legacy VTK files: one for the whole mesh, or one for
# each processor of a case split onto its processes (some of them empty).
#
# Usage (WSL): PYTHONPATH=/usr/lib/python3/dist-packages pvbatch --force-offscreen-rendering fastest_cells.py \
#              CASE.foam reconstructed|decomposed OUTDIR CELLS_DIR --walls p1,p2,... [--places places.json]
#              [--note "text; {it}"]
# CASE.foam: the case, for its walls (decomposed: split onto its processes, read as it is). CELLS_DIR: the *.vtk files
# of the cells. places.json: {"cells": N, "places": [{"centre": [x, y, z], "bbox": [[x0, y0, z0], [x1, y1, z1]],
# "h": a cell's size, "title": its words}, ...]}, the fastest place first.
# Axes: x forward (the flow goes toward -x), z up. Files: OUTDIR/fastest_<view>.png for the views side, top and
# front34: the walls in grey and the cells in red, each with a red dot at its centre that keeps its size on the screen,
# so a cell far smaller than a pixel still shows; and OUTDIR/fastest_place<N>.png, a close-up of each place: its cells
# and the walls' surface mesh around them, seen from outside the model. Read-only on the case.
import glob
import json
import math
import os
import sys
import time
import traceback

from paraview.simple import *

CASE, READ, OUT, CELLS = sys.argv[1:5]


def opt(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv[:-1] else default


os.makedirs(OUT, exist_ok=True)
W, H = 1920, 1080
ASPECT = W / H
WALLS = opt('--walls', 'none').split(',')
NOTE = opt('--note', 'OpenFOAM result, written time {it}')
GREY = [0.80, 0.80, 0.82]
EDGE = [0.50, 0.50, 0.54]
INK = [0.12, 0.12, 0.14]
RED = [0.85, 0.10, 0.08]
DARK_RED = [0.42, 0.03, 0.02]
DOT, CLOSE_DOT = 14, 9              # the dots at the cells' centres, in pixels: the whole model's views, a close-up's
T0 = time.time()
DONE, FAILED, SHOWN = [], [], []
VIEWDEF = {
    # key: (words, direction to the camera, up, parallel)
    'side': ('from the side', (0, 1, 0), (0, 0, 1), True),
    'top': ('from above', (0, 0, 1), (0, -1, 0), True),
    'front34': ('from the front', (1, 1, 0.6), (0, 0, 1), False),
}


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


# ---------------------------------------------------------------- one view for everything (as vortex_views.py)
V = CreateView('RenderView')
V.ViewSize = [W, H]
setp(V, OrientationAxesVisibility=0, UseColorPaletteForBackground=0)
setp(V, Background=[1.0, 1.0, 1.0], UseFXAA=1)
TXT = Text(Text=' ')
TD = Show(TXT, V)
setp(TD, FontSize=22, Color=INK, Justification='Left')
set_any(TD, 'WindowLocation', ['Upper Left Corner', 'UpperLeftCorner'])
setp(TD, ShowBorder='Always', BackgroundColor=[1.0, 1.0, 1.0, 0.85], BorderColor=[1.0, 1.0, 1.0],
     BorderThickness=0.0, Padding=6, CornerRadius=0.0)         # a white box: a close-up fills the picture
try:
    _DisableFirstRenderCameraReset()
except Exception:
    pass
Render(V)


def solid(d, colour):
    d.ColorArrayName = ['POINTS', '']
    d.AmbientColor = list(colour)
    d.DiffuseColor = list(colour)


def show(src, kind, colour, edges=None, size=None):
    d = Show(src, V)
    d.SetRepresentationType(kind)
    solid(d, colour)
    if edges is not None:
        setp(d, EdgeColor=list(edges))
    if size is not None:                                # the dots: spheres that keep their size on the screen
        setp(d, PointSize=size, RenderPointsAsSpheres=1)
    SHOWN.append((src, d))
    return d


def clear():
    for src, d in SHOWN:
        try:
            Hide(src, V)
        except Exception:
            pass
    del SHOWN[:]


def frame(b, d, up=(0, 0, 1), parallel=False, pad=1.06, angle=30.0):
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
        V.CameraParallelScale = max(hu, wr / ASPECT) * pad
        V.CameraPosition = add(c, mul(d, dep + 20.0 * max(hu, wr, 1e-3)))
    else:
        t = math.tan(math.radians(angle / 2))
        D = max(dot(sub(p, c), d) + max(abs(dot(sub(p, c), u)) / t, abs(dot(sub(p, c), r)) / (ASPECT * t))
                for p in pts)
        V.CameraParallelProjection = 0
        V.CameraPosition = add(c, mul(d, D * pad / 1.2))
    try:
        V.ResetCameraClippingRange()
    except Exception:
        pass


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


def bounds(src):
    src.UpdatePipeline()
    return list(src.GetDataInformation().GetBounds())


def walls_reader():
    r = OpenFOAMReader(FileName=CASE)
    r.CaseType = 'Decomposed Case' if READ == 'decomposed' else 'Reconstructed Case'
    setp(r, SkipZeroTime=1)
    r.UpdatePipelineInformation()
    r.MeshRegions = ['patch/' + p for p in WALLS]
    r.CellArrays = []
    tv = r.TimestepValues
    try:
        ts = [float(t) for t in tv]
    except TypeError:
        ts = [] if tv is None else [float(tv)]
    if ts:
        V.ViewTime = max(ts)
        r.UpdatePipeline(max(ts))
    return r, (max(ts) if ts else None)


def cells_reader():
    """The cells, every non-empty VTK file of CELLS together: (the source, its cell count)."""
    parts = []
    for f in sorted(glob.glob(os.path.join(CELLS, '*.vtk'))):
        r = LegacyVTKReader(FileNames=[f])
        r.UpdatePipeline()
        if r.GetDataInformation().GetNumberOfCells() > 0:
            parts.append(r)
        else:
            Delete(r)
    if not parts:
        raise SystemExit('fastest_cells: no cells in the VTK files of %s' % CELLS)
    src = AppendDatasets(Input=parts) if len(parts) > 1 else parts[0]
    src.UpdatePipeline()
    return src, src.GetDataInformation().GetNumberOfCells()


def near(walls, box):
    """The walls within a box three times the size of `box`, about it: a close-up isn't hidden by a far part of the
    model between it and the camera.  The walls whole when the clip keeps nothing."""
    c = [(box[0] + box[1]) / 2, (box[2] + box[3]) / 2, (box[4] + box[5]) / 2]
    half = [1.5 * (box[1] - box[0]), 1.5 * (box[3] - box[2]), 1.5 * (box[5] - box[4])]
    try:
        cl = Clip(Input=walls)
        cl.ClipType = 'Box'
        cl.ClipType.Position = [c[k] - half[k] for k in range(3)]
        cl.ClipType.Length = [2 * h for h in half]
        setp(cl, Invert=1, Crinkleclip=1)
        cl.UpdatePipeline()
        if cl.GetDataInformation().GetNumberOfCells() > 0:
            return cl
        Delete(cl)
    except Exception:
        traceback.print_exc()
    return walls


def main():
    global NOTE
    places = {}
    if opt('--places'):
        with open(opt('--places')) as f:
            places = json.load(f)
    r, at = walls_reader()
    NOTE = NOTE.replace('{it}', '%g' % at if at is not None else '?')
    walls = MergeBlocks(Input=r)
    wb = bounds(walls)
    cells, n = cells_reader()
    dots = CellCenters(Input=cells)
    setp(dots, VertexCells=1)
    log('case', CASE, 'time', at, 'walls', [round(x, 4) for x in wb], 'cells', n, mem())
    count = places.get('cells', n)
    span = max(wb[1] - wb[0], wb[3] - wb[2], wb[5] - wb[4])
    box = [wb[0] - 0.03 * span, wb[1] + 0.03 * span, wb[2] - 0.03 * span, wb[3] + 0.03 * span,
           wb[4] - 0.03 * span, wb[5] + 0.03 * span]
    for key, (words, d, up, par) in VIEWDEF.items():
        title = ('The cells that set the time step: the %d with the highest Courant number, in red, each with a dot at '
                 'its centre; %s' % (count, words))
        shot('fastest_' + key, title,
             lambda: show(walls, 'Surface', GREY),
             lambda: show(cells, 'Surface', RED),
             lambda: show(dots, 'Points', RED, size=DOT),
             lambda d=d, up=up, par=par: frame(box, d, up, par))
    mid = [(wb[0] + wb[1]) / 2, (wb[2] + wb[3]) / 2, (wb[4] + wb[5]) / 2]
    half = [max((wb[1] - wb[0]) / 2, 1e-9), max((wb[3] - wb[2]) / 2, 1e-9), max((wb[5] - wb[4]) / 2, 1e-9)]
    for i, g in enumerate(places.get('places', []), 1):
        lo, hi = g['bbox']
        size = max(hi[k] - lo[k] for k in range(3))
        pad = max(0.25 * size, 6 * g['h'])
        pb = [lo[0] - pad, hi[0] + pad, lo[1] - pad, hi[1] + pad, lo[2] - pad, hi[2] + pad]
        out = [(g['centre'][k] - mid[k]) / half[k] for k in range(3)]     # where it is in the model's box
        d = unit(out) if dot(out, out) > 1e-12 else [1.0, 1.0, 0.6]       # seen from outside the model, there
        up = (0, -1, 0) if abs(d[2]) > 0.9 else (0, 0, 1)
        around = near(walls, pb)
        title = g.get('title') or 'Place %d of the cells that set the time step, close up' % i
        shot('fastest_place%d' % i, title.replace(': ', ':\n', 1),          # what it is, then where and why
             lambda around=around: show(around, 'Surface With Edges', GREY, edges=EDGE),
             lambda: show(cells, 'Surface With Edges', RED, edges=DARK_RED),
             lambda: show(dots, 'Points', RED, size=CLOSE_DOT),
             lambda pb=pb, d=d, up=up: frame(pb, d, up, False, pad=1.1))
        clear()
        if around is not walls:
            Delete(around)


try:
    main()
finally:
    log('done: %d images, failed: %s' % (len(DONE), FAILED or 'none'), mem())
if FAILED and not DONE:
    sys.exit(1)
