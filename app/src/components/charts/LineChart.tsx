// SPDX-License-Identifier: GPL-3.0-or-later
// A light SVG line chart for residual histories: log or linear y axis, round-number ticks, and a read-out
// on hover or touch. The x axis's numbers are formatNumber's unless `xFormat` says otherwise (a transient run's
// times in s), and the label at its right end is moved left as far as it needs to fit. A `band` shades the part
// from an x on (or up to its `to`), such as the stretch a judge averages, with its name above it, clear of the lines;
// with `onChange`, its edges can be dragged, or moved with the arrow keys, Home and End, each snapping to a point of
// the first line, and it says where they were let go (the key or the pointer let go of, or the edge left; a `to` at
// the end as null: up to the end). With `yFrom`, the y axis fits the lines from that x on, and anything before it
// past the plot's edges is cut there: a run's first iterations don't squash where it settled. Long histories
// are thinned to two points per pixel column (each column's lowest and highest), so a run of 100k iterations draws
// as fast as a short one and keeps its spikes.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { decade, nearest, niceTicks, thin, type Pt } from "./scale";

export interface LineSeries {
  name: string;
  /** stroke and fill colour classes, e.g. "stroke-primary" and "bg-primary" (the read-out's swatch) */
  stroke: string;
  swatch: string;
  dashed?: boolean;
  x: readonly number[];
  y: readonly (number | null | undefined)[];
}

const M = { top: 10, right: 14, bottom: 36, left: 50 };

type Edge = "from" | "to";

/** A shaded part of the chart: from `from` to `to` (to the end without one), with its name above it. */
export interface Band {
  from: number;
  to?: number | null;
  label: string;
  /** Its edges can be moved: called with where they were let go (`to` null at the end). */
  onChange?: (from: number, to: number | null) => void;
}

/** The point of `pts` next to x, the way `dir` goes (+1 right, -1 left), or null at the end. */
function next(pts: Pt[], x: number, dir: 1 | -1): number | null {
  if (dir > 0) return pts.find((p) => p[0] > x)?.[0] ?? null;
  for (let i = pts.length - 1; i >= 0; i--) if (pts[i]![0] < x) return pts[i]![0];
  return null;
}

function points(s: LineSeries, log: boolean): Pt[] {
  const out: Pt[] = [];
  const n = Math.min(s.x.length, s.y.length);
  for (let i = 0; i < n; i++) {
    const x = s.x[i], y = s.y[i];
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y) && (!log || y > 0)) {
      out.push([x, y]);
    }
  }
  for (let i = 1; i < out.length; i++) {
    if (out[i]![0] < out[i - 1]![0]) return out.sort((a, b) => a[0] - b[0]);
  }
  return out;
}

