// SPDX-License-Identifier: GPL-3.0-or-later
// The repair map in a report (`meshdoctor map <name>` before `meshdoctor report <name>`): the model's wall
// faces seen from the side and from above, the defect clusters found before the repair and those left after
// it, and optional heat layers (the cells whose residual swung most between iterations). Plain functions
// here, so they can be tested without a canvas; RepairMap.tsx draws them.
import { arr, num, obj, str, strs } from "./values";

export type MapViewName = "side" | "top";

/** A model axis: 0 = x, 1 = y, 2 = z. */
export type Axis = 0 | 1 | 2;
const isAxis = (a: unknown): a is Axis => a === 0 || a === 1 || a === 2;

export interface MapView {
  name: MapViewName;
  /** the model axes drawn across and up the picture */
  axes: [Axis, Axis];
  lo: [number, number];
  hi: [number, number];
  /** the wall-face density: base64 of ny rows of nx bytes, top row first; may be missing */
  nx: number;
  ny: number;
  data: string;
}

export interface Defect {
  c: [number, number, number];
  n: number;
  kinds: string[];
  patches: string[];
  nonOrtho: number | null;
  skew: number | null;
}

export interface HeatCell {
  at: [number, number, number];
  /** how much the cell's value swung, in multiples of the field's RMS */
  change: number | null;
}

export interface HeatLayer {
  label: string;
  /** strongest first, as the engine ranks them */
  cells: HeatCell[];
}

export interface MapSummary {
  views: MapView[];
  before: Defect[];
  after: Defect[];
  layers: HeatLayer[];
  notes: string[];
}

/** Bigger pictures than this (about 4000 x 1000 bins) are left out instead of slowing the tab down. */
const MAX_PIXELS = 4_000_000;

const pair = (x: unknown): [number, number] | null => {
  const a = arr(x).map(num);
  return a.length === 2 && a[0] != null && a[1] != null ? [a[0], a[1]] : null;
};

const point = (x: unknown): [number, number, number] | null => {
  const a = arr(x).map(num);
  return a.length >= 3 && a[0] != null && a[1] != null && a[2] != null ? [a[0], a[1], a[2]] : null;
};

function view(d: Record<string, unknown>, name: MapViewName): MapView | null {
  const v = obj(d[name]);
  const lo = pair(v.lo), hi = pair(v.hi);
  if (!lo || !hi || !(hi[0] > lo[0]) || !(hi[1] > lo[1])) return null;
  const ax = arr(obj(d.axes)[name]);
  const axes: [Axis, Axis] = ax.length === 2 && isAxis(ax[0]) && isAxis(ax[1]) ? [ax[0], ax[1]] : [0, name === "side" ? 2 : 1];
  const nx = num(v.nx), ny = num(v.ny);
  return {
    name, axes, lo, hi,
    nx: nx != null && Number.isInteger(nx) && nx > 0 ? nx : 0,
    ny: ny != null && Number.isInteger(ny) && ny > 0 ? ny : 0,
    data: str(v.data) ?? "",
  };
}

function defect(x: unknown): Defect | null {
  const o = obj(x), c = point(o.c);
  if (!c) return null;
  const n = num(o.n);
  return {
    c,
    n: n != null && n > 0 ? n : 1,
    kinds: strs(o.kinds),
    patches: strs(o.patches),
    nonOrtho: num(o.nonOrtho),
    skew: num(o.skew),
  };
}

export function mapSummary(doc: unknown): MapSummary | null {
  const d = obj(doc);
  const views = (["side", "top"] as const).map((n) => view(d, n)).filter((v): v is MapView => v != null);
  if (!views.length) return null;
  const defects = (x: unknown) => arr(x).map(defect).filter((v): v is Defect => v != null);
  const layers = arr(d.hot).map((l, i): HeatLayer => {
    const L = obj(l);
    const cells = arr(L.cells).flatMap((r): HeatCell[] => {
      const at = point(r);
      return at ? [{ at, change: num(arr(r)[3]) }] : [];
    });
    return { label: str(L.label) ?? `Layer ${i + 1}`, cells };
  }).filter((l) => l.cells.length > 0);
  return { views, before: defects(d.defectsBefore), after: defects(d.defectsAfter), layers, notes: strs(d.notes) };
}

const AXIS = "xyz";

/** "x along the flow, z up" */
export function viewHeading(v: MapView): string {
  return `${AXIS[v.axes[0]]} along the flow, ${AXIS[v.axes[1]]} ${v.name === "side" ? "up" : "across"}`;
}

/**
 * The wall-face density as one opacity per bin (0 to 0.55), rows top first: lightly blurred (3 x 3 box) so a
 * coarse bin size reads as a surface, then lifted so thin parts of the model still show.
 * null when the picture is missing, damaged or too big; the marks are still drawn then.
 */
