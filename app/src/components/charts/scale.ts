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

/** The round steps of a decade: 1, 2 and 5 of it, and the next decade's 1. */
const ROUND = [1, 2, 5, 10];

/** Round tick values from lo to hi, about `count` of them: 0, 50, 100, ... Asked for two or more, it gives two or
 * more: where the round step leaves fewer inside (2e-5 to 5e-4 at a step of 5e-4: only 5e-4), the next finer round
 * steps until two are (2e-4: 2e-4 and 4e-4), as a phone's narrow axis asks for two. */
export function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / Math.max(1, count);
  let p = 10 ** Math.floor(Math.log10(raw));
  let i = Math.max(0, ROUND.findIndex((m) => m * p >= raw));
  let out = multiples(lo, hi, ROUND[i]! * p);
  // Two finer steps always leave two inside (a round step is at most 1.25 times the axis, each finer one 2 to 2.5
  // times smaller); a third only for rounding at the far end of a number's precision.
  for (let finer = 0; count >= 2 && out.length < 2 && finer < 3; finer++) {
    if (i > 0) i -= 1;
    else { p /= 10; i = 2; }                       // 1 of a decade, then 5 of the one below
    out = multiples(lo, hi, ROUND[i]! * p);
  }
  return out;
}

/** The multiples of `step` from lo to hi, a thousand at most (a step too small to move a number on stops there). */
function multiples(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9 && out.length < 1000; v += step) {
    out.push(Number(v.toPrecision(12)));
  }
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
