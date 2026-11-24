// SPDX-License-Identifier: GPL-3.0-or-later
// The solves of the cases Mesh Doctor made (API 1.6): the Solve screen's runs list, the Solve dialog's numbers and
// checks, a copy of a case you made (its name and the cases to pick from), and a run's step and state in plain words.
// A transient run (`transient`, the steady run it started from) counts time in s where a steady run counts iterations.
import { isPlainName } from "@/engine/commands";
import {
  isActive, type CaseList, type DiskInfo, type Job, type Made, type Run, type RunLive, type RunShown,
} from "@/engine/types";
import { formatInt } from "@/lib/format";
import { caseStep } from "./caseStart";

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
/** The times each stretch of a transient run writes unless asked, and the most it may (meshdoctor/transient.py's
 * WRITES and MAX_WRITES): it keeps every one (API 1.10). */
export const WRITES = 4;
export const MAX_WRITES = 200;

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

/** A solve's step in plain words; one this app doesn't know reads as the engine says it. A solve that makes its case
 * from a template first (Verify install) is meshing, then at the mesh's own step ("meshing: snappyHexMesh: refining"),
 * which reads as a new case's does. */
export function solveStep(step: string | null | undefined): string | null {
  if (!step) return null;
  if (step === "meshing") return "Making the case from its template";
  if (step.startsWith("meshing: ")) return caseStep(step.slice("meshing: ".length));
  return SOLVE_STEPS[step] ?? step;
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

const time4 = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 });

/** A time in s to 4 significant digits, without its unit: 0.0011 → "0.0011", 0.20875 → "0.2088". */
export function timeNumber(seconds: number): string {
  return time4.format(seconds);
}

/** A time in s as a transient run's pages say it: "0.0011 s". */
export function formatTime(seconds: number): string {
  return `${timeNumber(seconds)} s`;
}

/** A time in s to type in a field: to 6 significant digits, as OpenFOAM writes its times ("0.2088", never
 * "0.20880000000000001"). */
export function timeInput(seconds: number): string {
  return String(Number(seconds.toPrecision(6)));
}

/** Is it a transient run (API 1.6: `transient`, the steady run it started from), which counts time in s? */
export function isTransient(run: Pick<Run, "transient"> | null | undefined): boolean {
  return run?.transient != null;
}

/** Where a run is, or ended, in its own unit: "iteration 1,200", or a transient run's "0.0011 s". */
export function atText(n: number, transient: boolean): string {
  return transient ? formatTime(n) : `iteration ${formatInt(n)}`;
}

/** How far a stretch has come: "iteration 120 of 200", or a transient run's "0.0005 s of 0.0011 s". */
export function ofText(at: number, end: number, transient: boolean): string {
  return transient ? `${formatTime(at)} of ${formatTime(end)}` : `iteration ${formatInt(at)} of ${formatInt(end)}`;
}

/** A transient run's origin in words: "DDES at a largest Courant number of 1, from ahmed's iteration 300". */
export function transientText(t: NonNullable<Run["transient"]>): string {
  const at = t.at.trim() !== "" && Number.isInteger(Number(t.at)) ? `iteration ${formatInt(Number(t.at))}` : `time ${t.at}`;
  const how = [t.model, t.maxCo != null && `at a largest Courant number of ${t.maxCo}`].filter(Boolean).join(" ");
  return how ? `${how}, from ${t.steady}'s ${at}` : `From ${t.steady}'s ${at}`;
}

const AVERAGES = "its mean flow and how much it swings (UMean, pMean, UPrime2Mean, pPrime2Mean)";

/** What a transient run averages, in words (API 1.9's `averaging`: its mean flow and how much it swings, which the
 * solve switches on once its forces have settled, as it checks before each stretch and every half a minute as it
 * solves); null for a run without it (a steady run, or one an engine before API 1.9 made). */
export function averagingText(a: Run["averaging"], ended: boolean): string | null {
  if (!a) return null;
  if (a.from == null) {
    return ended
      ? "Its flow isn't averaged: it ended before averaging began, which waits for its forces to settle. Continue it, "
        + "and it averages once they have."
      : "It averages its flow once its forces have settled: they haven't yet.";
  }
  const settled = a.settled != null && formatTime(a.settled) !== formatTime(a.from) ? ` (at ${formatTime(a.settled)})` : "";
  const since = `Its flow is averaged from ${formatTime(a.from)}, once its forces had settled${settled}`;
  if (a.written != null) {
    return `${since}: each time it has written since holds ${AVERAGES}, the latest at ${formatTime(a.written)}.`;
  }
  return ended
    ? `${since}, but it ended before it wrote a time with the average in. Continue it, and each time it writes holds `
      + `${AVERAGES}.`
    : `${since}: each time it writes from now on holds ${AVERAGES}.`;
}

