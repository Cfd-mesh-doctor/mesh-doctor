// SPDX-License-Identifier: GPL-3.0-or-later
// Every job on the engine: live progress while running, details, cancelling (after a confirmation), and the report
// of a finished job's run.
import { FileText, ListChecks, OctagonX } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { JobStateBadge } from "@/components/shared/badges";
import { EmptyState, Field, PageHeader, TableSkeleton } from "@/components/shared/page";
import { Dot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogActions, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Progress, Segmented } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { useAppPath, useEngine } from "@/engine/context";
import { ACTIVE_POLL_MS, useCancelJob, useJobs } from "@/engine/hooks";
import { JOB_KIND_LABEL, isActive, type Job, type JobState } from "@/engine/types";
import { elapsed, formatDateTime, formatDuration, formatPercent, formatRelative } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";

type Filter = "all" | "active" | "done" | "failed" | "cancelled";

function matches(f: Filter, s: JobState): boolean {
  return f === "all" || (f === "active" ? isActive(s) : s === f);
}

/** Where a finished job's run has its report (GET /repairs/{name}/report), or null while it has none. A job is named
 * after its run, and an A/B test is part of its run's report. */
function reportPath(job: Job): string | null {
  return job.state === "done" ? `/repairs/${encodeURIComponent(job.name)}/report` : null;
}

/** The table's link to a finished job's report (named like the Overview's), or nothing. Left out on phones, where
 * the row opens the details and they have the report too, so the table keeps to the screen. */
function ReportLink({ job }: { job: Job }) {
  const to = useAppPath();
  const path = reportPath(job);
  if (!path) return null;
  return (
    <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
      <Link to={to(path)} aria-label={`Report of ${job.name}`}>Report</Link>
    </Button>
  );
}

function duration(j: Job): string {
  return formatDuration(elapsed(j.started, isActive(j.state) ? null : j.finished));
}

function ProgressCell({ job }: { job: Job }) {
  if (isActive(job.state)) {
    const f = job.progress?.fraction;
    return (
      <div className="min-w-40">
        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
          <span className="truncate text-muted-foreground">{job.progress?.step || (job.state === "queued" ? "Waiting to start" : "Starting")}</span>
          <span className="font-medium tabular-nums">{f == null ? "" : formatPercent(f)}</span>
        </div>
        <Progress value={f} label={`${job.name} progress`} />
      </div>
    );
  }
  if (job.state === "failed") return <span className="line-clamp-2 text-xs text-danger">{job.error || `Exit code ${job.exitCode ?? "?"}`}</span>;
  if (job.state === "cancelled") return <span className="text-xs text-muted-foreground">Stopped by request</span>;
  return <span className="text-xs text-muted-foreground">Finished {formatRelative(job.finished)}</span>;
}

