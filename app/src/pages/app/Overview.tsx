// SPDX-License-Identifier: GPL-3.0-or-later
// The engine at a glance: what it is, its cases, its repair runs (each finished one opens its report) and what is
// running now.
import { ArrowRight, Cpu, FolderOpen, ListChecks, Terminal, Wrench } from "lucide-react";
import { Link } from "react-router";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { JobStateBadge, VerdictBadge } from "@/components/shared/badges";
import { EmptyState, PageHeader, StatTile, TableSkeleton } from "@/components/shared/page";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { useAppPath, useEngine, usePairing } from "@/engine/context";
import { useCases, useEngineInfo, useJobs, useRepairs } from "@/engine/hooks";
import { JOB_KIND_LABEL, isActive } from "@/engine/types";
import { caseName, improvedCleanly, madeWorse, runStep, runUpdated } from "@/engine/verdict";
import { formatCells, formatRelative } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";

export function Overview() {
  useTitle("Overview");
  const { mode } = useEngine();
  const { pairing } = usePairing();
  const to = useAppPath();
  const info = useEngineInfo();
  const cases = useCases();
  const jobs = useJobs();
  const repairs = useRepairs();

  const jobItems = jobs.data?.items ?? [];
  const active = jobItems.filter((j) => isActive(j.state));
  const repairItems = repairs.data?.items ?? [];
  const improved = repairItems.filter((r) => improvedCleanly(r.verdict)).length;
  const worse = repairItems.filter((r) => madeWorse(r.verdict)).length;
  const engineLabel = mode === "demo" ? "Recorded demo" : pairing?.engine.replace(/^http:\/\//, "");

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          <>
            Mesh Doctor on {mode === "demo" ? "a recorded engine" : "this computer"}
            {engineLabel && <span className="ml-2 font-mono text-[12px] text-muted-foreground/80">{engineLabel}</span>}
          </>
        }
      />
      {info.isError && <ErrorPanel className="mb-6" error={info.error} onRetry={() => info.refetch()} retrying={info.isFetching} />}

      <div data-tour="tiles" className="grid grid-cols-1 gap-4 rounded-xl sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Engine"
          icon={Cpu}
          tone="primary"
          loading={info.isPending}
          value={info.data ? `v${info.data.version ?? "?"}` : "–"}
          hint={info.data ? `API ${info.data.apiVersion} · ${info.data.jobKinds?.length ?? 0} job kinds` : "Not connected"}
        />
        <StatTile
          label="Source cases"
          icon={FolderOpen}
          loading={cases.isPending}
          value={cases.data?.items.length ?? "–"}
          hint="Only ever read, never changed"
        />
        <StatTile
          label="Repair runs"
          icon={Wrench}
          tone="success"
          loading={repairs.isPending}
          value={repairs.data ? repairItems.length : "–"}
          hint={repairs.data ? `${improved} improved, ${worse ? `${worse} made worse` : "none worse"}` : undefined}
        />
        <StatTile
          label="Active jobs"
          icon={ListChecks}
          tone={active.length ? "primary" : undefined}
          loading={jobs.isPending}
          value={jobs.data ? active.length : "–"}
          hint={!jobs.data ? undefined : active.length ? (
            // While jobs are active (running, or waiting their turn: one big job runs at a time), the hint links to
            // them, as the Jobs screen keeps its filter in its address. The count of jobs on record gives way: both
            // don't fit on the hint's one line in a tile a quarter of the page wide.
            <Link to={to("/jobs?show=active")} className="font-medium text-primary hover:underline">
              {active.length === 1 ? "Show the active job" : "Show the active jobs"}
            </Link>
          ) : `${jobItems.length} jobs on record`}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Recent jobs</CardTitle>
              <CardDescription>Repairs and A/B tests, newest first</CardDescription>
            </div>
            <Link to={to("/jobs")} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
              All jobs <ArrowRight className="size-3.5" />
            </Link>
          </CardHeader>
          {jobs.isPending ? (
            <TableSkeleton rows={4} cols={3} />
          ) : jobItems.length === 0 ? (
            <EmptyState icon={ListChecks} title="No jobs yet">Jobs you start appear here with their progress.</EmptyState>
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Run</TH>
                  <TH>State</TH>
                  <TH className="hidden text-right sm:table-cell">Started</TH>
                </TR>
              </THead>
              <TBody>
                {jobItems.slice(0, 6).map((j) => (
                  <TR key={j.id}>
                    <TD>
                      {/* Each job opens its details on the Jobs screen, which keeps them in its address. */}
                      <Link to={to(`/jobs?job=${encodeURIComponent(j.id)}`)} className="font-medium underline-offset-4 hover:underline">
                        {j.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{JOB_KIND_LABEL[j.kind] ?? j.kind}</div>
                    </TD>
                    <TD className="sm:w-48">
                      <JobStateBadge state={j.state} />
                      {isActive(j.state) && (
                        <Progress className="mt-2" value={j.progress?.fraction} label={`${j.name} progress`} />
                      )}
                    </TD>
                    <TD className="hidden text-right text-[13px] whitespace-nowrap text-muted-foreground sm:table-cell">
                      {j.started ? formatRelative(j.started) : "–"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Repair runs</CardTitle>
              <CardDescription>The verdict compares checkMesh before and after</CardDescription>
            </div>
          </CardHeader>
          {repairs.isPending ? (
            <TableSkeleton rows={4} cols={2} />
          ) : repairItems.length === 0 ? (
            <EmptyState icon={Wrench} title="No repair runs yet">Each repair works on a copy of a source case.</EmptyState>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {repairItems.slice(0, 6).map((r) => (
                <li key={r.name} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.source ? (
                        <>
                          {caseName(r.source)}
                          {r.nCells != null && ` · ${formatCells(r.nCells)} cells`}
                        </>
                      ) : (
                        `${runStep(r) ?? "Starting"}${runUpdated(r) ? ` · ${formatRelative(runUpdated(r))}` : ""}`
                      )}
                    </div>
                  </div>
                  <VerdictBadge verdict={r.verdict} pending={runStep(r)} />
                  {r.verdict && (
                    <Link to={to(`/repairs/${encodeURIComponent(r.name)}/report`)} aria-label={`Report of ${r.name}`}
                      className="shrink-0 text-[13px] font-medium text-primary hover:underline">
                      Report
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
          <Terminal className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Starting repairs from the app comes next</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Until then, start one in WSL; the run shows up here when it finishes. It works on a copy, so your case is
            never changed.
          </p>
        </div>
        <CopyCommand command="meshdoctor full <case> <name>" className="sm:w-80" />
      </Card>
    </>
  );
}
