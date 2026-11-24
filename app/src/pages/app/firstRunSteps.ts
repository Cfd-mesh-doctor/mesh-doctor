// SPDX-License-Identifier: GPL-3.0-or-later
// Try it on the Ahmed body (FirstRun.tsx): a first run from start to finish, each step started in the app and ticked
// off from what the engine lists: its checks pass, a coarse Ahmed case made from the template, a short solve of it
// and the judge's verdict on it, then a repair of a copy of it and an A/B test of that repair.
import { isActive, type AbtestList, type CaseList, type Job, type Readiness, type RepairSummary, type Run } from "@/engine/types";
import { caseName } from "@/engine/verdict";

/** The template and mesh size the guide makes its case from: the Ahmed body's coarse mesh, the quickest to solve. */
export const TEMPLATE = "ahmed-body";
export const SIZE = "coarse" as const;
/** A short first solve: long enough for the judge to say how it is going; Continue goes on from there. */
export const SHORT_TO = 1000;

export const STEPS = ["ready", "case", "solve", "judge", "repair", "abtest"] as const;
export type StepId = (typeof STEPS)[number];
/** Ticked off, the one to do now, under way (its job is waiting or running), or waiting for the steps before it. */
export type StepState = "done" | "next" | "running" | "later";

export interface FirstRun {
  /** The Ahmed case the guide follows: one Mesh Doctor made from the template, the one furthest along. */
  name: string | null;
  run: Run | null;
  /** The repair of a copy of it, a finished one first. */
  repair: RepairSummary | null;
  states: Record<StepId, StepState>;
  /** The newest job of the step to do now, when it failed: the step says what went wrong. */
  failed: Job | null;
}

export interface Lists {
  readiness?: Pick<Readiness, "ready">;
  cases?: Pick<CaseList, "made">;
  runs?: readonly Run[];
  /** The engine's judge has answered on the guide's run, once it ended. */
  judged?: boolean;
  repairs?: readonly RepairSummary[];
  tests?: Pick<AbtestList, "items" | "tests">;
  jobs?: readonly Job[];
}

/** The cases Mesh Doctor made from the Ahmed body template, by name. */
export function ahmedCases(cases: Pick<CaseList, "made"> | undefined): string[] {
  return Object.entries(cases?.made ?? {}).filter(([, m]) => m.template === TEMPLATE).map(([n]) => n).sort();
}

function repairOf(repairs: readonly RepairSummary[] | undefined, name: string): RepairSummary | null {
  const of = (repairs ?? []).filter((r) => caseName(r.source) === name);
  return of.find((r) => r.finished && r.verdict) ?? of[0] ?? null;
}

/** Where the guide is: its case, and each step's state. The first step not done is the one to do now (or under way);
 * the steps after it wait. A step done earlier stays done. */
export function firstRun(l: Lists): FirstRun {
  const tested = (r: RepairSummary | null) => r != null && (l.tests?.items ?? []).includes(r.name);
  const along = (n: string) => {
    const r = repairOf(l.repairs, n);
    return tested(r) ? 3 : r ? 2 : l.runs?.some((x) => x.name === n) ? 1 : 0;
  };
  const name = ahmedCases(l.cases).reduce<string | null>((best, n) => (best == null || along(n) > along(best) ? n : best), null);
  const run = (name != null && l.runs?.find((r) => r.name === name)) || null;
  const repair = name != null ? repairOf(l.repairs, name) : null;
  const brief = repair ? l.tests?.tests?.[repair.name] : undefined;
  // Each step's jobs: a case job for the template, a solve of the case, a repair of a copy of it, and an A/B test of
  // that repair or a continuation of it (named for the repair, as the A/B test screens find them).
  const of: Record<StepId, (j: Job) => boolean> = {
    ready: () => false,
    case: (j) => j.kind === "case" && j.params.template === TEMPLATE,
    solve: (j) => j.kind === "solve" && name != null && j.name === name,
    judge: () => false,
    repair: (j) => j.kind === "repair" && name != null && j.params.source === name,
    abtest: (j) => (j.kind === "abtest" || j.kind === "abextend") && repair != null && j.name === repair.name,
  };
  const jobs = l.jobs ?? [];
  const working = (id: StepId) => jobs.some((j) => of[id](j) && isActive(j.state));
  // The step's newest job: the engine lists jobs newest first.
  const newest = (id: StepId) => jobs.find(of[id]);
  const stopped = (id: StepId) => ["failed", "cancelled"].includes(newest(id)?.state ?? "");
  const ended = run != null && (run.state === "done" || run.state === "stopped") && (run.written ?? 0) > 0;

  const done: Record<StepId, boolean> = {
    ready: l.readiness?.ready === true,
    case: name != null,
    solve: ended,
    judge: ended && l.judged === true,
    repair: Boolean(repair?.finished && repair.verdict),
    // An engine before API 1.3 lists the tests' names only: listed, then.
    abtest: tested(repair) && (l.tests?.tests == null || Boolean(brief?.finished)),
  };
  const running: Record<StepId, boolean> = {
    ready: false,
    case: name == null && working("case"),
    solve: name != null && (working("solve") || run?.state === "running"),
    judge: false,
    // A repair or an A/B test listed but not finished is under way, unless its job ended without finishing it (one
    // started in a terminal has no job).
    repair: name != null && (working("repair") || (repair != null && !repair.finished && !stopped("repair"))),
    abtest: repair != null && (working("abtest") || (tested(repair) && !done.abtest && !stopped("abtest"))),
  };
  let open = false;
  const states = Object.fromEntries(STEPS.map((id) => {
    if (done[id]) return [id, "done"];
    if (open) return [id, "later"];
    open = true;
    return [id, running[id] ? "running" : "next"];
  })) as Record<StepId, StepState>;
  const now = STEPS.find((id) => states[id] === "next");
  const last = now ? newest(now) : undefined;
  return { name, run, repair, states, failed: last?.state === "failed" ? last : null };
}
