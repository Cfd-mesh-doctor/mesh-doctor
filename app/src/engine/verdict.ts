// SPDX-License-Identifier: GPL-3.0-or-later
// A repair's verdict in words. The engine lists the checkMesh numbers that got better, worse
// (regressions) or stayed the same; a repair should never make one worse.
import type { BadgeTone } from "@/components/ui/badge";
import type { RepairSummary } from "./types";

export type Verdict = NonNullable<RepairSummary["verdict"]>;

export interface VerdictText {
  tone: BadgeTone;
  label: string;
  detail: string;
}

export function verdictText(v: Verdict | null | undefined): VerdictText | null {
  if (!v) return null;
  const better = v.improved ?? [];
  const worse = v.regressions ?? [];
  if (worse.length && better.length) {
    return {
      tone: "warning",
      label: `${better.length} better, ${worse.length} worse`,
      detail: `Better: ${better.join(", ")}. Worse: ${worse.join(", ")}.`,
    };
  }
  if (worse.length) return { tone: "danger", label: `Worse ${worse.length}`, detail: `Worse: ${worse.join(", ")}.` };
  if (better.length) return { tone: "success", label: `Improved ${better.length}`, detail: `Better: ${better.join(", ")}.` };
  return { tone: "neutral", label: "Unchanged", detail: "No checkMesh number changed: nothing in this mesh needed this repair." };
}

/** Improved at least one number and made none worse. */
export function improvedCleanly(v: Verdict | null | undefined): boolean {
  return Boolean(v && v.improved.length > 0 && v.regressions.length === 0);
}

/** Made at least one checkMesh number worse. */
export function madeWorse(v: Verdict | null | undefined): boolean {
  return Boolean(v && v.regressions.length > 0);
}

/** The case name from a source folder: /home/user/cases/ahmed-25 → ahmed-25. */
export function caseName(source: string | null | undefined): string | null {
  if (!source) return null;
  const parts = source.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || null;
}

/** Where an unfinished run stopped, from its own status.json. */
export function runStep(r: RepairSummary): string | null {
  const step = (r.status as { step?: unknown } | undefined)?.step;
  return typeof step === "string" && step ? step : null;
}

/** When an unfinished run last wrote its status.json (the worker's local time). */
export function runUpdated(r: RepairSummary): string | null {
  const time = (r.status as { time?: unknown } | undefined)?.time;
  return typeof time === "string" && time ? time : null;
}

/** When a run last moved: when it finished or, while it runs, when it last wrote its status.json (the worker's times,
 * which sort as text); "" when it says neither. */
function lastMoved(r: RepairSummary): string {
  return r.finished ?? runUpdated(r) ?? "";
}

/** The runs newest first, by when each last moved: a run under way comes before the runs that finished before its
 * last step. Runs that moved at the same time keep the engine's order (by name). */
export function newestFirst(runs: readonly RepairSummary[]): RepairSummary[] {
  return [...runs].sort((a, b) => {
    const [x, y] = [lastMoved(a), lastMoved(b)];
    return x < y ? 1 : x > y ? -1 : 0;
  });
}

/** The name of the run that finished last (the worker's times, yyyy-mm-dd hh:mm:ss, sort as text), or null before one
 * has. */
export function latestFinished(runs: readonly RepairSummary[] = []): string | null {
  let last: RepairSummary | null = null;
  for (const r of runs) if (r.finished && (last === null || r.finished > last.finished!)) last = r;
  return last?.name ?? null;
}
