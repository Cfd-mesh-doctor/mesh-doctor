// SPDX-License-Identifier: GPL-3.0-or-later
// A case's force charts, on its results page (GET /results/{case}/forces, API 1.24): a force group's drag and its
// downforce or lift over the whole run, a chart each with one axis, and the averaging window shaded on both. Its
// edges can be dragged, or moved with the arrow keys, to average over another, which the page keeps in its address
// as From and To do. Each chart's scale fits the forces after the run's first tenth, as a run starts far from where
// it settles. The total group's by default; a picker gives another's where there are more.
import { useId, useState } from "react";
import { LineChart, type Band } from "@/components/charts/LineChart";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { asEngineError } from "@/engine/errors";
import { useForceHistory } from "@/engine/hooks";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FIELD } from "./dialogParts";
import { timeNumber } from "./solveStart";

/** The part of a run its numbers are averaged over: after `from`, up to `to` (null: to the end). */
export interface ChartWindow {
  from: number;
  to: number | null;
}

export function ForceCharts({ name, window: w, onWindow, className }: {
  name: string;
  /** the window to shade, or null where it isn't known */
  window: ChartWindow | null;
  /** asks for the window where its edges were let go */
  onWindow?: (from: number, to: number | null) => void;
  className?: string;
}) {
  const id = useId();
  const q = useForceHistory(name);
  const [picked, setPicked] = useState<string | null>(null);

  if (q.isPending) {
    return (
      <Card className={cn("mb-4 p-5", className)}>
        <p role="status" className="text-sm text-muted-foreground">Reading its force history…</p>
      </Card>
    );
  }
  if (q.isError) {
    const e = asEngineError(q.error);
    if (e.code === "not-found" && e.message.startsWith("no such API route")) {
      return (
        <Card className={cn("mb-4 p-5", className)}>
          <p className="text-sm font-semibold">Your engine can&apos;t chart its forces yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It is older than the force charts (it speaks API 1.23). Update Mesh Doctor on your computer, then see each
            force over the whole run here, and move the averaging window by dragging its edges.
          </p>
        </Card>
      );
    }
    // No such case, no forces yet, or not in the demo: the page says so itself.
    if (e.code === "not-found" || e.code === "not-ready" || e.code === "unavailable") return null;
    return (
      <ErrorPanel compact className={cn("mb-4", className)} error={q.error} onRetry={() => void q.refetch()}
        retrying={q.isFetching} />
    );
  }

  const doc = q.data;
  const g = doc.groups.find((x) => x.name === picked) ?? doc.groups[0];
  if (!g) return null;
  const word = doc.vertical === "downforce" ? "Downforce" : "Lift";
  const band: Band | undefined = w ? { from: w.from, to: w.to, label: "averaged", onChange: onWindow } : undefined;
  const [t0, t1] = [g.t[0], g.t.at(-1)];
  const yFrom = t0 != null && t1 != null && t1 > t0 ? t0 + (t1 - t0) / 10 : undefined;
  const chart = (what: string, y: readonly (number | null)[]) => (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-sm font-medium">{what} (N)</figcaption>
      <LineChart height={220} label={`${what} of ${g.name} over the run, in N`} band={band} yFrom={yFrom}
        xLabel={doc.transient ? "time (s)" : "iteration"} xFormat={doc.transient ? timeNumber : formatInt}
        empty={`No ${what.toLowerCase()} written`}
        series={[{ name: what, stroke: "stroke-primary", swatch: "bg-primary", x: g.t, y }]} />
    </figure>
  );
  return (
    <Card className={cn("mb-4", className)}>
      <CardHeader className="block">
        <CardTitle>Forces over the run</CardTitle>
        <CardDescription>
          {g.total ? "The total group's" : `The ${g.name} group's`} drag and {word.toLowerCase()} over the whole run, in
          N.{w && (onWindow
            ? " The shaded part is the averaging window: drag its edges, or move them with the arrow keys, to average "
              + "over another."
            : " The shaded part is the averaging window.")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {doc.groups.length > 1 && (
          <div className="mb-4 max-w-xs space-y-1.5">
            <label htmlFor={`${id}-group`} className="block text-sm font-medium">Force group</label>
            <select id={`${id}-group`} className={FIELD} value={g.name} onChange={(e) => setPicked(e.target.value)}>
              {doc.groups.map((x) => (
                <option key={x.name} value={x.name}>{x.total ? `${x.name} (total)` : x.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-6 lg:grid-cols-2">
          {chart("Drag", g.drag)}
          {chart(word, g.vertical)}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Each chart&apos;s scale fits its forces after the run&apos;s first tenth: larger ones before it run off its
          edges.
          {g.n > g.t.length && ` Drawn from ${formatInt(g.t.length)} of its ${formatInt(g.n)} values: each stretch's `
            + "lowest and highest, so a swing or a spike still shows."}
        </p>
      </CardContent>
    </Card>
  );
}
