// SPDX-License-Identifier: GPL-3.0-or-later
// Coloured labels for a job's state, a repair's verdict and an A/B test's state.
import { Ban, CircleCheck, CircleDashed, CircleX, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import type { JobState } from "@/engine/types";
import { verdictText, type Verdict } from "@/engine/verdict";
import type { AbState } from "@/report/abtest";

const JOB: Record<JobState, { label: string; tone: BadgeTone; icon: LucideIcon; spin?: boolean }> = {
  queued: { label: "Queued", tone: "neutral", icon: CircleDashed },
  running: { label: "Running", tone: "primary", icon: LoaderCircle, spin: true },
  done: { label: "Done", tone: "success", icon: CircleCheck },
  failed: { label: "Failed", tone: "danger", icon: CircleX },
  cancelled: { label: "Cancelled", tone: "warning", icon: Ban },
};

export function JobStateBadge({ state }: { state: JobState }) {
  const s = JOB[state] ?? JOB.queued;
  const Icon = s.icon;
  return (
    <Badge tone={s.tone}>
      <Icon className={s.spin ? "animate-spin" : undefined} aria-hidden />
      {s.label}
    </Badge>
  );
}

const AB: Record<AbState, { label: string; tone: BadgeTone; icon: LucideIcon; spin?: boolean }> = {
  running: { label: "Running", tone: "primary", icon: LoaderCircle, spin: true },
  done: { label: "Finished", tone: "success", icon: CircleCheck },
  changed: { label: "Case changed", tone: "warning", icon: TriangleAlert },
  failed: { label: "Failed", tone: "danger", icon: CircleX },
  cancelled: { label: "Cancelled", tone: "warning", icon: Ban },
  unfinished: { label: "Not finished", tone: "neutral", icon: CircleDashed },
};

/** What an A/B test is doing. `queued`: its job waits for its turn, so it says Queued rather than Running. */
export function AbStateBadge({ state, queued }: { state: AbState; queued?: boolean }) {
  const s = queued && state === "running" ? { label: "Queued", tone: "neutral" as const, icon: CircleDashed } : AB[state];
  const Icon = s.icon;
  return (
    <Badge tone={s.tone}>
      <Icon className={"spin" in s && s.spin ? "animate-spin" : undefined} aria-hidden />
      {s.label}
    </Badge>
  );
}

/**
 * The repair's verdict: how many checkMesh numbers got better or worse. Hover for which ones.
 * `pending` is the last step of a run with no verdict yet (still running, or stopped). `empty` says, in words, that
 * there is neither: without it, that shows as a dash, a table's empty cell.
 */
export function VerdictBadge({ verdict, pending, empty }: {
  verdict: Verdict | null | undefined; pending?: string | null; empty?: string;
}) {
  const v =
    verdictText(verdict) ??
    (pending
      ? { tone: "neutral" as const, label: "Not finished", detail: `No verdict yet. Last step: ${pending}.` }
      : null);
  if (!v) return empty ? <Badge tone="neutral">{empty}</Badge> : <span className="text-xs text-muted-foreground">–</span>;
  return (
    <Tip label={v.detail}>
      <span tabIndex={0} className="rounded-md">
        <Badge tone={v.tone}>{v.label}</Badge>
      </span>
    </Tip>
  );
}
