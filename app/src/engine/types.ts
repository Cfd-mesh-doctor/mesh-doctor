// SPDX-License-Identifier: GPL-3.0-or-later
// Short names for the engine's API types. schema.d.ts is generated from the engine's own route table
// (npm run gen:api), so these change when the engine does and the build says where.
import type { components, operations } from "./schema";

type Json<R> = R extends { content: { "application/json": infer T } } ? T : never;
/** Fields the app reads that older 1.x engines leave out: the app speaks to any 1.x, so it must not count on them. */
type Since<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type EngineInfo = Json<operations["info"]["responses"][200]>;
/** `cells` (each case's size) is new in API 1.2. */
export type CaseList = Since<Json<operations["cases"]["responses"][200]>, "cells">;
export type JobList = Json<operations["list_jobs"]["responses"][200]>;
export type RepairList = Json<operations["repairs"]["responses"][200]>;
export type MachineInfo = Json<operations["machine"]["responses"][200]>;
export type RepairSummary = RepairList["items"][number];
export type Job = components["schemas"]["Job"];
export type JobState = Job["state"];
export type JobKind = Job["kind"];
export type ApiErrorCode = components["schemas"]["Error"]["error"]["code"];
/** What POST /jobs takes: a repair, an A/B test or an A/B extension, with its params. */
export type JobRequest = Json<operations["start_job"]["requestBody"]>;
/** One defect cluster's shapes, for its 3D view: every face of the cells beside its failing faces, and the boundary
 *  faces nearby. */
export type ClusterShape = Json<operations["repair_cluster"]["responses"][200]>;
/** The A/B tests; `tests` (each one's step and outcome) is new in API 1.3, so an older engine only names them. */
export type AbtestList = Since<Json<operations["abtests"]["responses"][200]>, "tests">;
export type AbtestBrief = NonNullable<AbtestList["tests"]>[string];
/** One A/B test: its step, its result so far (the abtest document) and each run's residuals as they are now. */
export type AbtestDetail = Json<operations["abtest"]["responses"][200]>;
/** One run's residuals: Time, then each field, a row per iteration. */
export type ResidualTable = NonNullable<AbtestDetail["live"]["base"]>;
/** The A/B test's live monitor while its repaired-mesh run solves: the solver's iteration and pace, the live judge. */
export type AbtestLive = Json<operations["abtest_live"]["responses"][200]>;
/** The judge on one run of an A/B test (the judge document). */
export type JudgeAnswer = Json<operations["abtest_judge"]["responses"][200]>;
/** The solver-setting presets an A/B test's second run can use in place of the case's own (GET /variants). */
export type VariantList = Json<operations["variants"]["responses"][200]>;
export type Variant = VariantList["items"][number];
/** Is the engine's computer ready (API 1.4)? Its self check: each check's state, what it found and the fix, and the
 *  largest mesh a repair or a solve could take in the memory free now. */
export type Readiness = Json<operations["readiness"]["responses"][200]>;
export type ReadinessCheck = Readiness["checks"][number];

/** The API major version this app speaks; the engine reports major.minor and any 1.x works. */
export const API_MAJOR = 1;

export function isActive(state: JobState): boolean {
  return state === "queued" || state === "running";
}

export const JOB_KIND_LABEL: Record<JobKind, string> = {
  repair: "Repair",
  abtest: "A/B test",
  abextend: "A/B extension",
};
