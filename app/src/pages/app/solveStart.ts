// SPDX-License-Identifier: GPL-3.0-or-later
// The solves of the cases Mesh Doctor made (API 1.6): the Solve screen's runs list, the Solve dialog's numbers and
// checks, a copy of a case you made (its name and the cases to pick from), and a run's step and state in plain words.
import { isPlainName } from "@/engine/commands";
import { isActive, type CaseList, type Job, type Made, type Run, type RunLive, type RunShown } from "@/engine/types";
import { formatInt } from "@/lib/format";

/** The iteration a first solve runs to: the solve job's own default. */
export const FIRST_TO = 2000;
/** The iterations a continuation adds, as suggested. */
export const MORE = 1000;
/** The furthest iteration the engine solves to (meshdoctor/solve.py's MAX_ITERS). */
export const MAX_TO = 100_000;
/** The processes a first solve is split over, at most, unless you pick more: the solve job's own default. */
export const DEFAULT_NP = 4;
/** The most processes the engine takes. */
export const MAX_NP = 64;

/** What the engine says when a case can't be solved from here because it predates the solve job (API 1.6). */
export const OLD_ENGINE_RUNS = "Your engine is older than this page and can't solve cases from here yet. Update Mesh "
  + "Doctor (`git pull` in its folder) and restart the engine.";

/** A solve's steps, as the engine names them (meshdoctor/solve.py), in plain words with the program at work. */
const SOLVE_STEPS: Record<string, string> = {
  copying: "Copying your case",
  decomposing: "Splitting the case (decomposePar)",
  potentialFoam: "Starting the flow (potentialFoam)",
  solving: "Solving (foamRun)",
  reconstructing: "Joining the split case (reconstructPar)",
  done: "Done",
};

/** A solve's step in plain words; one this app doesn't know reads as the engine says it. */
export function solveStep(step: string | null | undefined): string | null {
  return step ? (SOLVE_STEPS[step] ?? step) : null;
}

/** A run's state as the screens show it (RunShown). */
export function runShown(run: Pick<Run, "state"> | null | undefined, job: Job | undefined): RunShown {
  if (job?.state === "queued") return "queued";
  if (job?.state === "running") return "running";
  return run?.state ?? "unsolved";
}

/** The solve job of a case that waits or runs now, else its newest (the engine lists jobs newest first). */
export function solveJobOf(jobs: readonly Job[] | undefined, name: string): Job | undefined {
  const mine = jobs?.filter((j) => j.kind === "solve" && j.name === name) ?? [];
  return mine.find((j) => isActive(j.state)) ?? mine[0];
}

/** The run as its solve job has it now: until the job writes the run's status (a moment after it starts), the status
 * is an earlier stretch's, whose step and iterations say nothing of this one. */
export function current(run: Run | null | undefined, shown: RunShown): Run | null {
  return run && (shown !== "running" || run.state === "running") ? run : null;
}

/** How far the stretch a run is in has come, from where it started to where it runs to (0 to 1); undefined until
 * it says. */
export function stretchFraction(run: Pick<Run, "start" | "end" | "iteration">): number | undefined {
  const { start, end, iteration } = run;
  if (end == null || iteration == null || !(end > start)) return undefined;
  return Math.min(1, Math.max(0, (iteration - start) / (end - start)));
}

/** A run's stretches in a few words: "0 → 2,000, then 2,000 → 3,000". */
export function stretchesText(stretches: Run["stretches"]): string | null {
  if (!stretches.length) return null;
  return stretches.map((s) => `${formatInt(s.from)} → ${formatInt(s.to)}`).join(", then ");
}

/** What a case was made from, in a few words: "made from the ahmed-body template", or "a copy of wing". */
export function madeFrom(made: Made | null | undefined): string | null {
  if (made?.copyOf) return `a copy of ${made.copyOf}`;
  if (made?.template) return `made from the ${made.template} template`;
  return null;
}

/** What a solve job makes its case from: the case you made that it copies (its `source`), if it is a copy. */
export function madeOfJob(job: Job | undefined): Made | null {
  const source = job?.kind === "solve" ? job.params.source : undefined;
  return typeof source === "string" && source ? { copyOf: source } : null;
}

/** One line of the runs list: a case Mesh Doctor made, what from, its run once it has one, and its solve job. */
export interface RunRow {
  name: string;
  made: Made | null;
  run: Run | null;
  job: Job | undefined;
  shown: RunShown;
}

const ORDER: Record<RunShown, number> = {
  running: 0, queued: 0, interrupted: 1, stopped: 1, failed: 1, cancelled: 1, done: 1, unsolved: 2,
};

/** The runs list: every case Mesh Doctor made, with its run, any run of a case not listed (an older engine's cases
 * have no `made`), and any solve job waiting or running (a copy of yours is listed once it is made). Those solving or
 * waiting come first, then the ones solved, newest first, then the ones not solved yet, by name. */
