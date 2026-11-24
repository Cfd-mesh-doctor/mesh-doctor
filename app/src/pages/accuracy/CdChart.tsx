// SPDX-License-Identifier: GPL-3.0-or-later
// The drag coefficient of each validation case against the wind tunnel's: a dot for the Mesh Doctor run, a dark
// tick for the wind tunnel (a reference, like a target mark, not a second coloured series), and a line for the
// gap. Pointing at or tapping a case gives all its numbers; the table under the chart is the same data as text.
import { TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Case } from "./results";

const M = { top: 4, right: 14, bottom: 34, left: 14 };
const ROW = 50; // per case: its label line, then its track
const TRACK = 32; // the track's height within the row
const STEP = 0.05;

/** The axis: 0.2 to 0.45, which the accuracy check's cases need, and wider by steps of 0.05 for a case outside it
 * (an install whose answer is far off). */
function axis(cases: readonly Case[]): { domain: [number, number]; ticks: number[] } {
  const all = cases.flatMap((c) => [c.cd, c.tunnel]).filter(Number.isFinite);
  const lo = Math.min(0.2, Math.floor(Math.min(...all) / STEP + 1e-9) * STEP);
  const hi = Math.max(0.45, Math.ceil(Math.max(...all) / STEP - 1e-9) * STEP);
  const ticks: number[] = [];
  for (let i = 0; lo + i * STEP <= hi + 1e-9; i++) ticks.push(Number((lo + i * STEP).toFixed(2)));
  return { domain: [lo, hi], ticks };
}

export function CdChart({ cases }: { cases: Case[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = (w: number) => setWidth(w > 0 ? Math.max(220, Math.round(w)) : 640); // 0: no layout (tests)
    measure(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => measure(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const w = width ?? 640;
  const height = M.top + cases.length * ROW + M.bottom;
  const { domain: [lo, hi], ticks } = axis(cases);
  const X = (v: number) => M.left + ((v - lo) / (hi - lo)) * (w - M.left - M.right);
  const label = "Drag coefficient of each case, the Mesh Doctor run against the wind tunnel: " +
    cases.map((c) => `${c.name}, ${c.cd.toFixed(3)} against ${c.tunnel} (${c.difference})`).join("; ") + ".";
  const a = active == null ? undefined : cases[active];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-primary" />Mesh Doctor run</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 rounded-full bg-foreground" />Wind tunnel</span>
      </div>
      <div ref={box} className="relative w-full touch-pan-y select-none" style={{ height }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") setActive(null); }}>
        {width != null && (
          <>
            <svg width={w} height={height} role="img" aria-label={label} className="block">
              <g className="text-[11px] tabular-nums">
                {ticks.map((t) => (
                  <g key={t}>
                    <line x1={X(t)} x2={X(t)} y1={M.top} y2={height - M.bottom} className="stroke-border" />
                    <text x={X(t)} y={height - M.bottom + 16} textAnchor="middle" className="fill-muted-foreground">{t.toFixed(2)}</text>
                  </g>
                ))}
                <text x={M.left + (w - M.left - M.right) / 2} y={height - 3} textAnchor="middle" className="fill-muted-foreground">
                  drag coefficient Cd
                </text>
              </g>
              {cases.map((c, i) => {
                const y0 = M.top + i * ROW, ty = y0 + ROW - TRACK / 2;
                const xs = X(c.cd), xt = X(c.tunnel);
                return (
                  <g key={c.name}>
                    <rect x={0} y={y0} width={w} height={ROW} rx={6} className={active === i ? "fill-surface-2/60" : "fill-transparent"} />
                    <line x1={xt} x2={xs} y1={ty} y2={ty} className="stroke-muted-foreground" strokeWidth={2} strokeLinecap="round" />
                    <line x1={xt} x2={xt} y1={ty - 8} y2={ty + 8} className="stroke-foreground" strokeWidth={2} strokeLinecap="round" />
                    <circle cx={xs} cy={ty} r={5} className="fill-primary stroke-surface" strokeWidth={2} />
                    <rect data-row={i} x={0} y={y0} width={w} height={ROW} fill="transparent"
                      onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)} />
                  </g>
                );
              })}
            </svg>
            {cases.map((c, i) => (
              <div key={c.name} aria-hidden className="pointer-events-none absolute flex items-center justify-between gap-2 text-[12.5px]"
                style={{ top: M.top + i * ROW + 2, left: M.left, right: M.right }}>
                <span className="min-w-0 truncate font-medium">
                  {c.name}<span className="font-normal text-muted-foreground max-[400px]:hidden"> · {c.cells}</span>
                </span>
                <span className={cn("inline-flex shrink-0 items-center gap-1 tabular-nums", c.miss && "font-medium")}>
                  {c.miss && <TriangleAlert className="size-3.5 text-warning" />}
                  {c.difference}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
      <p aria-hidden className="mt-2 min-h-10 text-[13px] text-muted-foreground">
        {a ? (
          <>
            <span className="font-medium text-foreground">{a.name}</span> ({a.cells} cells): Cd {a.cd.toFixed(3)} against{" "}
            {a.tunnel} in the wind tunnel, {a.difference}. Lift Cl {a.cl.toFixed(3)}; drift over the last {a.window ?? 500}{" "}
            iterations {a.drift}{a.time && <>; solved in {a.time}</>}.
            {a.miss && " Steady RANS keeps the flow on the slant here, while in the tunnel it separates."}
          </>
        ) : "Point at a case, or tap it, for all its numbers."}
      </p>
    </div>
  );
}