export function decodeDensity(v: Pick<MapView, "nx" | "ny" | "data">): Float32Array | null {
  const { nx, ny } = v;
  const n = nx * ny;
  if (!(nx > 0 && ny > 0) || n > MAX_PIXELS || !v.data) return null;
  let raw: string;
  try {
    raw = atob(v.data);
  } catch {
    return null;
  }
  if (raw.length !== n) return null;
  const src = new Float32Array(n), tmp = new Float32Array(n), out = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = raw.charCodeAt(i) / 255;
  // The blur in two passes, along the rows and then down the columns; at the edges it averages what is there.
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      let s = 0, c = 0;
      for (let d = -1; d <= 1; d++) {
        const xx = x + d;
        if (xx >= 0 && xx < nx) { s += src[y * nx + xx]!; c++; }
      }
      tmp[y * nx + x] = s / c;
    }
  }
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      let s = 0, c = 0;
      for (let d = -1; d <= 1; d++) {
        const yy = y + d;
        if (yy >= 0 && yy < ny) { s += tmp[yy * nx + x]!; c++; }
      }
      out[y * nx + x] = Math.pow(Math.min(1, (s / c) * 1.6), 0.6) * 0.55;
    }
  }
  return out;
}

/** Where a view lands on a canvas `width` wide: the model keeps its proportions, at most `maxHeight` tall. */
export function frame(v: MapView, width: number, maxHeight: number) {
  const aspect = (v.hi[1] - v.lo[1]) / (v.hi[0] - v.lo[0]);
  let w = width, h = width * aspect;
  if (h > maxHeight) { h = maxHeight; w = h / aspect; }
  h = Math.max(1, Math.round(h));
  const ox = (width - w) / 2;
  return {
    ox, w, h,
    X: (u: number) => ox + ((u - v.lo[0]) / (v.hi[0] - v.lo[0])) * w,
    Y: (y: number) => (1 - (y - v.lo[1]) / (v.hi[1] - v.lo[1])) * h,
  };
}

/** Heat colours, weakest to strongest (the same in light and dark). */
export const HEAT = ["#f6d55c", "#f0a93a", "#e8702a", "#d23b3b"] as const;

/** Colour, opacity and size of the cell ranked `i` (0 = strongest) of `k`. */
export function heatStyle(i: number, k: number) {
  const t = 1 - i / k;
  return { color: HEAT[t > 0.97 ? 3 : t > 0.85 ? 2 : t > 0.6 ? 1 : 0], alpha: 0.35 + 0.6 * t, radius: 1.2 + 2.2 * t };
}

/** Only the strongest cells of a layer get a read-out under the pointer. */
export const HEAT_HOVER = 400;

export function heatText(layer: HeatLayer, i: number): string[] {
  const c = layer.cells[i]?.change;
  return [layer.label, `rank ${i + 1} of ${layer.cells.length}` + (c != null ? ` · change ${c.toFixed(1)}× RMS` : "")];
}

export const defectRadius = (d: Defect) => Math.max(2.5, Math.min(8, 1.6 * Math.sqrt(d.n)));

export function defectText(d: Defect, left: boolean): string[] {
  const faces = `${d.n} face${d.n === 1 ? "" : "s"}`;
  const worst = [d.nonOrtho != null && `non-ortho ${d.nonOrtho}°`, d.skew != null && `skew ${d.skew}`].filter(Boolean);
  return [
    left ? "Defect left after the repair" : "Defect found and repaired",
    d.kinds.length ? `${faces}: ${d.kinds.join(", ")}` : faces,
    ...(worst.length ? [worst.join(" · ")] : []),
    ...(d.patches.length ? [`on ${d.patches.join(", ")}`] : []),
    `at (${d.c.map((x) => x.toFixed(3)).join(", ")}) m`,
  ];
}

export interface Mark {
  px: number;
  py: number;
  lines: string[];
}

/** The mark nearest to (x, y), if one is within `within` pixels. */
export function nearestMark<T extends Mark>(marks: readonly T[], x: number, y: number, within = 8): T | null {
  let best: T | null = null, bd = within * within;
  for (const m of marks) {
    const d = (m.px - x) ** 2 + (m.py - y) ** 2;
    if (d <= bd) { bd = d; best = m; }
  }
  return best;
}

const count = (n: number, one: string, many: string) => (n === 0 ? `no ${many}` : `${n} ${n === 1 ? one : many}`);

/** What the picture shows, for screen readers. */
export function mapLabel(m: MapSummary, v: MapView, layer: HeatLayer | null): string {
  return `${v.name === "side" ? "Side" : "Top"} view of the model's wall faces (${viewHeading(v)}), with `
    + `${count(m.before.length, "defect", "defects")} found and repaired and ${count(m.after.length, "defect", "defects")} left`
    + (layer ? `, and the ${layer.cells.length} strongest cells of the heat layer ${layer.label}` : "");
}
