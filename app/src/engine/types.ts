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