/** Does the engine take the times each stretch of a transient run writes (API 1.10's `writes`)? An older one writes
 * four and refuses the param, so the dialogs ask for it only then. */
export function takesWrites(apiVersion: string | null | undefined): boolean {
  const m = /^(\d+)\.(\d+)/.exec(apiVersion ?? "");
  return m != null && (Number(m[1]) > 1 || (Number(m[1]) === 1 && Number(m[2]) >= 10));
}

/** What is wrong with the times written as typed, or null: a whole number from 1 to MAX_WRITES. */
export function writesProblem(typed: string): string | null {
  const n = /^\d+$/.test(typed) ? Number(typed) : NaN;
  return n >= 1 && n <= MAX_WRITES ? null : `Give a whole number from 1 to ${MAX_WRITES}.`;
}

/** The times written, in words, under their field: how often over the stretch from `from` to `to` (when it is
 * known), and that each is kept. */
export function writesHint(writes: number, from: number, to: number | null): string {
  const often = to != null && to > from ? `Every ${formatTime((to - from) / writes)}` : "Evenly to the end";
  return `${often}, each kept: the flow at that time, with its mean once it averages it, for pictures of the flow `
    + "over time.";
}

/** The written times a transient run keeps, in words (API 1.10's `times` and `joined`): how many, from when to
 * when, how many it writes a stretch, and on several processes which are joined; null before it says. */
export function keptText(run: Pick<Run, "times" | "joined" | "nProcs" | "transient">): string | null {
  const times = run.times;
  const first = times?.[0];
  const last = times?.[times.length - 1];
  if (!times || first == null || last == null) return null;
  const n = times.length;
  const which = n === 1
    ? `one written time, ${formatTime(first)}`
    : `${formatInt(n)} written times, from ${formatTime(first)} to ${formatTime(last)}`;
  const writes = run.transient?.writes;
  const each = writes == null ? "" : `; it writes ${writes === 1 ? "once" : `${formatInt(writes)} times`} a stretch`;
  const kept = `It keeps ${which}${each}.`;
  const joined = run.joined?.length;
  if (joined == null || joined >= n || (run.nProcs ?? 1) <= 1) return kept;
  return `${kept} ${joined === 0 ? "They are" : `${formatInt(joined)} of them ${joined === 1 ? "is" : "are"} joined, `
    + "the others"} split on its processes: paraFoam opens ${joined === 0 ? "them" : "them all"} as a Decomposed Case.`;
}

/** How far the stretch a run is in has come, from where it started to where it runs to (0 to 1); undefined until
 * it says. */
export function stretchFraction(run: Pick<Run, "start" | "end" | "iteration">): number | undefined {
  const { start, end, iteration } = run;
  if (end == null || iteration == null || !(end > start)) return undefined;
  return Math.min(1, Math.max(0, (iteration - start) / (end - start)));
}

/** A run's stretches in a few words: "0 → 2,000, then 2,000 → 3,000", or a transient run's "0 → 0.0005, then
 * 0.0005 → 0.0011 s". */
export function stretchesText(stretches: Run["stretches"], transient = false): string | null {
  if (!stretches.length) return null;
  const n = transient ? timeNumber : formatInt;
  return stretches.map((s) => `${n(s.from)} → ${n(s.to)}`).join(", then ") + (transient ? " s" : "");
}

/** What a case was made from, in a few words: "made from the ahmed-body template", "a copy of wing", or "a transient
 * run of ahmed". */
export function madeFrom(made: Made | null | undefined): string | null {
  if (made?.transientOf) return `a transient run of ${made.transientOf}`;
  if (made?.copyOf) return `a copy of ${made.copyOf}`;
  if (made?.template) return `made from the ${made.template} template`;
  return null;
}

/** What a solve job makes its case from: the case you made that it copies (its `source`), the template it makes
 * it from (its `template`), or the steady run it makes a transient run of (its `steady`), if it makes one. */
