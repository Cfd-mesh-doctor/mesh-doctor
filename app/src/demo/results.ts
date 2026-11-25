// SPDX-License-Identifier: GPL-3.0-or-later
// The demo's results (GET /results, GET /results/{case} and its force history, GET /results/{case}/forces): those of
// the coarse and medium 25° Ahmed bodies, recorded from a real engine over the judge's window (results.json and
// results-medium.json, loaded when first asked for: the public Ahmed-body example solved to 2,000 iterations on two
// meshes, with no folder paths), with their forces every 4th iteration (forces.json and forces-medium.json, to 4
// figures); and their comparison (GET /compare, compare.json: as a mesh study and as two designs, over their judges'
// window), with that of the finished A/B test's two runs and their force histories (GET /abtests/{name}/forces,
// forces-ab.json: each iteration's, to 4 figures). Their forces were written a few hours before the demo is asked, as
// the demo moves its other times to look recent. Another window, or another case's results or comparison, need your
// own engine.
import { EngineError } from "@/engine/errors";
import type { CaseResults, Comparison, ForceHistory, ResultsList } from "@/engine/types";

/** The recorded cases, newest first: the coarse mesh's results, and the medium one's for the comparison. */
export const RECORDED = ["ahmed-25-coarse", "ahmed-25-medium"] as const;
export const RECORDED_RESULTS = RECORDED[0];

const RECORDINGS: Record<(typeof RECORDED)[number], {
  results: () => Promise<{ default: unknown }>; forces: () => Promise<{ default: unknown }>; hours: number;
}> = {
  "ahmed-25-coarse": { results: () => import("./results.json"), forces: () => import("./forces.json"), hours: 4 },
  "ahmed-25-medium": { results: () => import("./results-medium.json"), forces: () => import("./forces-medium.json"), hours: 5 },
};
const recorded = (name: string): name is (typeof RECORDED)[number] => (RECORDED as readonly string[]).includes(name);

export const DEMO_RESULTS_NOTE =
  "The demo recorded its results over the judge's window only: connect your own engine to average them over another.";

/** The demo's A/B test whose two runs' comparison it recorded: its finished one. */
export const RECORDED_COMPARE_AB = "ahmed25-coarse-fix";

export const DEMO_COMPARE_NOTE = `The demo recorded only ${RECORDED[0]} against ${RECORDED[1]}, and the A/B test `
  + `${RECORDED_COMPARE_AB}'s two runs, over their judges' window: connect your own engine to compare others, or over `
  + "another window.";

export const DEMO_AB_FORCES_NOTE = `The demo recorded the forces of its finished A/B test ${RECORDED_COMPARE_AB}'s `
  + "two runs only: connect your own engine to chart another's.";

const notRecorded = (name: string) =>
  `The demo recorded the results of ${RECORDED.join(" and ")} only: connect your own engine to see ${name}'s.`;

