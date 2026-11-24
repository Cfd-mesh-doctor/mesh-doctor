// SPDX-License-Identifier: GPL-3.0-or-later
// Every job on the engine: live progress while running, details, cancelling (after a confirmation), the report of a
// finished repair's run, an A/B job's test page, a new case on Cases, and a solve's or a transient plan's run page. The
// filter lives in the address (?show=failed), so a reload or a link keeps it.
import { FileText, FlaskConical, FolderOpen, Hourglass, ListChecks, OctagonX, Play } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { DashboardLink } from "@/components/shared/DashboardLink";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { JobStateBadge } from "@/components/shared/badges";
import { NoJobsYet } from "@/components/shared/NoJobsYet";
import { EmptyState, Field, PageHeader, TableSkeleton } from "@/components/shared/page";
import { withVariant } from "@/components/shared/withVariant";
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
import { settingsOf, stepText } from "@/report/abtest";
import { caseStep } from "./caseStart";

const FILTERS = ["all", "active", "done", "failed", "cancelled"] as const;
type Filter = (typeof FILTERS)[number];

function matches(f: Filter, s: JobState): boolean {
  return f === "all" || (f === "active" ? isActive(s) : s === f);
}

/** An A/B test, or its continuation to more iterations. */
const isAbJob = (job: Job) => job.kind === "abtest" || job.kind === "abextend";
/** A solve, or a transient plan of a run: both show on the run's page (Run.tsx), and are named after the run. */
const isRunJob = (job: Job) => job.kind === "solve" || job.kind === "tplan";

/** Where a job's run shows, or null while it has nothing to show. A job is named after its run. An A/B job's is its
 * test's page, running or not: it follows a running test, and says how a stopped one ended. A solve's and a transient
 * plan's is the run's page, running or not too: it follows the solve (or says it is starting, or why it didn't), and
 * shows the plan (or that it is being made). A repair's is its run's report, once the repair is done
 * (GET /repairs/{name}/report). A new case's is the case on Cases, once it has its mesh. A picture job's pictures
 * have no page yet (the Pictures screen is to come), so it has none. */
function runPath(job: Job): string | null {
  if (isAbJob(job)) return `/abtests/${encodeURIComponent(job.name)}`;
  if (isRunJob(job)) return `/solve/${encodeURIComponent(job.name)}`;
  if (job.state !== "done") return null;
  if (job.kind === "case") return `/cases?q=${encodeURIComponent(job.name)}`;
  return job.kind === "repair" ? `/repairs/${encodeURIComponent(job.name)}/report` : null;
}

/** The table's link to where a job's run shows, named like the Overview's report links and the A/B tests list's
 * buttons, or nothing. Left out on phones, where the row opens the details and they have it too, so the table keeps
 * to the screen. */
function RunLink({ job }: { job: Job }) {
  const to = useAppPath();
  const path = runPath(job);
  if (!path) return null;
  const what = job.kind === "solve" ? `the run ${job.name}` : `the A/B test of ${job.name}`;
  const [text, label] = job.kind === "case"
    ? ["Case", `The case ${job.name} on Cases`]
    : job.kind === "tplan"
    ? ["Plan", `The transient plan of ${job.name}`]
    : !isAbJob(job) && job.kind !== "solve"
    ? ["Report", `Report of ${job.name}`]
    : isActive(job.state)
      ? ["Follow", `Follow ${what}`]
      : ["Open", `Open ${what}`];
  return (
    <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
      <Link to={to(path)} aria-label={label}>{text}</Link>
    </Button>
  );
}

function duration(j: Job): string {
  return formatDuration(elapsed(j.started, isActive(j.state) ? null : j.finished));
}

