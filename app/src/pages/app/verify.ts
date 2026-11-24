// SPDX-License-Identifier: GPL-3.0-or-later
// Verify install (API 1.6): the coarse Ahmed body made from its template and solved to iteration 2,000 in one solve
// job, as the accuracy check's run of that mesh was, then its drag against that run's and the wind tunnel's (GET
// /runs/{name}/validation). Which run the Solve screen's card follows, where that run is, and what the card says of it.
import { isPlainName } from "@/engine/commands";
import type { Job, Run, RunValidation } from "@/engine/types";
import { cases as accuracyCases, type Case } from "@/pages/accuracy/results";
import { formatInt } from "@/lib/format";
import type { RunRow } from "./solveStart";

/** What Verify install solves: the accuracy check's coarse run (docs/validation.md: Allvalidate 6 2000). */
export const VERIFY = { template: "ahmed-body", size: "coarse", to: 2000, np: 6 } as const;
/** The cells of the coarse Ahmed body, about (the engine's templates list: meshdoctor/templates.py). */
export const VERIFY_CELLS = 480_000;
/** The name of its run; another one is verify-install-2, -3… */
export const VERIFY_NAME = "verify-install";
/** How close its drag must come to the accuracy check's, in percent (meshdoctor/validate.py's MATCH). */
export const MATCH = 2;

/** Is this the name of a Verify install run: verify-install, or verify-install-2, -3… */
export function isVerifyName(name: string): boolean {
  return name === VERIFY_NAME || /^verify-install-[1-9]\d*$/.test(name);
}

/** Names a new Verify install can't take: every case's, every run's (one cut short while it was meshed keeps its
 * folder, but isn't a case), and every new case's and solve job's. */
export function verifyTaken(cases: readonly string[] | undefined, runs: readonly Run[] | undefined,
  jobs: readonly Job[] | undefined): Set<string> {
  return new Set([...(cases ?? []), ...(runs ?? []).map((r) => r.name),
    ...(jobs ?? []).filter((j) => j.kind === "case" || j.kind === "solve").map((j) => j.name)]);
}

/** A free name for a new Verify install: verify-install, then verify-install-2, -3… while taken. */
export function verifyName(taken: ReadonlySet<string>): string {
  if (!taken.has(VERIFY_NAME)) return VERIFY_NAME;
  let n = 2;
  while (taken.has(`${VERIFY_NAME}-${n}`)) n++;
  return `${VERIFY_NAME}-${n}`;
}

/** What's wrong with a new Verify install's name, or null when the engine will take it. */
export function verifyNameProblem(name: string, taken: ReadonlySet<string>): string | null {
  if (!name) return "Give it a name.";
  if (!isPlainName(name)) return "Use only letters, digits and _ . - (not . or - first), at most 80 characters.";
  if (taken.has(name)) return "A case or a run has this name already. Pick another name.";
  return null;
}

/** The Verify install run the card follows: of the runs list (solveStart.ts's runRows: those solving or waiting
 * first, then the ones solved, newest first), the first with its name. */
export function verifyRow(rows: readonly RunRow[]): RunRow | undefined {
  return rows.find((r) => isVerifyName(r.name));
}

/**
 * Where the run is: none yet; being made or solved (working); ended at iteration 2,000 or past it, to compare
 * (ended); ended short of it, to continue there (short); or ended with an error, or before it wrote an iteration
 * (again: a new one starts afresh).
 */
export type VerifyStage = "none" | "working" | "ended" | "short" | "again";

export function verifyStage(row: RunRow | undefined): VerifyStage {
  if (!row) return "none";
  if (row.shown === "running" || row.shown === "queued") return "working";
  const written = row.run?.written ?? 0;
  if (written >= VERIFY.to) return "ended";
  if (row.shown === "failed" || written === 0) return "again";
  return "short";
}