/** A recorded case's results, with its forces written a few hours before `now`. */
export async function demoResults(name: string = RECORDED_RESULTS, now = Date.now()): Promise<CaseResults> {
  const rec = RECORDINGS[recorded(name) ? name : RECORDED_RESULTS];
  const doc = structuredClone((await rec.results()).default) as CaseResults;
  doc.updated = new Date(now - rec.hours * 3600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return doc;
}

/** A recorded case's force history for its charts: every 4th iteration's forces, so none thinned. */
export async function demoForces(name: string = RECORDED_RESULTS): Promise<ForceHistory> {
  return structuredClone((await RECORDINGS[recorded(name) ? name : RECORDED_RESULTS].forces()).default) as ForceHistory;
}

/** The demo's answer to GET /abtests/{name}/forces?side=: its finished A/B test's run, as recorded; refusals as the
 *  engine words them (`side` as the address gives it: null when it gives none), and another of its A/B tests (named
 *  in `abtests`) isn't in the demo. */
export async function demoAbtestForces(name: string, side: string | null,
                                       abtests: readonly string[] = [RECORDED_COMPARE_AB]): Promise<ForceHistory> {
  if (side == null) throw new EngineError("bad-request", "missing query parameter side", 400);
  if (side !== "base" && side !== "fixed") {
    throw new EngineError("bad-request", `side: '${side}' not one of ['base', 'fixed']`, 400);
  }
  if (!abtests.includes(name)) throw new EngineError("not-found", `no ${side} run in A/B test ${name}`, 404);
  if (name !== RECORDED_COMPARE_AB) throw new EngineError("unavailable", DEMO_AB_FORCES_NOTE, 503);
  const rec = (await import("./forces-ab.json")).default as unknown as Record<"base" | "fixed", ForceHistory>;
  return structuredClone(rec[side]);
}

type Recorded = { mesh: Comparison; design: Comparison; abtest: Comparison };
const recording = async () => (await import("./compare.json")).default as unknown as Recorded;

/** The demo's answer to GET /compare: the recorded comparison of the coarse and medium meshes (as a mesh study with
 *  mesh=true), or of its finished A/B test's two runs; refusals as the engine words them, and the rest isn't in the
 *  demo. `cases` are the demo's cases, `abtests` its A/B tests. */
export async function demoCompare(query: URLSearchParams, cases: readonly string[],
                                  abtests: readonly string[] = [RECORDED_COMPARE_AB]): Promise<Comparison> {
  const [a, b, abtest] = (["a", "b", "abtest"] as const).map((k) => query.get(k));
  const bad = (message: string) => new EngineError("bad-request", message, 400);
  if (abtest != null) {
    if (a != null || b != null) throw bad("give a and b (two cases) or abtest (an A/B test's two runs), not both");
    if (!abtests.includes(abtest)) throw new EngineError("not-found", `no A/B test ${abtest} with both its runs`, 404);
    if (abtest !== RECORDED_COMPARE_AB || query.has("from") || query.has("to")) {
      throw new EngineError("unavailable", DEMO_COMPARE_NOTE, 503);
    }
    return structuredClone((await recording()).abtest);
  }
  if (a == null || b == null) throw bad("give a and b (two cases to compare), or abtest (an A/B test's two runs)");
  if (a === b) throw bad("pick two different cases to compare");
  for (const name of [a, b]) {
    if (!cases.includes(name)) throw new EngineError("not-found", `no case ${name} in the cases folder`, 404);
  }
  if (a !== RECORDED[0] || b !== RECORDED[1] || query.has("from") || query.has("to")) {
    throw new EngineError("unavailable", DEMO_COMPARE_NOTE, 503);
  }
  const rec = await recording();
  return structuredClone(query.get("mesh") === "true" ? rec.mesh : rec.design);
}

/** The demo's answer to GET /results, /results/{case} or /results/{case}/forces (`route` without its query); any
 *  other route under /results isn't in it. `cases` are the demo's cases: one it has but didn't record results of is
 *  unavailable, any other not found. */
export async function demoResultsAnswer(route: string, query: URLSearchParams, cases: readonly string[]): Promise<unknown> {
  if (route === "/results") {
    return { items: await Promise.all(RECORDED.map((n) => demoResults(n))), waiting: [] } satisfies ResultsList;
  }
  const m = /^\/results\/([^/]+)(\/forces)?$/.exec(route);
  if (!m) throw new EngineError("not-found", "Not in the demo data", 404);
  const name = decodeURIComponent(m[1] ?? "");
  if (recorded(name)) {
    if (m[2]) return demoForces(name);
    if (query.has("from") || query.has("to")) throw new EngineError("unavailable", DEMO_RESULTS_NOTE, 503);
    return demoResults(name);
  }
  if (cases.includes(name)) throw new EngineError("unavailable", notRecorded(name), 503);
  throw new EngineError("not-found", `no case ${name} in the cases folder`, 404);
}