function CancelDialog({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const cancel = useCancelJob();
  const { mode } = useEngine();
  return (
    <Dialog open={job !== null} onOpenChange={(o) => { if (!o) { cancel.reset(); onClose(); } }}>
      <DialogContent>
        <DialogTitle>Cancel {job?.name}?</DialogTitle>
        <DialogDescription>
          This stops the {job ? (JOB_KIND_LABEL[job.kind] ?? job.kind).toLowerCase() : "job"} and every process it started. What it
          wrote so far stays in its run folder; the source case was never touched.
          {mode === "demo" && " In the demo this only changes the recorded data in this tab."}
        </DialogDescription>
        {cancel.isError && <ErrorPanel compact className="mt-4" error={cancel.error} />}
        <DialogActions>
          <Button variant="secondary" onClick={onClose}>Keep running</Button>
          <Button
            variant="danger"
            disabled={cancel.isPending || !job}
            onClick={() => job && cancel.mutate(job.id, { onSuccess: onClose })}
          >
            <OctagonX />
            {cancel.isPending ? "Cancelling…" : "Cancel job"}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

function DetailsDialog({ job, onClose, onCancel }: { job: Job | null; onClose: () => void; onCancel: (j: Job) => void }) {
  const params = Object.entries(job?.params ?? {});
  const to = useAppPath();
  const report = job && reportPath(job);
  return (
    <Dialog open={job !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {job && (
          <>
            <div className="flex flex-wrap items-center gap-3 pr-8">
              <DialogTitle>{job.name}</DialogTitle>
              <JobStateBadge state={job.state} />
            </div>
            <DialogDescription className="font-mono text-xs break-all">{job.id}</DialogDescription>
            {isActive(job.state) && <div className="mt-5"><ProgressCell job={job} /></div>}
            {job.state === "failed" && job.error && (
              <div className="mt-5 rounded-lg border border-danger/25 bg-danger-soft/60 p-3 text-sm">{job.error}</div>
            )}
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Field label="Kind">{JOB_KIND_LABEL[job.kind] ?? job.kind}</Field>
              <Field label="Created">{formatDateTime(job.created)}</Field>
              <Field label="Started">{formatDateTime(job.started)}</Field>
              <Field label="Finished">{formatDateTime(job.finished)}</Field>
              <Field label={isActive(job.state) ? "Running for" : "Took"}>{duration(job)}</Field>
              <Field label="Exit code">{job.exitCode ?? "–"}</Field>
              <Field label="Runner">{job.runner}</Field>
              <Field label="Log" mono>{job.log || "–"}</Field>
              <Field label="Result" mono>{job.result || "–"}</Field>
            </dl>
            {params.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-medium text-muted-foreground">Parameters</p>
                <div className="mt-1.5 overflow-hidden rounded-lg border border-border">
                  {params.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 border-b border-border px-3 py-1.5 text-[13px] last:border-b-0">
                      <span className="text-muted-foreground">{k}</span>
                      <span className="truncate font-mono">{JSON.stringify(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <DialogActions>
              {isActive(job.state) && (
                <Button variant="danger-ghost" onClick={() => onCancel(job)}>
                  <OctagonX /> Cancel job
                </Button>
              )}
              <Button variant="secondary" onClick={onClose}>Close</Button>
              {report && (
                <Button asChild>
                  <Link to={to(report)}><FileText /> Open report</Link>
                </Button>
              )}
            </DialogActions>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function Jobs() {
  useTitle("Jobs");
  const jobs = useJobs();
  const [filter, setFilter] = useState<Filter>("all");
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);

  const items = useMemo(() => jobs.data?.items ?? [], [jobs.data]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: items.length, active: 0, done: 0, failed: 0, cancelled: 0 };
    for (const j of items) {
      if (isActive(j.state)) c.active++;
      else c[j.state as Exclude<Filter, "all" | "active">]++;
    }
    return c;
  }, [items]);
  const shown = items.filter((j) => matches(filter, j.state));
  // Look the job up again on every refresh, so an open dialog shows live progress.
  const details = items.find((j) => j.id === detailsId) ?? null;
  const cancelling = items.find((j) => j.id === cancelId) ?? null;
  const live = counts.active > 0;

  const label = (text: string, n: number) => (
    <span className="inline-flex items-center gap-1.5">
      {text}
      <span className="text-[11px] text-muted-foreground tabular-nums">{n}</span>
    </span>
  );

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Repairs and A/B tests the engine has run or is running. Only one big job runs at a time, to keep memory safe."
        actions={
          jobs.data && (
            <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
              <Dot tone={live ? "primary" : "neutral"} pulse={live} />
              {live ? `Live · every ${ACTIVE_POLL_MS / 1000} s` : `Updated ${formatRelative(new Date(jobs.dataUpdatedAt).toISOString())}`}
            </span>
          )
        }
      />
      {jobs.isError && <ErrorPanel className="mb-6" error={jobs.error} onRetry={() => jobs.refetch()} retrying={jobs.isFetching} />}
      <Card>
        <div className="flex items-center gap-3 border-b border-border px-3 py-3 sm:px-4">
          <Segmented
            label="Show jobs"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: label("All", counts.all) },
              { value: "active", label: label("Active", counts.active) },
              { value: "done", label: label("Done", counts.done) },
              { value: "failed", label: label("Failed", counts.failed) },
              { value: "cancelled", label: label("Cancelled", counts.cancelled) },
            ]}
          />
        </div>
        {jobs.isPending ? (
          <TableSkeleton rows={5} cols={4} />
        ) : shown.length === 0 ? (
          <EmptyState icon={ListChecks} title={items.length ? "No jobs in this view" : "No jobs yet"}>
            {items.length
              ? "Pick another filter to see the rest."
              : "Jobs are repairs and A/B tests started through the engine. They show here with live progress."}
          </EmptyState>
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Run</TH>
                <TH>State</TH>
                <TH className="hidden w-[32%] sm:table-cell">Progress</TH>
                <TH className="hidden lg:table-cell">Started</TH>
                <TH className="hidden sm:table-cell">Took</TH>
                <TH className="text-right"><span className="sr-only">Actions</span></TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((j) => (
                <TR key={j.id} className="cursor-pointer" onClick={() => setDetailsId(j.id)}>
                  <TD>
                    <button
                      type="button"
                      className="text-left font-medium underline-offset-4 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailsId(j.id);
                      }}
                    >
                      {j.name}
                    </button>
                    <div className="text-xs text-muted-foreground">{JOB_KIND_LABEL[j.kind] ?? j.kind}</div>
                    {/* Phones have no Progress column: show a running job's progress here instead. */}
                    {isActive(j.state) && <div className="mt-2 sm:hidden"><ProgressCell job={j} /></div>}
                  </TD>
                  <TD><JobStateBadge state={j.state} /></TD>
                  <TD className="hidden sm:table-cell"><ProgressCell job={j} /></TD>
                  <TD className="hidden text-[13px] whitespace-nowrap text-muted-foreground lg:table-cell" title={formatDateTime(j.started ?? j.created)}>
                    {formatRelative(j.started ?? j.created)}
                  </TD>
                  <TD className="hidden text-[13px] whitespace-nowrap tabular-nums sm:table-cell">{duration(j)}</TD>
                  <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                    {isActive(j.state) ? (
                      <Button variant="danger-ghost" size="sm" onClick={() => setCancelId(j.id)}>Cancel</Button>
                    ) : reportPath(j) ? (
                      // A finished job offers its report; its details open from its name or row, as on phones.
                      <ReportLink job={j} />
                    ) : (
                      // On phones the whole row opens the details, so the button is left out.
                      <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => setDetailsId(j.id)}>
                        Details
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <DetailsDialog
        job={details}
        onClose={() => setDetailsId(null)}
        onCancel={(j) => {
          setDetailsId(null);
          setCancelId(j.id);
        }}
      />
      <CancelDialog job={cancelling} onClose={() => setCancelId(null)} />
    </>
  );
}
