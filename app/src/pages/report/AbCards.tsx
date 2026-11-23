// SPDX-License-Identifier: GPL-3.0-or-later
// The A/B test's cards, shared by the report viewer and the app's A/B tests screens: did the repair, or other solver
// settings, help the solver (each field's residuals in both runs), both runs' residuals per iteration, and the
// judge's verdict on a run. A test of solver settings names its runs by their settings, both on the original mesh.
import { useMemo, useState, type ReactNode } from "react";
import { LineChart, type LineSeries } from "@/components/charts/LineChart";
import { withVariant } from "@/components/shared/withVariant";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDateTime, formatInt, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { abWords } from "@/report/abtest";
import { judgeTone, ratioChange, type JudgeSummary, type ReportSummary } from "@/report/summary";
import { changeText } from "./tone";

export type AbSummary = NonNullable<ReportSummary["ab"]>;
export type AbHistory = AbSummary["history"];

/** The ratio as a bar about 1×. Narrower on a phone, where the table would otherwise scroll sideways. */
function RatioBar({ ratio }: { ratio: number }) {
  const w = Math.min(50, Math.abs(ratio - 1) * 100);
  const c = ratioChange(ratio);
  return (
    <span className="relative ml-2 inline-block h-2 w-14 rounded-full bg-surface-2 align-middle ring-1 ring-border ring-inset sm:w-24" aria-hidden>
      <span
        className={cn("absolute inset-y-0 rounded-full", c === "better" ? "bg-success" : c === "worse" ? "bg-danger" : "bg-muted-foreground")}
        style={{ left: `${ratio < 1 ? 50 - w : 50}%`, width: `${w}%` }}
      />
      <span className="absolute -inset-y-0.5 left-1/2 w-px bg-muted-foreground" />
    </span>
  );
}

/** The table's cells: closer together on a phone, so its four columns fit without scrolling sideways. */
const CELL = "px-3 sm:px-4";

