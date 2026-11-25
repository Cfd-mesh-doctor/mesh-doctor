// SPDX-License-Identifier: GPL-3.0-or-later
// Short names for the engine's API types. schema.d.ts is generated from the engine's own route table
// (npm run gen:api), so these change when the engine does and the build says where.
import type { components, operations } from "./schema";

type Json<R> = R extends { content: { "application/json": infer T } } ? T : never;
/** Fields the app reads that older 1.x engines leave out: the app speaks to any 1.x, so it must not count on them. */
type Since<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type EngineInfo = Json<operations["info"]["responses"][200]>;
/** `cells` (each case's size) is new in API 1.2, and `made` (the cases Mesh Doctor made: the ones a solve takes) in
 *  API 1.6. */
export type CaseList = Since<Json<operations["cases"]["responses"][200]>, "cells" | "made">;
/** What Mesh Doctor made a case from (`made`, API 1.6): a template, or a case you made (a solve job's copy of it). */
export type Made = NonNullable<CaseList["made"]>[string];
export type JobList = Json<operations["list_jobs"]["responses"][200]>;
export type RepairList = Json<operations["repairs"]["responses"][200]>;
export type MachineInfo = Json<operations["machine"]["responses"][200]>;
/** The free space for a new case in the cases folder, and with `case`, what solving that case takes on the disk, in MB
 *  (GET /disk, API 1.7): what the engine's disk guard checks a solve against. */
export type DiskInfo = Json<operations["disk"]["responses"][200]>;
/** What a repair, an A/B test, its continuation, a new case or a set of pictures writes on the disk, as the engine's
 *  disk guard counts it before the job starts, and the free space of the disk it writes on, in MB (GET /disk/repair,
 *  /disk/abtest, /disk/abextend and /disk/case, API 1.12; /disk/pictures, API 1.18). */
export type DiskJob = Json<operations["disk_repair"]["responses"][200]>;
/** GET /disk/pictures (API 1.18), with the written time a picture job joins first when it is still split onto a run's
 *  processes, and the disk the join takes (`join`, API 1.19: absent from an older engine). */
export type DiskPictures = Since<Json<operations["disk_pictures"]["responses"][200]>, "join">;
/** The jobs GET /disk/{kind} answers for, by their kind in POST /jobs (`case`: a new case from a template). */
export type DiskJobKind = "repair" | "abtest" | "abextend" | "case" | "pictures";
export type RepairSummary = RepairList["items"][number];
export type Job = components["schemas"]["Job"];
export type JobState = Job["state"];
export type JobKind = Job["kind"];
export type ApiErrorCode = components["schemas"]["Error"]["error"]["code"];
/** What POST /jobs takes: a repair, an A/B test, an A/B extension or a new case, with its params. */
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
/** The cases the engine can make (API 1.5): the templates in its examples/ folder, each with its mesh sizes. */
export type TemplateList = Json<operations["list_templates"]["responses"][200]>;
export type Template = TemplateList["items"][number];
export type TemplateSize = Template["sizes"][number];
/** The solves of the cases Mesh Doctor made (API 1.6): each one's state, iterations and stretches. */
export type RunList = Json<operations["list_runs"]["responses"][200]>;
export type Run = RunList["items"][number];
export type RunState = Run["state"];
/** A run's state as the screens show it: its solve job's while that waits or runs (the run's own status may be an
 *  earlier stretch's until the job writes it), else the run's own, or unsolved for a case with no run yet. */
export type RunShown = RunState | "queued" | "unsolved";
/** One run, as GET /runs/{name} and POST /runs/{name}/stop answer: the run with its links. */
export type RunDetail = Json<operations["get_run"]["responses"][200]>;
/** A run's page data (API 1.6): its stretches, the solver's iteration and pace, its residuals and forces, and the
 *  live judge. */
export type RunLive = Json<operations["run_live"]["responses"][200]>;
/** The judge on a case's solver logs and forces (GET /judge?case=). */
export type CaseJudge = Json<operations["judge"]["responses"][200]>;
/** Verify install (API 1.6): a run of the Ahmed body template against the wind tunnel and against the accuracy
 *  check's run of the same mesh, its drag and lift over the last quarter of its iterations. */
export type RunValidation = Json<operations["run_validation"]["responses"][200]>;
/** The transient plan a tplan job made of a case (API 1.6): from its latest result, the time step a transient run would
 *  need at each Courant number, which cells set it, and the steps and hours such a run would take. */
export type TransientPlan = Json<operations["transient_plan"]["responses"][200]>;

/** The sets of pictures of the flow in the engine's workspace (GET /pictures, API 1.17), newest first: each set made,
 *  and each one a picture job is making for the first time (`count` and `made` null until then), with its latest
 *  job. A set is named by the time it pictures, `<time>_mean` for a transient run's mean flow. */
export type PictureSetList = Json<operations["list_pictures"]["responses"][200]>;
export type PictureSetBrief = PictureSetList["items"][number];
/** One set (GET /pictures/{case}/{set}): each picture's file (`<kind>/<name>.png`) and what it shows, and the notes on
 *  what was left out and why. */
export type PictureSet = Json<operations["picture_set"]["responses"][200]>;
export type PictureKind = PictureSet["kinds"][number];
export type Picture = PictureSet["pictures"][number];
/** A set deleted (POST /pictures/{case}/{set}/delete): how many pictures it had. */
export type PicturesDeleted = Json<operations["delete_pictures"]["responses"][200]>;

/** A solved case's results (GET /results/{case}, API 1.23): each force group's forces averaged over a window (the
 *  judge's unless one is asked for), its coefficients, its residuals' levels, the judge's verdict and plain warnings,
 *  and when its forces were last written. */
export type CaseResults = Json<operations["results_of"]["responses"][200]>;
export type ResultGroup = CaseResults["groups"][number];
export type ResultForce = NonNullable<ResultGroup["drag"]>;
/** Each case's results over the judge's window, newest first, and the cases whose forces can't be averaged yet, with
 *  why (GET /results, API 1.23). */
export type ResultsList = Json<operations["results_list"]["responses"][200]>;
/** An averaging window to ask for, in iterations or a transient run's seconds: null from, the judge's window; null to,
 *  up to the run's end. */
export interface ResultsWindow {
  from: number | null;
  to: number | null;
}
/** A case's force history for charts (GET /results/{case}/forces, API 1.24): each force group's drag and vertical force
 *  over the whole run, in N, thinned by each stretch's lowest and highest; `n` its values before thinning. */
export type ForceHistory = Json<operations["results_forces"]["responses"][200]>;
export type ForceHistoryGroup = ForceHistory["groups"][number];

/** The API major version this app speaks; the engine reports major.minor and any 1.x works. */
export const API_MAJOR = 1;

export function isActive(state: JobState): boolean {
  return state === "queued" || state === "running";
}

export const JOB_KIND_LABEL: Record<JobKind, string> = {
  repair: "Repair",
  abtest: "A/B test",
  abextend: "A/B extension",
  case: "New case",
  solve: "Solve",
  tplan: "Transient plan",
  pictures: "Pictures",
};
