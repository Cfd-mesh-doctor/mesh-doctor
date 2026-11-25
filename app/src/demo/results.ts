// SPDX-License-Identifier: GPL-3.0-or-later
// The demo's results (GET /results, GET /results/{case} and its force history, GET /results/{case}/forces): those of
// the coarse 25° Ahmed body, recorded from a real engine over the judge's window (results.json, loaded when first
// asked for: the public Ahmed-body example solved to 2,000 iterations, with no folder paths), with its forces every
// 4th iteration (forces.json, to 4 figures). Its forces were written a few hours before the demo is asked, as the
// demo moves its other times to look recent. Another window, or another case's results, need your own engine.
import { EngineError } from "@/engine/errors";
import type { CaseResults, ForceHistory, ResultsList } from "@/engine/types";

/** The recorded case. */
export const RECORDED_RESULTS = "ahmed-25-coarse";

export const DEMO_RESULTS_NOTE =
  "The demo recorded its results over the judge's window only: connect your own engine to average them over another.";

const notRecorded = (name: string) =>
  `The demo recorded the results of ${RECORDED_RESULTS} only: connect your own engine to see ${name}'s.`;

/** The recorded results, with its forces written 4 h before `now`. */
export async function demoResults(now = Date.now()): Promise<CaseResults> {
  const doc = structuredClone((await import("./results.json")).default) as unknown as CaseResults;
  doc.updated = new Date(now - 4 * 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return doc;
}

/** The recorded case's force history for its charts: every 4th iteration's forces, so none thinned. */
export async function demoForces(): Promise<ForceHistory> {
  return structuredClone((await import("./forces.json")).default) as unknown as ForceHistory;
}

/** The demo's answer to GET /results, /results/{case} or /results/{case}/forces (`route` without its query); any
 *  other route under /results isn't in it. `cases` are the demo's cases: one it has but didn't record results of is
 *  unavailable, any other not found. */
export async function demoResultsAnswer(route: string, query: URLSearchParams, cases: readonly string[]): Promise<unknown> {
  if (route === "/results") return { items: [await demoResults()], waiting: [] } satisfies ResultsList;
  const m = /^\/results\/([^/]+)(\/forces)?$/.exec(route);
  if (!m) throw new EngineError("not-found", "Not in the demo data", 404);
  const name = decodeURIComponent(m[1] ?? "");
  if (name === RECORDED_RESULTS) {
    if (m[2]) return demoForces();
    if (query.has("from") || query.has("to")) throw new EngineError("unavailable", DEMO_RESULTS_NOTE, 503);
    return demoResults();
  }
  if (cases.includes(name)) throw new EngineError("unavailable", notRecorded(name), 503);
  throw new EngineError("not-found", `no case ${name} in the cases folder`, 404);
}