/** Did the repair, or the other settings, help the solver: each field's mean residual in both runs and their ratio. */
export function AbCard({ ab }: { ab: AbSummary }) {
  const spi = ab.secondsPerIteration;
  const v = ab.settings;
  const heads = v ? ["Case's settings", `${v} settings`, `${v} ÷ case's`] : ["Original", "Repaired", "Repaired ÷ original"];
  // A test of a repair whose second run changes settings too, as the command allows, says so.
  const same = v ? "with the same case, mesh and start for both settings"
    : ab.variant ? `with the same case and start on both meshes, the second run with ${ab.variant} settings`
      : "with the same case, settings and start on both meshes";
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Did it help the solver?</CardTitle>
          <CardDescription>
            {withVariant([...ab.meta, ab.finished && `finished ${formatDateTime(ab.finished)}`].filter(Boolean).join(" · "), v ?? ab.variant)}
          </CardDescription>
        </div>
      </CardHeader>
      {ab.rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">The A/B test has no residuals to compare yet.</p>
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH className={CELL}>Field</TH>
              {/* A head may take two lines, so the table needs less room on a phone. */}
              {heads.map((h) => <TH key={h} className={cn(CELL, "text-right whitespace-normal")}>{withVariant(h, v)}</TH>)}
            </TR>
          </THead>
          <TBody>
            {ab.rows.map((row) => (
              <TR key={row.field}>
                <TD className={cn(CELL, "font-mono text-[13px]")}>{row.field}</TD>
                <TD className={cn(CELL, "text-right whitespace-nowrap tabular-nums")}>{formatNumber(row.original, 3)}</TD>
                <TD className={cn(CELL, "text-right whitespace-nowrap tabular-nums")}>{formatNumber(row.repaired, 3)}</TD>
                <TD className={cn(CELL, "text-right whitespace-nowrap tabular-nums", changeText(row.change))}>
                  {row.ratio.toFixed(2)}×<RatioBar ratio={row.ratio} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
        Mean initial residual over {ab.window ? `the last ${formatInt(ab.window)} iterations` : "the end of each run"},{" "}
        {withVariant(same, v ?? ab.variant)}.{" "}
        {withVariant(v ? `Below 1× the ${v} settings converge further.` : "Below 1× the repaired mesh converges further.", v)}
        {spi && (v
          ? withVariant(` Time per iteration: ${spi.original.toFixed(2)} s with the case's settings, ${spi.repaired.toFixed(2)} s with ${v}.`, v)
          : ` Time per iteration: ${spi.original.toFixed(2)} s original, ${spi.repaired.toFixed(2)} s repaired.`)}
      </p>
    </Card>
  );
}

function LegendLine({ dashed, className, children }: { dashed?: boolean; className: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="4" aria-hidden>
        <line x1="0" y1="2" x2="18" y2="2" strokeWidth="2" className={className} strokeDasharray={dashed ? "4 3" : undefined} />
      </svg>
      {children}
    </span>
  );
}

/** Both runs' initial residuals per iteration, one field at a time. `settings`: the variant of a test of solver
 * settings, whose runs are named by their settings. */
export function ResidualCard({ history, settings, className = "mt-4" }: {
  history: AbHistory;
  settings?: string | null;
  className?: string;
}) {
  const { fields, original, repaired } = history;
  const w = abWords(settings);
  const [field, setField] = useState(() => (fields.includes("p") ? "p" : fields.includes("p_rgh") ? "p_rgh" : (fields[0] ?? "")));
  // The first run (the original mesh, the case's settings) is the reference: dark ink, dashed, as the accuracy
  // chart's wind-tunnel tick. Against the second run's teal, the grey it had was too close to tell apart (OKLab
  // difference 8.3, and 3.2 with red-green colour blindness, against a floor of 15); ink is 32 in the light theme and
  // 21 in the dark one.
  const series = useMemo(() => {
    const out: LineSeries[] = [];
    if (original) out.push({ name: w.first, stroke: "stroke-foreground", swatch: "bg-foreground", dashed: true, x: original.x, y: original.y[field] ?? [] });
    if (repaired) out.push({ name: w.second, stroke: "stroke-primary", swatch: "bg-primary", x: repaired.x, y: repaired.y[field] ?? [] });
    return out;
  }, [original, repaired, field, w.first, w.second]);
  return (
    <Card className={className}>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>{withVariant(w.vs, settings)}</CardTitle>
          <CardDescription>Initial residual per iteration, log scale: lower and still falling is better.</CardDescription>
        </div>
        {fields.length > 1 && (
          <Segmented label="Field" value={field} onChange={setField}
            options={fields.map((f) => ({ value: f, label: <span className="font-mono">{f}</span> }))} />
        )}
      </CardHeader>
      <CardContent>
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {original && <LegendLine dashed className="stroke-foreground">{withVariant(w.first, settings)}</LegendLine>}
          {repaired && <LegendLine className="stroke-primary">{withVariant(w.second, settings)}</LegendLine>}
        </div>
        <LineChart series={series} log xLabel="iteration" empty="No residuals for this field"
          label={`Initial residual of ${field} per iteration ${w.both}, log scale`} />
      </CardContent>
    </Card>
  );
}

/** The judge's verdict on one run, its averaged forces and its notes. `title` names the run it judged. */
export function JudgeCard({ judge, title = "Is the repaired-mesh run converged?", className = "mt-4" }: {
  judge: JudgeSummary;
  title?: ReactNode;
  className?: string;
}) {
  const over = judge.window == null ? null : `${formatInt(judge.window)} ${judge.transient ? "time steps" : "iterations"}`;
  return (
    <Card className={className}>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            {[over && `Judged over the last ${over}`, judge.flow && `flow along ${judge.flow}`, judge.up && `${judge.up} up`]
              .filter(Boolean).join(", ")}
          </CardDescription>
        </div>
        <Badge tone={judgeTone(judge.verdict)} className="whitespace-normal">{judge.verdict}</Badge>
      </CardHeader>
      {judge.averages.length > 0 && (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Average ({judge.group})</TH>
              <TH className="text-right">Mean</TH>
              <TH className="text-right">Uncertainty</TH>
            </TR>
          </THead>
          <TBody>
            {judge.averages.map((a) => (
              <TR key={a.name}>
                <TD className="font-mono text-[13px]">{a.name}</TD>
                <TD className="text-right tabular-nums">{formatNumber(a.mean)}</TD>
                <TD className="text-right tabular-nums">{a.u == null ? "–" : `± ${formatNumber(a.u, 2)}`}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {judge.flags.length > 0 && (
        <ul className="list-disc space-y-1 border-t border-border py-3 pr-5 pl-9 text-[13px] text-muted-foreground">
          {judge.flags.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}
    </Card>
  );
}
