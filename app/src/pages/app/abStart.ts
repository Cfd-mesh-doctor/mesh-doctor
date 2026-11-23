// SPDX-License-Identifier: GPL-3.0-or-later
// The A/B test dialogs' sums: which repair runs can be tested, the name a test gets, where its second run has got
// to, and how long its runs take on the engine's computer, from the size estimator's time model.
import { isPlainName } from "@/engine/commands";
import type { AbtestDetail, MachineInfo, RepairSummary } from "@/engine/types";
import { caseName } from "@/engine/verdict";
import { RANK_SECONDS } from "@/estimate/estimate";
import { machineFields } from "@/estimate/machine";
import { formatInt } from "@/lib/format";

/** Each run's iterations, as the engine takes them (200 unless asked), and how far a continuation may go. */
export const AB_ITERS = { min: 20, max: 2000, initial: 200 } as const;
export const AB_EXTEND_MAX = 5000;
/** The solver ranks an A/B test's runs use: the command's own number, as the app doesn't set one. */
export const AB_RANKS = 6;

export type AbInit = "auto" | "0.warm" | "0.cold" | "0";
/** The case's folders both runs can start from, as the engine takes them. */
export const AB_INITS: readonly { value: AbInit; label: string }[] = [
  { value: "auto", label: "auto (0.warm, else 0)" },
  { value: "0.warm", label: "0.warm" },
  { value: "0.cold", label: "0.cold" },
  { value: "0", label: "0" },
];

/** The repair runs an A/B test can start from: finished, with a source case the engine finds by its folder's name. */
export function testableRuns(runs: readonly RepairSummary[] | undefined): RepairSummary[] {
  return (runs ?? []).filter((r) => r.finished && r.verdict && isPlainName(caseName(r.source) ?? ""));
}

/** The name the engine gives an A/B test of run `run`: the run's own on the repaired mesh; `<case>_<variant>` for
 * the original mesh with other solver settings, a test of the settings rather than of the repair. */
export function abTestName(run: RepairSummary, variant: string): string {
  return variant ? `${caseName(run.source) ?? ""}_${variant}` : run.name;
}

/** A whole number typed in a field, or null. */
export function wholeNumber(text: string): number | null {
  const t = text.trim();
  return /^\d{1,6}$/.test(t) ? Number(t) : null;
}

/** What's wrong with the iterations typed, or null when the engine takes them. */
export function itersProblem(text: string): string | null {
  const n = wholeNumber(text);
  return n == null || n < AB_ITERS.min || n > AB_ITERS.max
    ? `A whole number from ${AB_ITERS.min} to ${formatInt(AB_ITERS.max)}.` : null;
}

/** What's wrong with the iteration a continuation is to reach, or null: past `at`, where the run is now, and at most
 * 5000. */
export function targetProblem(text: string, at: number): string | null {
  const n = wholeNumber(text);
  return n == null || n <= at || n > AB_EXTEND_MAX
    ? `A whole number from ${formatInt(at + 1)} to ${formatInt(AB_EXTEND_MAX)}.` : null;
}

/** The solver ranks a run gets on the engine's computer: the command's 6, or its cores when it has fewer. */
export function abRanks(machine: MachineInfo | undefined): number {
  const cores = machine ? machineFields(machine).cores : undefined;
  return Math.min(AB_RANKS, cores ?? AB_RANKS);
}

/**
 * Seconds a run of `iterations` takes on a mesh of `cells` cells: at `pace` seconds an iteration when one was
 * measured (a test's own run), else the size estimator's laptop-class time on the ranks the run gets. Null when the
 * mesh's size isn't known.
 */
export function runSeconds(
  cells: number | null,
  iterations: number,
  machine: MachineInfo | undefined,
  pace?: number | null,
): number | null {
  if (!(iterations > 0)) return null;
  if (pace != null && pace > 0) return pace * iterations;
  if (cells == null || !(cells > 0)) return null;
  return (RANK_SECONDS.laptop * (cells / 1e6) * iterations) / abRanks(machine);
}

type AbResult = NonNullable<AbtestDetail["result"]>;

/**
 * The iteration an A/B test's second run has reached: where its last continuation ended, else the test's own
 * iterations, or further when its residuals go further (a continuation stopped part way). Null while that run
 * hasn't ended.
 */
export function secondRunAt(result: AbResult | null | undefined, lastSeen: number | null): number | null {
  if (!result?.fixed) return null;
  const ends = [result.iters, ...(result.extensions ?? []).map((e) => e.to), lastSeen]
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return ends.length ? Math.max(...ends) : null;
}

/** Where a continuation goes unless told: as far again as the test's runs went, at most 5000. */
export function extendTarget(at: number, iters: number | null | undefined): number {
  return Math.min(AB_EXTEND_MAX, Math.floor(at) + Math.max(iters ?? AB_ITERS.initial, AB_ITERS.min));
}
