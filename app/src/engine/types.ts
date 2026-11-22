// SPDX-License-Identifier: GPL-3.0-or-later
// Short names for the engine's API types. schema.d.ts is generated from the engine's own route table
// (npm run gen:api), so these change when the engine does and the build says where.
import type { components, operations } from "./schema";

type Json<R> = R extends { content: { "application/json": infer T } } ? T : never;

export type EngineInfo = Json<operations["info"]["responses"][200]>;
export type CaseList = Json<operations["cases"]["responses"][200]>;
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
