// SPDX-License-Identifier: GPL-3.0-or-later
// The Repairs screen's sorting of repair runs: which filter each belongs to, the job making it, and where it leads.
import { isActive, type Job, type RepairSummary } from "@/engine/types";
import { improvedCleanly, madeWorse } from "@/engine/verdict";

export const RUN_FILTERS = ["all", "improved", "unchanged", "worse", "unfinished"] as const;
export type RunFilter = (typeof RUN_FILTERS)[number];

/** Where a run belongs among the filters: by its verdict, or not finished while it has none (making its copy,
 * repairing, stopped or failed). A run that made a checkMesh number worse is "worse", whatever else it improved. */
export function runGroup(r: RepairSummary): Exclude<RunFilter, "all"> {
  if (!r.verdict) return "unfinished";
  if (madeWorse(r.verdict)) return "worse";
  return improvedCleanly(r.verdict) ? "improved" : "unchanged";
}

/** The job making or that made a run (the engine lists jobs newest first); none for a run made in a terminal. */
export function jobOf(jobs: readonly Job[] | undefined, run: string): Job | undefined {
  return jobs?.find((j) => j.kind === "repair" && j.name === run);
}

/** The state of the job to show in place of a run's verdict: only while the run has none and its job says why (it
 * is waiting, running, failed or was cancelled). A job that finished cleanly without a verdict says nothing more
 * than that there is none. */
export function shownJobState(r: RepairSummary, job: Job | undefined): Job["state"] | null {
  return !r.verdict && job && job.state !== "done" ? job.state : null;
}

/** Where a run leads: its report once it has a verdict, else the details of the job making it (its progress, or why
 * it stopped), else nowhere: a run made in a terminal that hasn't finished has neither. */
export function runLink(r: RepairSummary, job: Job | undefined): { path: string; label: string } | null {
  if (r.verdict) return { path: `/repairs/${encodeURIComponent(r.name)}/report`, label: "Report" };
  if (job) return { path: `/jobs?job=${encodeURIComponent(job.id)}`, label: isActive(job.state) ? "Progress" : "Details" };
  return null;
}
