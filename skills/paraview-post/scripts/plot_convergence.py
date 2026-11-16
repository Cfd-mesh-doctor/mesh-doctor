# Residual and force charts for a steady OpenFOAM run, from its postProcessing folder (restarts are merged by iteration).
# Usage (WSL/Linux): python3 plot_convergence.py CASE_DIR OUT_DIR PREFIX "subtitle for every chart" [options]
#   --total FO            forces function object for the whole model (default forcesTotal)
#   --parts FO:Label,...  forces function objects per part (optional), e.g. forcesWing:Wing,forcesWheels:Wheels
#   --uinf 15 --rho 1.205 free-stream speed (m/s) and the forces' rhoInf (kg/m3)
#   --window 100          averaging window (last N iterations)
#   --wheelbase 1.55      optional: front/rear split of downforce from the pitching moment about the front axle
#   --drag -x --down -z   which force component is drag / downforce, with its sign (defaults: flow toward -x, z up);
#                         e.g. SimScale-style flow toward +x with y up: --drag +x --down -y
# Needs python3 with numpy and matplotlib.
# Writes PREFIX_residuals.png, PREFIX_forces_total.png, PREFIX_forces_by_part.png, PREFIX_summary.csv, and prints
# the summary as Markdown tables.
import csv
import glob
import math
import os
import re
import sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt                    # noqa: E402
import numpy as np                                 # noqa: E402

CASE, OUT, PREFIX, SUB = sys.argv[1:5]


def opt(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv[5:-1] else default


os.makedirs(OUT, exist_ok=True)
RHO, UINF = float(opt('--rho', 1.205)), float(opt('--uinf', 15))
Q = 0.5 * RHO * UINF ** 2          # dynamic pressure (Pa)
WB = float(opt('--wheelbase')) if opt('--wheelbase') else None
WIN = int(opt('--window', 100))    # the averaging window: the last WIN iterations
TOTAL = opt('--total', 'forcesTotal')
PARTS = [tuple(p.split(':', 1)) for p in opt('--parts', '').split(',') if p]
AXES = {s + a: (1 if s == '+' else -1, i) for s in '+-' for i, a in enumerate('xyz')}
DRAG, DOWN = opt('--drag', '-x'), opt('--down', '-z')   # drag = -Fx and downforce = -Fz by default
if DRAG not in AXES or DOWN not in AXES or DRAG[1] == DOWN[1]:
    sys.exit('--drag and --down take a sign and a different axis each, e.g. --drag +x --down -y')

# palette: the dataviz reference instance, light mode (validated: adjacent CVD dE >= 9.1, normal-vision >= 19.6)
SURF, INK, INK2, MUTED, GRID, AXIS = '#fcfcfb', '#0b0b0b', '#52514e', '#898781', '#e1e0d9', '#c3c2b7'
SLOT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300']
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'axes.titlesize': 11})


def series(fo, name):
    """All rows of postProcessing/<fo>/<start>/<name>, later restarts winning, as {iteration: [numbers]}."""
    rows = {}
    folders = glob.glob(os.path.join(CASE, 'postProcessing', fo, '*'))
    for d in sorted(folders, key=lambda p: float(os.path.basename(p)) if re.match(r'^[\d.e+-]+$', os.path.basename(p))
                    else -1):
        f = os.path.join(d, name)
        if not os.path.isfile(f):
            continue
        for line in open(f):
            if line.startswith('#') or not line.strip():
                continue
            parts = line.replace('(', ' ').replace(')', ' ').split()
            try:
                rows[float(parts[0])] = [float(x) if x != 'N/A' else math.nan for x in parts[1:]]
            except ValueError:
                pass
    it = np.array(sorted(rows))
    return it, np.array([rows[i] for i in it])


def forces(fo):
    """Iterations, drag, downforce, side force and pitching moment (about the front axle at the ground)."""
    it, a = series(fo, 'forces.dat')
    f = a[:, 0:3] + a[:, 3:6]                       # pressure + viscous
    m = a[:, 6:9] + a[:, 9:12]
    (ds, di), (ls, li) = AXES[DRAG], AXES[DOWN]
    si = 3 - di - li                                # the remaining axis: side force, pitching moment
    return it, ds * f[:, di], ls * f[:, li], f[:, si], m[:, si]


