// SPDX-License-Identifier: GPL-3.0-or-later
// An A/B test as the A/B tests screens show it: what it is doing, its step in words, its outcome, each run's
// residuals for the chart, and how its two runs are named: the original and the repaired mesh, or for a test of
// solver settings the case's settings and a variant's, both on the original mesh. The table, chart and judge are the
// report viewer's (summary.ts); here they come from the engine's answer, which gives each run's residuals as a table
// of rows (live) instead of the report's history.
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

type AbResult = NonNullable<AbtestDetail["result"]>;

/**
 * The variant (GET /variants) an A/B test tries in place of the case's own solver settings, both runs on the
 * original mesh: a test of the settings rather than of a repair. Null for a test of a repair. Its result says once it
 * has one: a variant and no repaired run (a test of a repair whose second run changes settings too, as the command
 * allows, is one of the repair). Else its A/B job's parameters do, as the engine starts a test of settings for a
 * variant; else its name, as the engine names one: `<case>_<variant>`, for a variant the engine has and a name that
 * is no repair run's.
 */
export function settingsOf(name: string, from: {
  result?: Pick<AbResult, "variant" | "fixedName"> | null;
  jobs?: readonly Job[];
  variants?: readonly { name: string }[];
  runs?: { has: (run: string) => boolean };
}): string | null {
  if (from.result) return from.result.variant && !from.result.fixedName ? from.result.variant : null;
  const job = from.jobs?.find((j) => j.kind === "abtest" && j.name === name);
  if (job) {
    const v = (job.params as Record<string, unknown> | undefined)?.variant;
    return typeof v === "string" && v ? v : null;
  }
  if (from.runs?.has(name)) return null;
  return from.variants?.find((v) => name.length > v.name.length + 1 && name.endsWith(`_${v.name}`))?.name ?? null;
}

/** How the screens name an A/B test's two runs. */
export interface AbWords {
  /** Each run in the residual chart's legend. */
  first: string;
  second: string;
  /** Each run in a sentence. */
  firstRun: string;
  secondRun: string;
  /** The residual chart's title, and both runs as its description for a screen reader ends. */
  vs: string;
  both: string;
}

/** The original mesh's run and the repaired mesh's; for a test of solver settings (`settings`, its variant), the run
 * with the case's settings and the one with the variant's. */
export function abWords(settings: string | null | undefined): AbWords {
  return settings ? {
    first: "case's settings",
    second: `${settings} settings`,
    firstRun: "the run with the case's settings",
    secondRun: `the run with ${settings} settings`,
    vs: `Residuals, the case's settings vs ${settings}`,
    both: `with the case's settings and with ${settings}`,
  } : {
    first: "original mesh",
    second: "repaired mesh",
    firstRun: "the original-mesh run",
    secondRun: "the repaired-mesh run",
    vs: "Residuals, original vs repaired mesh",
    both: "on the original and the repaired mesh",
  };
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

/** The steps of a test of solver settings, whose runs both solve the original mesh: the second with variant `v`'s. */
const SETTINGS_STEP = (v: string): Record<string, string> => ({
  "copying base": "Copying the case for the run with its own settings",
  "solving base": "Solving with the case's settings",
  "copying fixed": `Copying the case for the run with ${v} settings`,
  "solving fixed": `Solving with ${v} settings`,
  "hotspots base": "Mapping where the residuals are largest with the case's settings",
  "hotspots fixed": `Mapping where the residuals are largest with ${v} settings`,
});

/** An A/B test's step (its ab_status.json) in words; `settings` is the variant of a test of solver settings
 * (settingsOf). */
export function stepText(step: string | null | undefined, settings?: string | null): string | null {
  if (!step) return null;
  const known = (settings ? SETTINGS_STEP(settings)[step] : undefined) ?? STEP[step];
  if (known) return known;
  const go = /^extending fixed (\S+) -> (\d+)(?: with (\S+))?$/.exec(step);
  if (go) {
    const from = Number(go[1]);
    // A continuation keeps the second run's settings, and names other ones it changes to.
    return `Continuing ${abWords(settings).secondRun} from iteration ${Number.isFinite(from) ? from : go[1]} to ${go[2]}${
      go[3] && go[3] !== settings ? ` with ${go[3]} settings` : ""}`;
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
  /** The variant a test of solver settings tries (settingsOf), or null for a test of a repair. */
  settings: string | null;
}

/** The list's rows: tests that run first, then the newest. A test the engine says nothing about (an engine before
 * API 1.3) has its job's state alone, and keeps its place by name. `cases` has each repair run's case; a test of
 * solver settings has its case from its name, `<case>_<variant>` (the engine's `variants`). */
export function abRows(names: readonly string[], tests: Record<string, AbtestBrief> | undefined, jobs: readonly Job[] | undefined,
  cases: ReadonlyMap<string, string | null>, variants?: readonly { name: string }[]): AbRowView[] {
  const rows = names.map((name): AbRowView => {
    const t = tests?.[name], job = abJobOf(jobs, name);
    const step = t?.step ?? null;
    const settings = settingsOf(name, { jobs, variants, runs: cases });
    return {
      name,
      state: abState(step, job),
      job,
      step,
      when: t?.updated ?? t?.finished ?? job?.finished ?? job?.started ?? null,
      finished: t?.finished ?? null,
      outcome: outcome(t?.ratios),
      caseName: cases.get(name) ?? (settings && name.endsWith(`_${settings}`) ? name.slice(0, -settings.length - 1) : null),
      settings,
    };
  });
  const time = (r: AbRowView) => {
    const t = toMillis(r.when);
    return Number.isFinite(t) ? t : -Infinity;
  };
  return rows.sort((a, b) => Number(b.state === "running") - Number(a.state === "running") || time(b) - time(a));
}