export function runRows(made: Readonly<Record<string, Made>> | undefined, runs: readonly Run[] | undefined,
  jobs: readonly Job[] | undefined): RunRow[] {
  const working = (jobs ?? []).filter((j) => j.kind === "solve" && isActive(j.state)).map((j) => j.name);
  const names = new Set([...Object.keys(made ?? {}), ...(runs ?? []).map((r) => r.name), ...working]);
  const rows = [...names].map((name): RunRow => {
    const run = runs?.find((r) => r.name === name) ?? null;
    const job = solveJobOf(jobs, name);
    return { name, made: made?.[name] ?? madeOfJob(job), run, job, shown: runShown(run, job) };
  });
  return rows.sort((a, b) => ORDER[a.shown] - ORDER[b.shown]
    || (b.run?.updated ?? "").localeCompare(a.run?.updated ?? "")
    || a.name.localeCompare(b.name));
}

/** The cases you made: those in the cases folder Mesh Doctor didn't make, which it solves through a copy. */
export function yourCases(cases: Pick<CaseList, "items" | "made"> | undefined): string[] {
  return (cases?.items ?? []).filter((n) => !cases?.made?.[n]);
}

/** Names a copy can't take: every case's in the cases folder, every new case's (one that failed keeps its folder,
 * not listed), and every solve job's still waiting or running (a copy being made isn't listed yet). */
export function copyTaken(cases: readonly string[] | undefined, jobs: readonly Job[] | undefined): Set<string> {
  return new Set([...(cases ?? []), ...(jobs ?? [])
    .filter((j) => j.kind === "case" || (j.kind === "solve" && isActive(j.state))).map((j) => j.name)]);
}

/** A free name for a copy of a case you made: its name and -run ("wing-run"), then -run-2, -run-3… while taken. */
export function copyName(source: string, taken: ReadonlySet<string>): string {
  const base = `${source.slice(0, 80 - "-run-99".length)}-run`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** What's wrong with a copy's name, or null when the engine will take it: a new case's, never one there already. */
export function copyNameProblem(name: string, taken: ReadonlySet<string>): string | null {
  if (!name) return "Give the copy a name.";
  if (!isPlainName(name)) return "Use only letters, digits and _ . - (not . or - first), at most 80 characters.";
  if (taken.has(name)) return "A case with this name is in the cases folder already. Pick another name.";
  return null;
}

/** The iteration a solve is suggested to run to: 2,000 for a first one, else 1,000 past the latest written. */
export function suggestedTo(written: number): number {
  return written > 0 ? Math.min(MAX_TO, written + MORE) : FIRST_TO;
}

/** What's wrong with the iteration typed to solve to, or null when the engine will take it. */
export function toProblem(text: string, written: number): string | null {
  if (!/^\d{1,7}$/.test(text.trim())) return "Give a whole number of iterations.";
  const n = Number(text);
  if (n < 1 || n > MAX_TO) return `Give an iteration from 1 to ${formatInt(MAX_TO)}.`;
  if (n <= written) {
    return `Give one past ${formatInt(written)}, the latest iteration written: the solve continues from there.`;
  }
  return null;
}

/** The processes a first solve is suggested to run on: 4, or one per core on a computer with fewer. */
export function suggestedProcs(cores: number | undefined): number {
  return Math.max(1, Math.min(DEFAULT_NP, cores ?? DEFAULT_NP));
}

/** The process counts to pick from: 1 up to the computer's cores (8 when it doesn't say), and the suggestion. */
export function procChoices(cores: number | undefined): number[] {
  const top = Math.min(MAX_NP, Math.max(cores ?? 8, suggestedProcs(cores)));
  return Array.from({ length: top }, (_, i) => i + 1);
}

export type ForceRow = [iteration: number, drag: number, vertical: number];

/** A run's total force group (the engine's `forceInfo.total`: the group with the largest drag), its rows, and what
 * its vertical force is called (downforce or lift, by its sign). A case with no forces has no group and no rows. */
export function totalForces(live: Pick<RunLive, "forces" | "forceInfo">): {
  group: string | null; rows: ForceRow[]; vertical: "downforce" | "lift";
} {
  const info = live.forceInfo as { total?: unknown; vertical?: unknown };
  const group = typeof info.total === "string" && info.total ? info.total : null;
  const raw = group ? (live.forces as Record<string, unknown>)[group] : null;
  const rows = Array.isArray(raw)
    ? raw.filter((r): r is ForceRow => Array.isArray(r) && r.length >= 3 && r.slice(0, 3).every((v) => typeof v === "number"))
    : [];
  return { group, rows, vertical: info.vertical === "lift" ? "lift" : "downforce" };
}

/** The terminal command that does the same: `meshdoctor solve`, with --np for a first solve only (a continuation
 * keeps the run's own), and the case it copies first for a copy of yours. */
export function solveCommand(name: string, to: number, np: number | null, source?: string): string {
  return `meshdoctor solve ${source ? `${source} ` : ""}${name} --to ${to}${np == null ? "" : ` --np ${np}`}`;
}