export function LineChart({
  series, log = false, height = 260, xLabel = "x", xFormat = formatNumber, band, yFrom, label, empty = "Nothing to draw",
}: {
  series: LineSeries[];
  log?: boolean;
  height?: number;
  xLabel?: string;
  /** how the x axis and the read-out write an x (formatNumber by default) */
  xFormat?: (x: number) => string;
  /** a shaded part, from an x to the end or to its `to`, with its name above it (the plot is 14 px shorter for it);
   * with `onChange`, edges to move */
  band?: Band;
  /** fit the y axis to the lines from this x on, cutting them before it at the plot's edges */
  yFrom?: number;
  /** what the chart shows, for screen readers */
  label: string;
  empty?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const clip = `clip${useId().replace(/[^\w-]/g, "")}`;
  const [width, setWidth] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  // An edge being moved, and the band it was moved from: once the band given changes, the move is over. `done`: let
  // go, and said.
  const [moving, setMoving] = useState<{ edge: Edge; x: number; from: number; to: number | null; done?: boolean } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = (w: number) => setWidth(w > 0 ? Math.max(160, Math.round(w)) : 640); // 0: no layout (tests)
    measure(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => measure(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const w = width ?? 640;
  // A band's name sits above the plot, where no line can cross it.
  const top = band ? M.top + 14 : M.top;
  const plotW = w - M.left - M.right, plotH = height - top - M.bottom;
  const data = useMemo(() => series.map((s) => ({ s, pts: points(s, log) })), [series, log]);
  const geo = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const fit = (from: number) => {
      for (const { pts } of data) {
        for (const [x, y] of pts) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (x >= from && y < y0) y0 = y;
          if (x >= from && y > y1) y1 = y;
        }
      }
    };
    fit(yFrom ?? -Infinity);
    if (!Number.isFinite(y0)) fit(-Infinity);                          // no line reaches yFrom: fit them all
    if (!Number.isFinite(x0)) return null;
    if (x1 === x0) { x0 -= 1; x1 += 1; }
    let yTicks: { v: number; text: string }[];
    let Y: (y: number) => number;
    if (log) {
      let k0 = Math.floor(Math.log10(y0)), k1 = Math.ceil(Math.log10(y1));
      if (k1 === k0) { k0 -= 1; k1 += 1; }
      const step = Math.max(1, Math.ceil((k1 - k0) / 6));
      yTicks = [];
      for (let k = k0; k <= k1; k += step) yTicks.push({ v: 10 ** k, text: decade(k) });
      Y = (y) => top + (1 - (Math.log10(y) - k0) / (k1 - k0)) * plotH;
    } else {
      const t = niceTicks(y0 === y1 ? y0 - 1 : y0, y0 === y1 ? y1 + 1 : y1, 5);
      const lo = Math.min(y0, t[0] ?? y0), hi = Math.max(y1, t[t.length - 1] ?? y1, lo + 1e-12);
      yTicks = t.map((v) => ({ v, text: formatNumber(v) }));
      Y = (y) => top + (1 - (y - lo) / (hi - lo)) * plotH;
    }
    const X = (x: number) => M.left + ((x - x0) / (x1 - x0)) * plotW;
    const columns = Math.max(50, Math.round(plotW));
    const paths = data.map(({ s, pts }) => ({
      s,
      d: thin(pts, columns).map(([x, y], i) => `${i ? "L" : "M"}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join(""),
    }));
    const xTicks = niceTicks(x0, x1, Math.max(2, Math.floor(plotW / 90)));
    return { x0, x1, X, Y, yTicks, xTicks, paths };
  }, [data, log, plotW, plotH, top, yFrom]);

  const hover = useMemo(() => {
    if (!geo || hoverX == null) return null;
    const at = data.map(({ s, pts }) => ({ s, p: nearest(pts, hoverX) }));
    const first = at.find((a) => a.p)?.p;
    return first ? { x: first[0], at } : null;
  }, [geo, data, hoverX]);

  const onPointer = (e: PointerEvent<SVGRectElement>) => {
    if (!geo) return;
    const r = e.currentTarget.getBoundingClientRect();
    setHoverX(geo.x0 + ((e.clientX - r.left) / Math.max(1, r.width)) * (geo.x1 - geo.x0));
  };

  // The band as drawn: the one given, with an edge where it is being moved to.
  const bandTo = band?.to ?? null;
  const move = moving && band && moving.from === band.from && moving.to === bandTo ? moving : null;
  const lo = band ? (move?.edge === "from" ? move.x : band.from) : 0;
  const hi = band && geo ? (move?.edge === "to" ? move.x : (bandTo ?? geo.x1)) : 0;

  /** Where edge `edge` may go near x: the first line's nearest point, inside the chart and the band's other edge. */
  const place = (edge: Edge, x: number): number | null => {
    if (!geo || !band) return null;
    const p = nearest(data[0]?.pts ?? [], Math.min(geo.x1, Math.max(geo.x0, x)))?.[0] ?? x;
    return edge === "from" ? (p < (bandTo ?? geo.x1) ? p : null) : (p > band.from ? p : null);
  };
  const commit = (edge: Edge, x: number) => {
    if (!band?.onChange || !geo) return;
    const from = edge === "from" ? x : band.from;
    const end = edge === "to" ? x : bandTo;
    const to = end != null && end >= geo.x1 ? null : end;
    if (from !== band.from || to !== bandTo) band.onChange(from, to);
  };
  const startMove = (edge: Edge, x: number) => band && setMoving({ edge, x, from: band.from, to: bandTo });
  /** Lets go of edge `edge`, once: says where it went. */
  const letGo = (edge: Edge) => {
    if (move?.edge !== edge || move.done) return;
    setMoving({ ...move, done: true });
    commit(edge, move.x);
  };
  const xOf = (clientX: number, r: DOMRect | undefined) =>
    geo && r ? geo.x0 + ((clientX - r.left - M.left) / Math.max(1, plotW)) * (geo.x1 - geo.x0) : null;
  const onEdgeKey = (edge: Edge, e: KeyboardEvent) => {
    if (!geo || !band) return;
    const now = edge === "from" ? lo : hi;
    const step = (geo.x1 - geo.x0) / (e.shiftKey ? 10 : 100);
    const dir = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : 0;
    const target = dir ? now + dir * step : e.key === "Home" ? geo.x0 : e.key === "End" ? geo.x1 : null;
    if (target == null) return;
    e.preventDefault();
    let x = place(edge, target);
    if (x === now && dir) x = next(data[0]?.pts ?? [], now, dir as 1 | -1);     // a step shorter than its points'
    if (x == null || (dir && place(edge, x) == null)) return;
    startMove(edge, x);
  };

  const tipLeft = hover && geo ? geo.X(hover.x) : 0;
  return (
    <div ref={box} className="relative w-full overflow-hidden select-none" style={{ height }}>
      {width == null ? null : !geo ? (
        <div className="grid h-full place-items-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <svg width={w} height={height} role="img" aria-label={label} className="block">
          <g className="text-[11px] tabular-nums">
            {geo.yTicks.map((t) => (
              <g key={t.v}>
                <line x1={M.left} x2={w - M.right} y1={geo.Y(t.v)} y2={geo.Y(t.v)} className="stroke-border" />
                <text x={M.left - 6} y={geo.Y(t.v)} dy="0.32em" textAnchor="end" className="fill-muted-foreground">{t.text}</text>
              </g>
            ))}
            {geo.xTicks.map((v) => {
              const text = xFormat(v);
              // About 6.6 px a character: a label past the chart's right edge would be cut off.
              const x = Math.min(geo.X(v), w - 1 - text.length * 3.3);
              return (
                <text key={v} x={x} y={height - M.bottom + 16} textAnchor="middle" className="fill-muted-foreground">
                  {text}
                </text>
              );
            })}
            <text x={M.left + plotW / 2} y={height - 3} textAnchor="middle" className="fill-muted-foreground">{xLabel}</text>
          </g>
          <line x1={M.left} x2={w - M.right} y1={height - M.bottom} y2={height - M.bottom} className="stroke-border-strong" />
          {band && lo < geo.x1 && (() => {
            const x = geo.X(Math.max(lo, geo.x0));
            const x2 = geo.X(Math.min(hi, geo.x1));
            return (
              <g>
                <rect x={x} y={top} width={Math.max(0, x2 - x)} height={height - M.bottom - top}
                  className="fill-primary/10" />
                <text x={Math.min(x + 4, w - M.right - band.label.length * 6.6)} y={top - 4}
                  className="fill-muted-foreground text-[11px]">{band.label}</text>
              </g>
            );
          })()}
          {yFrom != null && (
            <defs>
              <clipPath id={clip}>
                <rect x={M.left - 4} y={top - 4} width={Math.max(0, plotW + 8)} height={Math.max(0, plotH + 8)} />
              </clipPath>
            </defs>
          )}
          <g clipPath={yFrom != null ? `url(#${clip})` : undefined}>
            {/* Dashed lines on top: where two runs are the same, both stay visible. */}
            {[...geo.paths].sort((a, b) => Number(Boolean(a.s.dashed)) - Number(Boolean(b.s.dashed))).map(({ s, d }) => (
              <path key={s.name} d={d} fill="none" className={s.stroke} strokeWidth={1.75} strokeLinejoin="round"
                strokeDasharray={s.dashed ? "5 4" : undefined} />
            ))}
            {hover && (
              <g aria-hidden>
                <line x1={geo.X(hover.x)} x2={geo.X(hover.x)} y1={top} y2={height - M.bottom} className="stroke-border-strong" />
                {hover.at.map(({ s, p }) => p && (
                  <circle key={s.name} cx={geo.X(p[0])} cy={geo.Y(p[1])} r={3.5} className={cn(s.stroke, "fill-surface")} strokeWidth={2} />
                ))}
              </g>
            )}
          </g>
          <rect x={M.left} y={top} width={Math.max(0, plotW)} height={Math.max(0, plotH)} fill="transparent"
            className="touch-pan-y" onPointerMove={onPointer} onPointerDown={onPointer} onPointerLeave={() => setHoverX(null)} />
          {/* The band's edges, over the read-out's area so they take the pointer: each a slider. */}
          {band?.onChange && ([["from", lo], ["to", hi]] as const).map(([edge, at]) => {
            const x = geo.X(Math.min(geo.x1, Math.max(geo.x0, at)));
            return (
              <g key={edge} role="slider" tabIndex={0} aria-orientation="horizontal"
                aria-label={edge === "from" ? `Start of the ${band.label} part` : `End of the ${band.label} part`}
                aria-valuemin={geo.x0} aria-valuemax={geo.x1} aria-valuenow={at} aria-valuetext={xFormat(at)}
                className="group cursor-ew-resize touch-none outline-none"
                onKeyDown={(e) => onEdgeKey(edge, e)}
                onKeyUp={() => letGo(edge)}
                onBlur={() => letGo(edge)}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  startMove(edge, at);
                }}
                onPointerMove={(e) => {
                  if (move?.edge !== edge || move.done || !(e.buttons & 1)) return;
                  const p = xOf(e.clientX, e.currentTarget.closest("svg")?.getBoundingClientRect());
                  const to = p == null ? null : place(edge, p);
                  if (to != null) startMove(edge, to);
                }}
                onPointerUp={() => letGo(edge)}>
                <rect x={x - 8} y={top} width={16} height={Math.max(0, plotH)} fill="transparent" />
                {/* in the text colour over a halo of the surface's, so it stands out from lines of any colour */}
                <line x1={x} x2={x} y1={top} y2={height - M.bottom} strokeWidth={4} className="stroke-surface" />
                <line x1={x} x2={x} y1={top} y2={height - M.bottom} strokeWidth={1.5} className="stroke-foreground" />
                <rect x={x - 4} y={top + plotH / 2 - 11} width={8} height={22} rx={3} strokeWidth={2}
                  className="fill-foreground stroke-surface" />
                <rect x={x - 7} y={top + plotH / 2 - 14} width={14} height={28} rx={5} fill="none" strokeWidth={2}
                  className="hidden stroke-primary group-focus-visible:block" />
              </g>
            );
          })}
        </svg>
      )}
      {hover && geo && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-pop"
          style={tipLeft > w - 180 ? { right: w - tipLeft + 10 } : { left: tipLeft + 10 }}
        >
          <p className="font-medium">{xLabel} {xFormat(hover.x)}</p>
          {hover.at.map(({ s, p }) => (
            <p key={s.name} className="mt-1 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className={cn("size-2 rounded-full", s.swatch)} /> {s.name}
              </span>
              <span className="tabular-nums">{p ? formatNumber(p[1], 3) : "–"}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