/** A job's progress. `jobs`: every job, whose A/B test job says whether a continuation's test is of solver settings. */
function ProgressCell({ job, jobs }: { job: Job; jobs?: readonly Job[] }) {
  if (isActive(job.state)) {
    const f = job.progress?.fraction;
    // An A/B job's step reads as on its test's page ("Solving on the repaired mesh", not "solving fixed"). A long step
    // takes a second line: on one, it widened the column and took the room a job's name needs for its line.
    const settings = isAbJob(job) ? settingsOf(job.name, { jobs: jobs ?? [job] }) : null;
    const step = isAbJob(job) ? stepText(job.progress?.step, settings)
      : job.kind === "case" ? caseStep(job.progress?.step) : job.progress?.step;
    return (
      <div className="min-w-40">
        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
          <span className="line-clamp-2 text-muted-foreground">
            {step ? withVariant(step, settings) : job.state === "queued" ? "Waiting to start" : "Starting"}
          </span>
          <span className="shrink-0 font-medium whitespace-nowrap tabular-nums">{f == null ? "" : formatPercent(f)}</span>
        </div>
        <Progress value={f} label={`${job.name} progress`} />
      </div>
    );
  }
  if (job.state === "failed") return <span className="line-clamp-2 text-xs text-danger">{job.error || `Exit code ${job.exitCode ?? "?"}`}</span>;
  if (job.state === "cancelled") return <span className="text-xs text-muted-foreground">Stopped by request</span>;
  return <span className="text-xs text-muted-foreground">Finished {formatRelative(job.finished)}</span>;
}

function CancelDialog({ job, onClose, nameOf }: {
  job: Job | null;
  onClose: () => void;
  /** The job's name in the table, if it shows there. */
  nameOf: (id: string) => HTMLElement | undefined;
}) {
  const cancel = useCancelJob();
  const { mode } = useEngine();
  // What had the focus when the confirmation opened, the job it asks about, and whether that job was cancelled: all
  // still known while it closes.
  const opener = useRef<HTMLElement | null>(null);
  const shown = useRef<string | null>(null);
  const cancelled = useRef(false);
  return (
    <Dialog open={job !== null} onOpenChange={(o) => { if (!o) { cancel.reset(); onClose(); } }}>
      <DialogContent
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
          shown.current = job?.id ?? null;
          cancelled.current = false;
        }}
        onCloseAutoFocus={(e) => {
          // Radix hands the focus back only to a Dialog.Trigger. It goes back to the row's Cancel button that asked,
          // or to the job's name when the job was cancelled (its Cancel button is about to go) or when the
          // confirmation replaced the job's details.
          e.preventDefault();
          const el = opener.current;
          const back = !cancelled.current && el?.isConnected ? el : shown.current ? nameOf(shown.current) : undefined;
          back?.focus();
        }}
      >
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
            onClick={() => job && cancel.mutate(job.id, {
              onSuccess: () => {
                cancelled.current = true;
                onClose();
              },
            })}
          >
            <OctagonX />
            {cancel.isPending ? "Cancelling…" : "Cancel job"}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