def last(it, v):
    sel = it > it[-1] - WIN
    return v[sel].mean()


def change(it, v):
    a = v[it > it[-1] - WIN].mean()
    b = v[(it > it[-1] - 2 * WIN) & (it <= it[-1] - WIN)].mean()
    return 100 * (a - b) / abs(b)


def style(ax, ylabel, logy=False):
    ax.set_facecolor(SURF)
    if logy:
        ax.set_yscale('log')
    for s in ('top', 'right'):
        ax.spines[s].set_visible(False)
    for s in ('left', 'bottom'):
        ax.spines[s].set_color(AXIS)
        ax.spines[s].set_linewidth(0.8)
    ax.tick_params(colors=AXIS, labelcolor=INK2, labelsize=9, length=3, width=0.6)
    ax.tick_params(which='minor', length=0)
    ax.grid(axis='y', which='major', color=GRID, linewidth=0.6, linestyle='-')
    ax.set_axisbelow(True)
    ax.set_xlabel('Iteration', color=INK2, fontsize=9)
    ax.set_ylabel(ylabel, color=INK2, fontsize=9)


def figure(title, w=10.0, h=5.625, ncols=1):
    fig, axes = plt.subplots(1, ncols, figsize=(w, h), dpi=160, facecolor=SURF)
    fig.text(0.012, 0.965, title, color=INK, fontsize=14, fontweight='semibold', va='top')
    fig.text(0.012, 0.905, SUB, color=INK2, fontsize=9.5, va='top')
    return fig, axes


def end_labels(ax, x, items, gap_px=15):
    """Label each line's end with name and value, in text ink; spread labels that would collide and join them to
    their lines with leader lines (never stack them unattached)."""
    tr = ax.transData
    pts = sorted(((tr.transform((x, y))[1], y, text, col) for y, text, col in items), key=lambda p: p[0])
    ys = [p[0] for p in pts]
    for i in range(1, len(ys)):                     # push up from the bottom
        ys[i] = max(ys[i], ys[i - 1] + gap_px)
    over = ys[-1] - tr.transform((x, ax.get_ylim()[1]))[1]
    if over > 0:                                    # then shift everything down if the top ran out of the plot
        ys = [y - over for y in ys]
    inv = tr.inverted()
    xl = x + 0.035 * (ax.get_xlim()[1] - ax.get_xlim()[0])
    for (py, y, text, col), ny in zip(pts, ys):
        ax.plot([x], [y], 'o', ms=5.5, color=col, mec=SURF, mew=1.4, zorder=5, clip_on=False)
        yl = inv.transform((0, ny))[1]
        if abs(ny - py) > 1.5:
            ax.plot([x, xl * 0.985 + x * 0.015], [y, yl], color=MUTED, lw=0.6, zorder=4, clip_on=False)
        ax.text(xl, yl, text, color=INK2, fontsize=9, va='center', ha='left', clip_on=False)


def save(fig, name):
    p = os.path.join(OUT, '%s_%s.png' % (PREFIX, name))
    fig.savefig(p, facecolor=SURF)
    plt.close(fig)
    print('saved', p)


# ---------------------------------------------------------------- residuals
RESFO = sorted(os.path.basename(d) for d in glob.glob(os.path.join(CASE, 'postProcessing', 'residuals*')))[0]
rit, res = series(RESFO, 'residuals.dat')
names = (opt('--resnames') or 'p,Ux,Uy,Uz,k,omega').split(',')[:res.shape[1]]
fig, ax = figure('Residuals')
fig.subplots_adjust(left=0.08, right=0.86, top=0.82, bottom=0.11)
style(ax, 'Initial residual of each solve (log scale)', logy=True)
ok = ~np.isnan(res[:, 0])
for j, n in enumerate(names):
    ax.plot(rit[ok], res[ok, j], color=SLOT[j], lw=1.1, solid_capstyle='round', solid_joinstyle='round', label=n)