/** The terminal command that does the same as the card's Verify install. */
export function verifyCommand(name: string, np: number): string {
  return `meshdoctor solve ${name} --template ${VERIFY.template} --size ${VERIFY.size} --to ${VERIFY.to} --np ${np}`;
}

/** The processes it is suggested to run on: the accuracy check's 6, or one per core on a computer with fewer. */
export function verifyProcs(cores: number | undefined): number {
  return Math.max(1, Math.min(VERIFY.np, cores ?? VERIFY.np));
}

/** A difference in percent as the accuracy check writes it: "+4.8 %", "−0.15 %", "0.0 %". */
export function signedPercent(v: number, digits = 1): string {
  const size = Math.abs(v).toFixed(digits);
  if (Number(size) === 0) return `${size} %`;
  return `${v > 0 ? "+" : "−"}${size} %`;
}

/** What the comparison says: whether your install gives the accuracy check's answer. */
export interface VerifyVerdict {
  tone: "success" | "warning" | "neutral";
  badge: string;
  said: string;
}

export function verifyVerdict(v: RunValidation): VerifyVerdict {
  const theirs = `the accuracy check's run of the same mesh (Cd ${v.published.cd.toFixed(3)})`;
  if (!v.comparable) {
    return {
      tone: "neutral", badge: "Not comparable yet",
      said: `Solved to iteration ${formatInt(v.iterations)}, and ${theirs} went to ${formatInt(v.published.iterations)}: `
        + "continue it there to compare.",
    };
  }
  if (v.matches) {
    return {
      tone: "success", badge: "Same answer",
      said: `Its drag is within ${MATCH} % of ${theirs}: your install gives the answer the accuracy check got.`,
    };
  }
  return {
    tone: "warning", badge: "A different answer",
    said: `Its drag is ${signedPercent(v.published.difference)} from ${theirs}, more than ${MATCH} %: something in your `
      + "setup differs from the one tested, such as the OpenFOAM version or a changed template.",
  };
}

/** How long it took, in minutes or hours ("15 min", "1.4 h"), from its start to its end; "" when a stretch ran
 * before (its first one's time isn't known) or it doesn't say. */
export function verifyTime(run: Pick<Run, "started" | "finished" | "stretches"> | null | undefined): string {
  if (!run?.started || !run.finished || run.stretches.length !== 1) return "";
  const min = Math.round((Date.parse(run.finished) - Date.parse(run.started)) / 60_000);
  if (!(min >= 0)) return "";
  return min < 90 ? `${Math.max(1, min)} min` : `${(min / 60).toFixed(1)} h`;
}

/** The accuracy check's run of the same mesh and yours, as the accuracy check's chart draws its cases: the doc's
 * numbers for its run (results.ts), the engine's for yours, named `label` (a run's page names one that isn't a Verify
 * install's This run) and solved in `time`, its mesh made in it too for a Verify install's (`meshed`), whose solve job
 * makes the case first. */
export function verifyCases(v: RunValidation, time: string, o: { label?: string; meshed?: boolean } = {}): Case[] {
  const { label = "Your install", meshed = true } = o;
  const mesh = `${v.size} mesh`;
  const doc = accuracyCases().find((c) => c.name.toLowerCase().startsWith(mesh));
  const theirs: Case = doc ? { ...doc, name: `Accuracy check, ${mesh}` } : {
    name: `Accuracy check, ${mesh}`, cells: "", cd: v.published.cd, tunnel: v.tunnel.cd, drift: "", cl: v.published.cl,
    difference: signedPercent((v.published.cd - v.tunnel.cd) / v.tunnel.cd * 100), time: "", miss: false,
  };
  return [theirs, {
    name: `${label}, ${mesh}`, cells: v.cells != null ? `${(v.cells / 1e6).toFixed(2)} M` : "",
    cd: v.cd, tunnel: v.tunnel.cd, difference: signedPercent(v.tunnel.difference), drift: signedPercent(v.drift, 2),
    cl: v.cl, time: time && (meshed ? `${time} with its mesh` : time), miss: false, window: v.window,
  }];
}
