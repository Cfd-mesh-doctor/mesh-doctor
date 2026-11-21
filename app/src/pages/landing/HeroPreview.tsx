// SPDX-License-Identifier: GPL-3.0-or-later
// A picture of the app on the home page, drawn from the same recorded data as the demo.
import { FolderOpen, LayoutDashboard, ListChecks, Settings, Wrench } from "lucide-react";
import { JobStateBadge } from "@/components/shared/badges";
import { Progress } from "@/components/ui/misc";
import recorded from "@/demo/fixtures.json";
import type { CaseList, JobList, RepairList } from "@/engine/types";
import { JOB_KIND_LABEL, isActive } from "@/engine/types";
import { improvedCleanly } from "@/engine/verdict";
import { formatPercent } from "@/lib/format";

const answers = (recorded as { answers: Record<string, unknown> }).answers;
const cases = (answers["/cases"] as CaseList | undefined)?.items ?? [];
const repairs = (answers["/repairs"] as RepairList | undefined)?.items ?? [];
const jobs = (answers["/jobs"] as JobList | undefined)?.items ?? [];

export function HeroPreview() {
  const running = jobs.filter((j) => isActive(j.state)).length;
  const tiles = [
    ["Source cases", cases.length],
    ["Repair runs", repairs.length],
    ["Improved", repairs.filter((r) => improvedCleanly(r.verdict)).length],
    ["Running", running],
  ] as const;
  return (
    <div
      role="img"
      aria-label="The Mesh Doctor app: source cases, repair runs and jobs with live progress"
      className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-pop"
    >
      <div className="flex h-9 items-center gap-1.5 border-b border-border bg-surface-2 px-3.5" aria-hidden>
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="mx-auto rounded-md bg-surface px-3 py-0.5 font-mono text-[11px] text-muted-foreground ring-1 ring-border">
          Mesh Doctor · localhost:8765
        </span>
      </div>
      <div className="flex" aria-hidden>
        <div className="hidden w-12 shrink-0 flex-col items-center gap-3 border-r border-border bg-sidebar py-4 sm:flex">
          {[LayoutDashboard, FolderOpen, ListChecks, Wrench, Settings].map((Icon, i) => (
            <span key={i} className={i === 2 ? "rounded-md bg-surface p-1.5 text-primary shadow-card ring-1 ring-border" : "p-1.5 text-muted-foreground"}>
              <Icon className="size-4" />
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {tiles.map(([label, n]) => (
              <div key={label} className="rounded-lg border border-border bg-surface p-2.5 shadow-card">
                <div className="truncate text-[10.5px] text-muted-foreground">{label}</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums">{n}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-border">
            {jobs.slice(0, 5).map((j) => (
              <div key={j.id} className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium">{j.name}</div>
                  <div className="text-[10.5px] text-muted-foreground">{JOB_KIND_LABEL[j.kind] ?? j.kind}</div>
                </div>
                {isActive(j.state) && (
                  <div className="hidden w-28 sm:block">
                    <div className="mb-1 text-right text-[10.5px] text-muted-foreground tabular-nums">{formatPercent(j.progress?.fraction)}</div>
                    <Progress value={j.progress?.fraction} />
                  </div>
                )}
                <JobStateBadge state={j.state} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