lo = 10 ** math.floor(math.log10(np.nanmin(res[ok]) * 0.9))
ax.set_ylim(lo, 1.5)
ax.set_xlim(0, rit[-1])
ax.legend(loc='lower left', frameon=False, ncol=6, fontsize=9, labelcolor=INK2, handlelength=1.6,
          bbox_to_anchor=(0.0, 1.0), borderaxespad=0.3)
fig.canvas.draw()
end_labels(ax, rit[-1], [(res[-1, j], '%s  %.1e' % (n, res[-1, j]), SLOT[j]) for j, n in enumerate(names)])
save(fig, 'residuals')

# ---------------------------------------------------------------- total forces
it, drag, down, side, my = forces(TOTAL)
i0 = 50
for i in range(len(it)):                            # first iteration after which both stay on a sensible scale
    # (by size: a body that makes lift has negative downforce)
    if np.all((drag[i:] > 0) & (drag[i:] < 2 * last(it, drag)) & (abs(down[i:]) > 0)
              & (abs(down[i:]) < 2 * abs(last(it, down)))):
        i0 = max(50, int(math.ceil(it[i] / 10.0) * 10))
        break
sel = it >= i0
fig, ax = figure('Total drag and downforce')
fig.subplots_adjust(left=0.08, right=0.83, top=0.82, bottom=0.11)
style(ax, 'Force (N)')
ax.axvspan(it[-1] - WIN, it[-1], color=GRID, alpha=0.45, lw=0, zorder=0)
for v, n, c in [(down, 'Downforce', SLOT[0]), (drag, 'Drag', SLOT[1])]:
    ax.plot(it[sel], v[sel], color=c, lw=1.1, solid_capstyle='round', label=n)
ax.set_xlim(i0, it[-1])
hi = max(down[sel].max(), drag[sel].max())
lo = min(0.0, down[sel].min(), drag[sel].min())
ax.set_ylim(lo * 1.08, hi * 1.08)
if lo < 0:
    ax.axhline(0, color=MUTED, lw=0.8, zorder=1)
ax.text(it[-1] - WIN / 2, hi * 1.065, 'last %d, averaged' % WIN, color=MUTED, fontsize=8, ha='center', va='top')
ax.legend(loc='lower left', frameon=False, ncol=2, fontsize=9, labelcolor=INK2, bbox_to_anchor=(0.0, 1.0),
          borderaxespad=0.3)
fig.text(0.08, 0.025, 'First %d iterations (start-up) not shown.' % i0, color=MUTED, fontsize=8)
fig.canvas.draw()
end_labels(ax, it[-1], [(down[-1], 'Downforce  %.1f N' % last(it, down), SLOT[0]),
                        (drag[-1], 'Drag  %.1f N' % last(it, drag), SLOT[1])])
save(fig, 'forces_total')

# ---------------------------------------------------------------- forces by part
part = {}
for fo, label in PARTS:
    part[fo] = forces(fo)
if PARTS:
    fig, axes = figure('Downforce and drag by part', ncols=2)
    fig.subplots_adjust(left=0.07, right=0.88, top=0.75, bottom=0.11, wspace=0.42)
    for ax, k, title in [(axes[0], 2, 'Downforce (N)'), (axes[1], 1, 'Drag (N)')]:
        style(ax, title)
        ax.axvspan(it[-1] - WIN, it[-1], color=GRID, alpha=0.45, lw=0, zorder=0)
        ax.axhline(0, color=AXIS, lw=0.8, zorder=1)
        vals = []
        for j, (fo, label) in enumerate(PARTS):
            pit, v = part[fo][0], part[fo][k]
            s = pit >= i0
            ax.plot(pit[s], v[s], color=SLOT[j], lw=1.1, solid_capstyle='round', label=label)
            vals.append(v[s])
        allv = np.concatenate(vals)
        pad = 0.08 * (allv.max() - allv.min())
        ax.set_ylim(min(0, allv.min()) - pad, allv.max() + pad)
        ax.set_xlim(i0, it[-1])
        ax.set_title(title.replace(' (N)', ''), color=INK, fontsize=10.5, loc='left', fontweight='semibold')
    h, lab = axes[0].get_legend_handles_labels()
    fig.legend(h, lab, loc='upper left', frameon=False, ncol=4, fontsize=9, labelcolor=INK2, bbox_to_anchor=(0.064, 0.875),
               borderaxespad=0.0)
    fig.text(0.07, 0.025, 'Part forces are written every 10 iterations. First %d iterations (start-up) not shown.' % i0,
             color=MUTED, fontsize=8)
    fig.canvas.draw()
    for ax, k in [(axes[0], 2), (axes[1], 1)]:
        end_labels(ax, it[-1], [(part[fo][k][-1], '%.1f' % last(part[fo][0], part[fo][k]), SLOT[j])
                                for j, (fo, label) in enumerate(PARTS)], gap_px=19)
    save(fig, 'forces_by_part')