function DetailsDialog({ job, jobs, onClose, onCancel, nameOf }: {
  job: Job | null;
  /** Every job, for an A/B job's step (ProgressCell). */
  jobs?: readonly Job[];
  onClose: () => void;
  onCancel: (j: Job) => void;
  /** The job's name in the table, if it shows there. */
  nameOf: (id: string) => HTMLElement | undefined;
}) {
  const params = Object.entries(job?.params ?? {});
  const to = useAppPath();
  const run = job && runPath(job);
  // The details open on Close, the calm way out. The first button is otherwise an active job's red "Cancel job": it
  // only asks to confirm, but a key pressed straight after opening shouldn't start a cancel.
  const close = useRef<HTMLButtonElement>(null);
  // The job whose details are open, still known while they close (when `job` is already null).
  const shown = useRef<string | null>(null);
  return (
    <Dialog open={job !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-2xl"
        onOpenAutoFocus={(e) => {
          shown.current = job?.id ?? null;
          if (!close.current) return;
          e.preventDefault();
          close.current.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(e) => {
          // Radix hands the focus back only to a Dialog.Trigger, and the details open from the address. So the
          // focus goes back to the job's name, rather than to the page itself, unless the cancel confirmation that
          // replaced the details has it.
          e.preventDefault();
          const active = document.activeElement;
          if (active && active !== document.body && active.isConnected) return;
          if (shown.current) nameOf(shown.current)?.focus();
        }}
      >
        {job && (
          <>
            <div className="flex flex-wrap items-center gap-3 pr-8">
              <DialogTitle>{job.name}</DialogTitle>
              <JobStateBadge state={job.state} />
            </div>
            <DialogDescription className="font-mono text-xs wrap-anywhere">{job.id}</DialogDescription>
            {isActive(job.state) && <div className="mt-5"><ProgressCell job={job} jobs={jobs} /></div>}
            {job.state === "failed" && job.error && (
              <div className="mt-5 rounded-lg border border-danger/25 bg-danger-soft/60 p-3 text-sm">{job.error}</div>
            )}
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Field label="Kind">{JOB_KIND_LABEL[job.kind] ?? job.kind}</Field>
              <Field label="Created">{formatDateTime(job.created)}</Field>
              <Field label="Started">{formatDateTime(job.started)}</Field>
              <Field label="Finished">{formatDateTime(job.finished)}</Field>
              {/* A queued job isn't running yet: it says how long it has waited. */}
              {job.state === "queued" ? (
                <Field label="Waiting for">{formatDuration(elapsed(job.created, null))}</Field>
              ) : (
                <Field label={isActive(job.state) ? "Running for" : "Took"}>{duration(job)}</Field>
              )}
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
              <Button ref={close} variant="secondary" onClick={onClose}>Close</Button>
              {run && (
                <Button asChild>
                  <Link to={to(run)}>
                    {isAbJob(job) ? <><FlaskConical /> Open A/B test</>
                      : job.kind === "case" ? <><FolderOpen /> Open on Cases</>
                      : job.kind === "solve" ? <><Play /> Open the run</>
                      : job.kind === "tplan" ? <><Hourglass /> Open the plan</>
                      : <><FileText /> Open report</>}
                  </Link>
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
  const to = useAppPath();
  const jobs = useJobs();
  // The filter and the job whose details are open live in the address, so a reload or a link keeps them. No
  // filter, or a word the page doesn't know, shows every job; a job that isn't on record opens nothing.
  const [params, setParams] = useSearchParams();
  const setParam = (key: "show" | "job", value: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === null) next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true, preventScrollReset: true });
  const filter: Filter = FILTERS.find((f) => f === params.get("show")) ?? "all";
  const setFilter = (f: Filter) => setParam("show", f === "all" ? null : f);
  const detailsId = params.get("job");
  const setDetailsId = (id: string | null) => setParam("job", id);
  const [cancelId, setCancelId] = useState<string | null>(null);
  // Each job's name in the table: the focus goes back to it when the job's details close.
  const names = useRef(new Map<string, HTMLButtonElement>());

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
  // Open details have an address of their own, so the tab names the job too: a bookmark or history entry tells it apart.
  useTitle(details ? `${details.name} · Jobs` : "Jobs");
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
        description={
          // Where jobs start stays said once there are some (the empty list says it too, with its own button), and
          // where a repair run in a terminal shows instead, as it isn't a job.
          <>
            Repairs and A/B tests the engine has run or is running, started here or from <DashboardLink />. Repairs start
            from the Cases and Repairs screens, A/B tests from the A/B tests screen and a finished repair&apos;s report; a
            repair run in a terminal shows on the{" "}
            <Link to={to()} className="font-medium text-primary underline-offset-4 hover:underline">Overview</Link>{" "}
            instead. Only one big job runs at a time, to keep memory safe.
          </>
        }
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
      <Card data-tour="jobs">
        <div className="flex items-center gap-3 border-b border-border px-3 py-3 sm:px-4">
          {/* Its five choices and their counts need 356 px, more than a phone up to 414 px wide has: the ones that
              don't fit go on to a second line, rather than Cancelled being cut at the edge. */}
          <Segmented
            label="Show jobs"
            wrap
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
        ) : !items.length ? (
          // A list that didn't load isn't empty: the message above says why, and no first steps are offered.
          jobs.isError ? <EmptyState icon={ListChecks} title="The jobs didn't load" /> : <NoJobsYet />
        ) : shown.length === 0 ? (
          // The Overview links the active jobs: once they are over, this says so plainly.
          <EmptyState icon={ListChecks} title={filter === "active" ? "No job is running or waiting" : "No jobs in this view"}>
            Pick another filter to see the rest.
          </EmptyState>
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                {/* A column shows from the width where the card has room for it, so the table never scrolls its
                    Cancel and Report out of sight: Progress from sm, Duration from md, Started from xl (at lg the
                    sidebar takes the room). At 640 and 1024 px the table was 25 and 37 px wider than its card.
                    Progress takes a third of the table only from xl: below that, a job's name has its line first. */}
                <TH>Run</TH>
                <TH>State</TH>
                <TH className="hidden sm:table-cell xl:w-[32%]">Progress</TH>
                <TH className="hidden xl:table-cell">Started</TH>
                {/* Not "Took": a running job's time is how long it has run so far. */}
                <TH className="hidden md:table-cell">Duration</TH>
                <TH className="text-right"><span className="sr-only">Actions</span></TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((j) => (
                <TR key={j.id} className="cursor-pointer" onClick={() => setDetailsId(j.id)}>
                  <TD>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) names.current.set(j.id, el);
                        return () => { names.current.delete(j.id); };
                      }}
                      // From 768 px a name keeps its line: the table shares its spare room by how long each
                      // column's text is, so a long step took it from the names, which broke at a hyphen.
                      className="text-left font-medium underline-offset-4 hover:underline md:whitespace-nowrap"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailsId(j.id);
                      }}
                    >
                      {j.name}
                    </button>
                    <div className="text-xs text-muted-foreground">{JOB_KIND_LABEL[j.kind] ?? j.kind}</div>
                    {/* Phones have no Progress column: show a running job's progress here instead. */}
                    {isActive(j.state) && <div className="mt-2 sm:hidden"><ProgressCell job={j} jobs={jobs.data?.items} /></div>}
                  </TD>
                  <TD><JobStateBadge state={j.state} /></TD>
                  <TD className="hidden sm:table-cell"><ProgressCell job={j} jobs={jobs.data?.items} /></TD>
                  <TD className="hidden text-[13px] whitespace-nowrap text-muted-foreground xl:table-cell" title={j.started ? formatDateTime(j.started) : undefined}>
                    {/* A queued job hasn't started: its creation time isn't its start. */}
                    {j.started ? formatRelative(j.started) : "–"}
                  </TD>
                  <TD className="hidden text-[13px] whitespace-nowrap tabular-nums md:table-cell">{duration(j)}</TD>
                  <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                    {isActive(j.state) ? (
                      // A running A/B test or solve can be followed on its own page too. Its two buttons sit one
                      // above the other: side by side (even at 1280 px), they took the room a job's name needs for
                      // its line.
                      <div className="flex flex-col items-end gap-1">
                        <RunLink job={j} />
                        <Button variant="danger-ghost" size="sm" onClick={() => setCancelId(j.id)}>Cancel</Button>
                      </div>
                    ) : runPath(j) ? (
                      // A finished repair offers its report, an A/B job its test's page and a solve or a plan its
                      // run's page; the details open from the job's name or row, as on phones.
                      <RunLink job={j} />
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
        jobs={jobs.data?.items}
        nameOf={(id) => names.current.get(id)}
        onClose={() => setDetailsId(null)}
        onCancel={(j) => {
          setDetailsId(null);
          setCancelId(j.id);
        }}
      />
      <CancelDialog job={cancelling} nameOf={(id) => names.current.get(id)} onClose={() => setCancelId(null)} />
    </>
  );
}
