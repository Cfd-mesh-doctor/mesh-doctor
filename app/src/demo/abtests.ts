// SPDX-License-Identifier: GPL-3.0-or-later
// The demo's A/B tests, made from the recorded reports' A/B test documents the way the engine answers
// GET /abtests/{name} (each run's residuals as a table, the result without them), and the judge's answers on their
// runs, recorded from the same engine (judges.json, loaded when first asked for). The 25° medium test is still
// solving its repaired-mesh run in the demo's job list, so its answer holds the original-mesh run alone, as the
// engine's did then.
import type { AbtestBrief, AbtestDetail, JudgeAnswer, ResidualTable } from "@/engine/types";

/** The recorded reports that hold an A/B test (src/report/samples). */
export const RECORDED_ABTESTS = ["ahmed25-coarse-fix", "ahmed25-medium-fix"] as const;

/** What the demo says when asked for the live monitor: it recorded none. */
export const DEMO_LIVE_NOTE =
  "The demo recorded no live solver data, so it can't show this run's iterations as it solves. Connect your own engine to follow a test live.";

/** What it says when asked to judge a run it has no recorded judge for. */
export const DEMO_JUDGE_NOTE = "The demo recorded the judge on its finished runs only.";

type Doc = Record<string, unknown>;
const isDoc = (v: unknown): v is Doc => typeof v === "object" && v !== null && !Array.isArray(v);

/** A run's residualHistory ({Time: [...], p: [...], ...}) as the engine's residual table: Time, then each field. */
export function historyTable(history: unknown): ResidualTable | null {
  if (!isDoc(history) || !Array.isArray(history.Time) || !history.Time.length) return null;
  const fields = Object.keys(history).filter((k) => k !== "Time" && Array.isArray(history[k]));
  const cols = ["Time", ...fields];
  const rows = history.Time.map((_, i) => cols.map((c) => {
    const v = (history[c] as unknown[])[i];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }));
  return { cols, rows };
}

/** The parts of an A/B result that exist while its repaired-mesh run solves: the first run's are written when it
 * ends (abtest.py writes ab_result.json after each run). */
const FIRST_RUN = new Set(["schemaVersion", "source", "fixedName", "variant", "variantSettings", "label", "iters", "nProcs",
  "init", "window", "started", "baseRuns", "base"]);

/**
 * A recorded A/B test as GET /abtests/{name} answers: finished, or, given the step its job is at (`solving`), with
 * the original-mesh run alone. Its times are the document's own, so moving the report's times moves these.
 */
export function demoAbtest(abDoc: Doc, solving: { step: string; time: string | null } | null): AbtestDetail {
  const doc = structuredClone(abDoc);
  const run = (key: string) => (isDoc(doc[key]) ? doc[key] : null);
  const baseHistory = run("base")?.residualHistory;
  const fixedHistory = run("fixedFull")?.residualHistory ?? run("fixed")?.residualHistory;
  for (const key of ["base", "fixed"]) delete run(key)?.residualHistory;
  delete doc.fixedFull;
  const result = solving ? Object.fromEntries(Object.entries(doc).filter(([k]) => FIRST_RUN.has(k))) : doc;
  const step = solving?.step ?? "done", time = solving ? solving.time : doc.finished;
  return {
    status: typeof time === "string" ? { step, time } : { step },
    result: result as AbtestDetail["result"],
    live: { base: historyTable(baseHistory), fixed: solving ? null : historyTable(fixedHistory) },
    modes: [],
  };
}

/** What GET /abtests says of a test, from its answer (the engine reads the same two files). */
export function briefOf(d: AbtestDetail): AbtestBrief {
  const r = d.result;
  const ratios = Object.entries(r?.residualRatioFixedOverBase ?? {}).filter((e): e is [string, number] => typeof e[1] === "number");
  const verdict = isDoc(r?.fixedJudge) && typeof r.fixedJudge.verdict === "string" ? r.fixedJudge.verdict : null;
  return {
    step: d.status?.step ?? null,
    updated: d.status?.time ?? null,
    finished: r?.finished ?? null,
    ratios: Object.fromEntries(ratios),
    verdict,
  };
}

/** The judge's recorded answer on one run of a demo A/B test, or null. */
export async function recordedJudge(name: string, side: string): Promise<JudgeAnswer | null> {
  const all = (await import("./judges.json")).default as unknown as Record<string, JudgeAnswer>;
  return Object.hasOwn(all, `${name}/${side}`) ? structuredClone(all[`${name}/${side}`] ?? null) : null;
}