export function madeOfJob(job: Job | undefined): Made | null {
  const { source, template, steady } = job?.kind === "solve" ? job.params : {};
  if (typeof steady === "string" && steady) return { transientOf: steady };
  if (typeof source === "string" && source) return { copyOf: source };
  return typeof template === "string" && template ? { template } : null;
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

/** What's wrong with a new case's name (a copy's, or `what` else), or null when the engine will take it: never one
 * there already. */
export function copyNameProblem(name: string, taken: ReadonlySet<string>, what = "the copy"): string | null {
  if (!name) return `Give ${what} a name.`;
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

/** The time a transient run is suggested to continue to: the end it stopped short of, else as far again as its
 * latest stretch went (0.0011 s after 0.0005 → 0.0008 s). */
export function suggestedTime(run: Pick<Run, "written" | "start" | "end">): number {
  const { written, start, end } = run;
  if (end != null && end > written) return end;
  const more = end != null && end > start ? end - start : written;
  return Number((written + more).toPrecision(6));
}

/** What's wrong with the time in s typed to solve a transient run to, or null when the engine will take it: a number
 * past `written`, the latest time written (0 for a new one). */
export function timeProblem(text: string, written: number): string | null {
  const t = text.trim();
  if (!/^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(t)) return "Give the time in s, such as 0.2.";
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return "Give a time past 0 s.";
  if (n <= written) {
    return `Give one past ${formatTime(written)}, the latest time written: the run continues from there.`;
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

/** What a solve takes on the disk, in MB, and the free space of the disk the cases are on (GET /disk, API 1.7): it
 * `fits` when that holds it and what the engine keeps free, as the engine's disk guard checks before the job starts. */
export interface DiskCheck { need: number; free: number; keep: number; fits: boolean }

/** What a solve takes on the disk, from GET /disk's answer for the case it solves, or makes its new case from: that
 * new case first (`made`: a copy of a case you made, or a transient run of a steady run), then what it writes as it
 * goes, from the start or continued (`first`), on `procs` processes: a transient run's with its averaged flow (API
 * 1.9's transientSolveMb; an older engine's solveMb). Null when the engine doesn't say (an engine before API 1.7, or
 * a free space or size it can't measure), as its disk guard doesn't check the disk then either. */
export function diskCheck(
  disk: DiskInfo | undefined, made: "copy" | "transient" | null, first: boolean, procs: number,
): DiskCheck | null {
  const c = disk?.case;
  if (!disk || !c || disk.freeMb == null) return null;
  const writes = !first ? c.continueMb : made === "transient" ? c.transientSolveMb ?? c.solveMb : c.solveMb;
  const before = made === "copy" ? c.copyMb : made === "transient" ? c.transientMb : 0;
  if (!writes || before == null) return null;
  const need = before + (procs > 1 ? writes.several : writes.one);
  return { need, free: disk.freeMb, keep: disk.keepMb, fits: need + disk.keepMb <= disk.freeMb };
}

/** An amount of disk space as the engine words it (meshdoctor/diskguard.py's text): "70 MB" under a GB (1 MB at
 * least), "2.4 GB" under 100 GB, then "412 GB". */
export function diskSpace(mb: number): string {
  if (mb < 1024) return `${formatInt(Math.max(mb, 1))} MB`;
  const gb = mb / 1024;
  return gb < 100 ? `${gb.toFixed(1)} GB` : `${formatInt(gb)} GB`;
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
 * keeps the run's own), the case it copies first for a copy of yours, and a transient run's times written a stretch
 * when they change (`writes`). */
export function solveCommand(name: string, to: number, np: number | null, source?: string, writes?: number | null): string {
  return `meshdoctor solve ${source ? `${source} ` : ""}${name} --to ${to}${writes == null ? "" : ` --writes ${writes}`}`
    + (np == null ? "" : ` --np ${np}`);
}

/** The terminal command that starts a transient run `name` of steady run `steady`, writing `writes` times a stretch
 * (said when not the engine's own WRITES). */
export function transientCommand(
  name: string, steady: string, co: number, model: string, to: number, np: number, writes = WRITES,
): string {
  return `meshdoctor solve ${name} --steady ${steady} --co ${co} --model ${model} --to ${to}`
    + `${writes === WRITES ? "" : ` --writes ${writes}`} --np ${np}`;
}
