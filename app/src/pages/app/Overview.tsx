// SPDX-License-Identifier: GPL-3.0-or-later
// The engine at a glance: what it is, its cases, its repair runs (each finished one opens its report) and what is
// running now.
import { ArrowRight, Cpu, ExternalLink, FolderOpen, ListChecks, Terminal, Wrench } from "lucide-react";
import { Link } from "react-router";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { NoJobsYet } from "@/components/shared/NoJobsYet";
import { JobStateBadge, VerdictBadge } from "@/components/shared/badges";
import { EmptyState, PageHeader, StatTile, TableSkeleton } from "@/components/shared/page";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { useAppPath, useEngine, useEngineDashboard, usePairing } from "@/engine/context";
import { useCases, useEngineInfo, useJobs, useRepairs } from "@/engine/hooks";
import { JOB_KIND_LABEL, isActive } from "@/engine/types";
import { caseName, improvedCleanly, madeWorse, runStep, runUpdated } from "@/engine/verdict";
import { formatCells, formatCount, formatRelative } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";

/** Repairs a copy of a case, in WSL; the app can't start repairs itself yet. */
const REPAIR_COMMAND = "meshdoctor full <case> <name>";

export function Overview() {
  useTitle("Overview");
  const { mode } = useEngine();
  const { pairing } = usePairing();
  const dashboard = useEngineDashboard();
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
  // The engine has answered that it has no repair runs yet (not: the list didn't load).
  const noRuns = repairs.isSuccess && repairItems.length === 0;
  // What didn't load, and why, at the top: the engine's own answer first, else the first list that failed. Try again
  // asks again for each one that failed.
  const queries = [info, cases, jobs, repairs];
  const failed = queries.find((q) => q.isError);

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
      {failed && (
        <ErrorPanel
          className="mb-6"
          error={failed.error}
          onRetry={() => {
            for (const q of queries) if (q.isError) void q.refetch();
          }}
          retrying={queries.some((q) => q.isError && q.isFetching)}
        />
      )}

      <div data-tour="tiles" className="grid grid-cols-1 gap-4 rounded-xl sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Engine"
          icon={Cpu}
          tone="primary"
          loading={info.isPending}
          value={info.data ? `v${info.data.version ?? "?"}` : "–"}
          hint={info.data ? `API ${info.data.apiVersion} · ${formatCount(info.data.jobKinds?.length ?? 0, "job kind")}` : "Not connected"}
        />
        <StatTile
          label="Source cases"
          icon={FolderOpen}
          loading={cases.isPending}
          value={cases.data?.items.length ?? "–"}
          hint={cases.data?.items.length === 0 ? (
            // None found is the first thing to fix: the hint links the Cases screen, which says where the engine looks
            // and how to point it at another folder.
            <Link to={to("/cases")} className="font-medium text-primary hover:underline">Where the engine looks</Link>
          ) : "Only ever read, never changed"}
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
          ) : `${formatCount(jobItems.length, "job")} on record`}
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
            // A list that didn't load isn't empty: the message at the top says why, and no first steps are offered.
            jobs.isError ? <EmptyState icon={ListChecks} title="The jobs didn't load" /> : <NoJobsYet />
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
          ) : repairs.isError && repairItems.length === 0 ? (
            <EmptyState icon={Wrench} title="The repair runs didn't load" />
          ) : noRuns ? (
            // The first step, where you look for your runs: the command card at the bottom of the page gives way to it.
            <EmptyState icon={Wrench} title="No repair runs yet"
              action={<CopyCommand command={REPAIR_COMMAND} className="max-w-full text-left" />}>
              Repair a copy of one of{" "}
              <Link to={to("/cases")} className="font-medium text-primary underline-offset-4 hover:underline">your cases</Link>,
              with this in WSL or from the engine's dashboard: the run shows here when it finishes.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {repairItems.slice(0, 6).map((r) => (
                <li key={r.name} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3">
                  {/* The whole name and case, wrapping rather than cut off (a long name breaks at its hyphens first).
                      On phones the verdict and Report go under them, so the name has the card's width. */}
                  <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
                    <div className="text-sm font-medium wrap-anywhere">{r.name}</div>
                    <div className="text-xs text-muted-foreground wrap-anywhere">
                      {r.source ? caseName(r.source) : (runStep(r) ?? "Starting")}
                      {/* The size or the time stays on one line with its dot. */}
                      {r.source
                        ? r.nCells != null && <>{" "}<span className="whitespace-nowrap">· {formatCells(r.nCells)} cells</span></>
                        : runUpdated(r) && <>{" "}<span className="whitespace-nowrap">· {formatRelative(runUpdated(r))}</span></>}
                    </div>
                  </div>
                  {/* A list's own badge: a run with no verdict says so, not with a dash. */}
                  <VerdictBadge verdict={r.verdict} pending={runStep(r)} empty="No verdict" />
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

      {!noRuns && (
        <Card className="mt-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <Terminal className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            {/* Says how to start one now, rather than only that the app can't yet: this card is where the engine's
                dashboard stays linked once the empty lists that first offer it have gone. */}
            <CardTitle>Start a repair</CardTitle>
            <CardDescription>
              From{" "}
              {dashboard ? (
                <a href={dashboard} target="_blank" rel="noreferrer"
                  className="font-medium whitespace-nowrap text-primary underline-offset-4 hover:underline">
                  the engine's dashboard
                  <ExternalLink className="ml-0.5 inline size-3 align-[-1px]" aria-hidden />
                </a>
              ) : "the engine's dashboard"}
              , or with this command in WSL: the run shows up here when it finishes. It works on a copy, so your case is
              never changed. Starting repairs from this app comes next.
            </CardDescription>
          </div>
          <CopyCommand command={REPAIR_COMMAND} className="sm:w-80" />
        </Card>
      )}
    </>
  );
}
