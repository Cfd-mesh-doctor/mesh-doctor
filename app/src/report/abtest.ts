// SPDX-License-Identifier: GPL-3.0-or-later
// An A/B test as the A/B tests screens show it: what it is doing, its step in words, its outcome, and each run's
// residuals for the chart. The table, chart and judge are the report viewer's (summary.ts); here they come from the
// engine's answer, which gives each run's residuals as a table of rows (live) instead of the report's history.
import { isActive, type AbtestBrief, type AbtestDetail, type Job, type ResidualTable } from "@/engine/types";
import { toMillis } from "@/lib/format";
import { geomean, ratioChange, type Change, type HistoryRun } from "./summary";

/** What an A/B test is doing. changed: finished, but its source case changed while it ran. unfinished: not done and
 * no job says why (one started in a terminal, still running or stopped). */
export type AbState = "running" | "done" | "changed" | "failed" | "cancelled" | "unfinished";

/** The newest A/B job, a test or a continuation, for a test (the engine lists jobs newest first); none for one run in
 * a terminal. */
export function abJobOf(jobs: readonly Job[] | undefined, name: string): Job | undefined {
  return jobs?.find((j) => (j.kind === "abtest" || j.kind === "abextend") && j.name === name);
}

/** Its job's word while that is queued or running, else its own step's once done, else its job's if that failed or
 * was cancelled. A continuation that failed leaves a finished test's result as it was: it shows as failed all the
 * same, since its run stopped part way. */
export function abState(step: string | null | undefined, job: Job | undefined): AbState {
  if (job && isActive(job.state)) return "running";
  if (job?.state === "failed") return "failed";
  if (job?.state === "cancelled") return "cancelled";
  if (step?.startsWith("done")) return step === "done" ? "done" : "changed";
  return "unfinished";
}

const STEP: Record<string, string> = {
  "copying base": "Copying the case for the original mesh",
  "solving base": "Solving on the original mesh",
  "copying fixed": "Copying the case for the repaired mesh",
  "solving fixed": "Solving on the repaired mesh",
  "hotspots base": "Mapping where the original mesh's residuals are largest",
  "hotspots fixed": "Mapping where the repaired mesh's residuals are largest",
  done: "Finished",
};

/** An A/B test's step (its ab_status.json) in words. */
export function stepText(step: string | null | undefined): string | null {
  if (!step) return null;
  const known = STEP[step];
  if (known) return known;
  const go = /^extending fixed (\S+) -> (\d+)(?: with (\S+))?$/.exec(step);
  if (go) {
    const from = Number(go[1]);
    return `Continuing the repaired-mesh run from iteration ${Number.isFinite(from) ? from : go[1]} to ${go[2]}${
      go[3] ? ` with ${go[3]} settings` : ""}`;
  }
  if (step.startsWith("done")) return "Finished, but the source case changed during the test";
  return step;
}

/** Which run a step is in: the original mesh's, the repaired mesh's (its continuations too), or neither. */
export function stepSide(step: string | null | undefined): "base" | "fixed" | null {
  if (!step) return null;
  if (/^(copying|solving|hotspots) base$/.test(step)) return "base";
  if (/^(copying|solving|hotspots) fixed$/.test(step) || step.startsWith("extending fixed")) return "fixed";
  return null;
}

/** The outcome: the fields' residual ratios, repaired ÷ original, as one geometric mean, and whether that is better. */
export function outcome(ratios: Record<string, number> | null | undefined): { ratio: number; change: Change } | null {
  const g = geomean(Object.values(ratios ?? {}).filter((r) => Number.isFinite(r) && r > 0));
  return g == null ? null : { ratio: g, change: ratioChange(g) };
}

/** The outcome in a few words, for a list. */
export function outcomeText(o: { change: Change } | null): string {
  if (!o) return "";
  return o.change === "better" ? "helped" : o.change === "worse" ? "worse" : "about the same";
}

/** A run's residual table as the chart takes it: its iterations and each field's residual at each. */
export function tableRun(t: Partial<ResidualTable> | null | undefined): HistoryRun | null {
  const cols = t?.cols ?? [], rows = t?.rows ?? [];
  const at = cols.indexOf("Time");
  if (at < 0 || !rows.length) return null;
  const value = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const y: HistoryRun["y"] = {};
  cols.forEach((c, i) => {
    if (i !== at) y[c] = rows.map((r) => value(r[i]));
  });
  return { x: rows.map((r) => value(r[at]) ?? NaN), y };
}

/** Both runs' residuals for the residual chart, the fields in the order the runs list them. */
export function liveHistory(live: AbtestDetail["live"]): { fields: string[]; original: HistoryRun | null; repaired: HistoryRun | null } {
  const original = tableRun(live.base), repaired = tableRun(live.fixed);
  const fields = [...new Set([...Object.keys(original?.y ?? {}), ...Object.keys(repaired?.y ?? {})])];
  return { fields, original, repaired };
}

/** Where a run's residuals end: its last iteration, or null before it has any. */
export function lastIteration(run: HistoryRun | null): number | null {
  const xs = run?.x.filter(Number.isFinite) ?? [];
  return xs.length ? Math.max(...xs) : null;
}

/** One row of the A/B tests list. */
export interface AbRowView {
  name: string;
  state: AbState;
  job: Job | undefined;
  step: string | null;
  /** When its last step began, or when it finished. */
  when: string | null;
  finished: string | null;
  outcome: ReturnType<typeof outcome>;
  caseName: string | null;
}

/** The list's rows: tests that run first, then the newest. A test the engine says nothing about (an engine before
 * API 1.3) has its job's state alone, and keeps its place by name. */
export function abRows(names: readonly string[], tests: Record<string, AbtestBrief> | undefined, jobs: readonly Job[] | undefined,
  cases: ReadonlyMap<string, string | null>): AbRowView[] {
  const rows = names.map((name): AbRowView => {
    const t = tests?.[name], job = abJobOf(jobs, name);
    const step = t?.step ?? null;
    return {
      name,
      state: abState(step, job),
      job,
      step,
      when: t?.updated ?? t?.finished ?? job?.finished ?? job?.started ?? null,
      finished: t?.finished ?? null,
      outcome: outcome(t?.ratios),
      caseName: cases.get(name) ?? null,
    };
  });
  const time = (r: AbRowView) => {
    const t = toMillis(r.when);
    return Number.isFinite(t) ? t : -Infinity;
  };
  return rows.sort((a, b) => Number(b.state === "running") - Number(a.state === "running") || time(b) - time(a));
}
