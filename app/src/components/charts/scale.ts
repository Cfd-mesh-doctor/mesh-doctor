// SPDX-License-Identifier: GPL-3.0-or-later
// Axis ticks and point thinning for the charts.

export type Pt = [number, number];

/** About two points per pixel column: each column's lowest and highest, in order. */
export function thin(pts: Pt[], columns: number): Pt[] {
  if (pts.length <= columns * 2) return pts;
  const out: Pt[] = [];
  const per = pts.length / columns;
  for (let c = 0; c < columns; c++) {
    const a = Math.floor(c * per), b = Math.min(pts.length, Math.floor((c + 1) * per));
    let lo = a, hi = a;
    for (let i = a + 1; i < b; i++) {
      if (pts[i]![1] < pts[lo]![1]) lo = i;
      if (pts[i]![1] > pts[hi]![1]) hi = i;
    }
    out.push(pts[Math.min(lo, hi)]!);
    if (lo !== hi) out.push(pts[Math.max(lo, hi)]!);
  }
  return out;
}

/** Round tick values from lo to hi, about `count` of them: 0, 50, 100, ... */
export function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * p >= raw) ?? 10) * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** A decade's tick label: 1e-3, 1e-2, 0.1 → "1e-1", 1, 10, 100. */
export function decade(k: number): string {
  return k >= 0 ? (10 ** k).toLocaleString("en-US") : `1e${k}`;
}

/** The point whose x is closest to x, in points sorted by x. */
export function nearest(pts: Pt[], x: number): Pt | null {
  if (!pts.length) return null;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]![0] < x) lo = mid;
    else hi = mid;
  }
  return Math.abs(pts[lo]![0] - x) <= Math.abs(pts[hi]![0] - x) ? pts[lo]! : pts[hi]!;
}