# ---------------------------------------------------------------- summary
D, L, S, M = last(it, drag), last(it, down), last(it, side), last(it, my)
rear = -M / WB if WB else None                      # rear-axle share of the aero load (moment about the front axle)
rows = []
for fo, label in PARTS:
    pit, d, l, s, m = part[fo]
    rows.append((label, last(pit, d), last(pit, l), last(pit, s)))
rows.append(('Total', D, L, S))
with open(os.path.join(OUT, PREFIX + '_summary.csv'), 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['part', 'drag_N', 'downforce_N', 'side_N', 'CdA_m2', 'ClA_m2', 'share_of_downforce_pct'])
    for label, d, l, s in rows:
        w.writerow([label, '%.2f' % d, '%.2f' % l, '%.2f' % s, '%.4f' % (d / Q), '%.4f' % (l / Q),
                    '%.1f' % (100 * l / L)])
print('\nMeans over iterations %d-%d (parts: every 10th iteration). q = %.1f Pa.\n' % (it[-1] - WIN + 1, it[-1], Q))
print('| Part | Drag (N) | Downforce (N) | CdA (m²) | ClA (m²) | Share of downforce |')
print('|---|---|---|---|---|---|')
for label, d, l, s in rows:
    print('| %s | %.1f | %.1f | %.3f | %.3f | %.0f %% |' % (label, d, l, d / Q, l / Q, 100 * l / L))
print('\nL/D %.2f; side force %.1f N' % (L / D, S))
if WB:
    print('Front share of downforce %.1f %% (centre of pressure %.3f m behind the front axle; wheelbase %.2f m)' % (100 * (L - rear) / L, M / L * -1, WB))
print('Change of the last %d against the %d before: drag %+.2f %%, downforce %+.2f %%' % (
    WIN, WIN, change(it, drag), change(it, down)))
print('Range over the last %d: drag %.1f-%.1f N, downforce %.1f-%.1f N' % (
    2 * WIN, drag[it > it[-1] - 2 * WIN].min(), drag[it > it[-1] - 2 * WIN].max(),
    down[it > it[-1] - 2 * WIN].min(), down[it > it[-1] - 2 * WIN].max()))
print('Final residuals: ' + ', '.join('%s %.1e' % (n, res[-1, j]) for j, n in enumerate(names)))
print('Drop from the first iteration: ' + ', '.join('%s %.1f orders' % (n, math.log10(res[ok][0, j] / res[-1, j]))
                                                    for j, n in enumerate(names)))
try:
    lines = [l.split() for l in open(sorted(glob.glob(os.path.join(CASE, 'postProcessing', 'yPlus', '*', 'yPlus.dat')),
             key=lambda p: float(p.split('/')[-2]))[-1]) if not l.startswith('#') and l.strip()]
    tmax = max(float(l[0]) for l in lines)
    print('\ny+ at iteration %g:' % tmax)
    for l in lines:
        if float(l[0]) == tmax:
            print('  %-11s min %6.2f  max %8.1f  average %7.1f' % (l[1], float(l[2]), float(l[3]), float(l[4])))
except Exception as e:
    print('y+: not read (%s)' % e)
tl = [l.split() for l in open(sorted(glob.glob(os.path.join(CASE, 'postProcessing', 'time', '*', 'time.dat')))[-1])
      if not l.startswith('#') and l.strip()]
print('Wall-clock time: %.0f s in the last run segment (%.2f h), %.1f s per iteration' % (
    float(tl[-1][2]), float(tl[-1][2]) / 3600, (float(tl[-1][2]) - float(tl[0][2])) / (float(tl[-1][0]) - float(tl[0][0]))))
