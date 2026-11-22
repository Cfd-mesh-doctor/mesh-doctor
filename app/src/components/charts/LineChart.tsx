// SPDX-License-Identifier: GPL-3.0-or-later
// A light SVG line chart for residual histories: log or linear y axis, round-number ticks, and a read-out
// on hover or touch. Long histories are thinned to two points per pixel column (each column's lowest and
// highest), so a run of 100k iterations draws as fast as a short one and keeps its spikes.
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
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

export function LineChart({ series, log = false, height = 260, xLabel = "x", label, empty = "Nothing to draw" }: {
  series: LineSeries[];
  log?: boolean;
  height?: number;
  xLabel?: string;
  /** what the chart shows, for screen readers */
  label: string;
  empty?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

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
  const plotW = w - M.left - M.right, plotH = height - M.top - M.bottom;
  const data = useMemo(() => series.map((s) => ({ s, pts: points(s, log) })), [series, log]);
  const geo = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const { pts } of data) {
      for (const [x, y] of pts) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
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
      Y = (y) => M.top + (1 - (Math.log10(y) - k0) / (k1 - k0)) * plotH;
    } else {
      const t = niceTicks(y0 === y1 ? y0 - 1 : y0, y0 === y1 ? y1 + 1 : y1, 5);
      const lo = Math.min(y0, t[0] ?? y0), hi = Math.max(y1, t[t.length - 1] ?? y1, lo + 1e-12);
      yTicks = t.map((v) => ({ v, text: formatNumber(v) }));
      Y = (y) => M.top + (1 - (y - lo) / (hi - lo)) * plotH;
    }
    const X = (x: number) => M.left + ((x - x0) / (x1 - x0)) * plotW;
    const columns = Math.max(50, Math.round(plotW));
    const paths = data.map(({ s, pts }) => ({
      s,
      d: thin(pts, columns).map(([x, y], i) => `${i ? "L" : "M"}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join(""),
    }));
    const xTicks = niceTicks(x0, x1, Math.max(2, Math.floor(plotW / 90)));
    return { x0, x1, X, Y, yTicks, xTicks, paths };
  }, [data, log, plotW, plotH]);

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
            {geo.xTicks.map((v) => (
              <text key={v} x={geo.X(v)} y={height - M.bottom + 16} textAnchor="middle" className="fill-muted-foreground">
                {formatNumber(v)}
              </text>
            ))}
            <text x={M.left + plotW / 2} y={height - 3} textAnchor="middle" className="fill-muted-foreground">{xLabel}</text>
          </g>
          <line x1={M.left} x2={w - M.right} y1={height - M.bottom} y2={height - M.bottom} className="stroke-border-strong" />
          {/* Dashed lines on top: where two runs are the same, both stay visible. */}
          {[...geo.paths].sort((a, b) => Number(Boolean(a.s.dashed)) - Number(Boolean(b.s.dashed))).map(({ s, d }) => (
            <path key={s.name} d={d} fill="none" className={s.stroke} strokeWidth={1.75} strokeLinejoin="round"
              strokeDasharray={s.dashed ? "5 4" : undefined} />
          ))}
          {hover && (
            <g aria-hidden>
              <line x1={geo.X(hover.x)} x2={geo.X(hover.x)} y1={M.top} y2={height - M.bottom} className="stroke-border-strong" />
              {hover.at.map(({ s, p }) => p && (
                <circle key={s.name} cx={geo.X(p[0])} cy={geo.Y(p[1])} r={3.5} className={cn(s.stroke, "fill-surface")} strokeWidth={2} />
              ))}
            </g>
          )}
          <rect x={M.left} y={M.top} width={Math.max(0, plotW)} height={Math.max(0, plotH)} fill="transparent"
            className="touch-pan-y" onPointerMove={onPointer} onPointerDown={onPointer} onPointerLeave={() => setHoverX(null)} />
        </svg>
      )}
      {hover && geo && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-pop"
          style={tipLeft > w - 180 ? { right: w - tipLeft + 10 } : { left: tipLeft + 10 }}
        >
          <p className="font-medium">{xLabel} {formatNumber(hover.x)}</p>
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
