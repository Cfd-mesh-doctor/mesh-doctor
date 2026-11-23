// SPDX-License-Identifier: GPL-3.0-or-later
// The engine at a glance: what it is, its cases, its repair runs (each finished one opens its report) and what is
// running now; on your own engine, until its first repair run, the steps to one (Getting started).
import { ArrowRight, Check, Cpu, FolderOpen, ListChecks, Terminal, Wrench } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import { CopyBlock } from "@/components/shared/CopyBlock";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { DashboardLink } from "@/components/shared/DashboardLink";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { NoJobsYet } from "@/components/shared/NoJobsYet";
import { JobStateBadge, VerdictBadge } from "@/components/shared/badges";
import { EmptyState, PageHeader, StatTile, TableSkeleton } from "@/components/shared/page";
import { Badge, Dot } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardTitleRow, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { repairCommand } from "@/engine/commands";
import { useAppPath, useEngine, usePairing } from "@/engine/context";
import { useCases, useEngineInfo, useJobs, useRepairs } from "@/engine/hooks";
import { JOB_KIND_LABEL, isActive } from "@/engine/types";
import { caseName, improvedCleanly, madeWorse, newestFirst, runStep, runUpdated } from "@/engine/verdict";
import { formatCells, formatCount, formatRelative } from "@/lib/format";
import { DOCS } from "@/lib/site";
import { useTitle } from "@/lib/useTitle";
import { cn } from "@/lib/utils";
import { FIRST_RUN_SETUP } from "@/pages/install/commands";
import { jobOf, runLink, shownJobState } from "./runs";

/** Repairs a copy of a case, in WSL or a Linux terminal; the app can't start repairs itself yet. */
const REPAIR_COMMAND = "meshdoctor full <case> <name>";
/** What the command's two blanks stand for: `<name>` could be read as your own name. */
const BLANKS = (
  <>
    (putting a case's name in place of <code className="font-mono text-[12px]">&lt;case&gt;</code>, and a name for
    the repaired copy in place of <code className="font-mono text-[12px]">&lt;name&gt;</code>)
  </>
);

const LINK = "font-medium text-primary underline-offset-4 hover:underline";
/** How many repair runs the Overview lists: the newest. */
const RUNS_SHOWN = 6;

/** Where a Getting started step is: ticked off, the one to do now, under way (a repair job is waiting or running), or
 * waiting for the steps before it. */
type StepState = "done" | "next" | "running" | "later";

interface Step {
  title: string;
  state: StepState;
  text: ReactNode;
  /** What to run, on the step to do now: one command, or a few lines. */
  command?: string;
  block?: string;
}

/** Each state's round mark: a tick, else the step's number. */
const MARK: Record<StepState, string> = {
  done: "bg-success-soft text-success",
  next: "bg-primary text-primary-foreground",
  running: "bg-primary-soft text-primary",
  later: "bg-surface-2 text-muted-foreground ring-1 ring-inset ring-border",
};

/** Each state in words, beside the step's title: not by colour alone. A step that waits has none. */
function StepLabel({ state }: { state: StepState }) {
  if (state === "done") return <Badge tone="success">Done</Badge>;
  if (state === "next") return <Badge tone="primary">Next</Badge>;
  if (state === "running") return <Badge tone="primary"><Dot tone="primary" pulse />Running</Badge>;
  return null;
}

/**
 * A newcomer's three steps to a first repair, each ticked off from what the engine lists: 1. the engine answers (it
 * has, or this wouldn't show), 2. a case in its cases folder (else the README's First run, which sets up OpenFOAM's
 * motorBike tutorial where the engine looks), 3. a repair of a copy (the first case's command, with the names filled
 * in). The first step not done is the one thing to do next. `cases`: the cases the engine found; `repairing`: a repair
 * job is waiting or running, so a first run is on its way.
 */
function GettingStarted({ cases, repairing }: { cases: readonly string[]; repairing: boolean }) {
  const to = useAppPath();
  const id = useId();
  const casesScreen = (label: string) => <Link to={to("/cases")} className={LINK}>{label}</Link>;
  // The first case the engine finds by its name alone, so its command needs no blanks filled in.
  const first = cases.find((c) => repairCommand(c, []) !== null);
  const repair: Step = !cases.length
    ? { title: "Repair a copy", state: "later", text: "Then one command repairs a copy of it, never the case itself." }
    : repairing
      ? {
          title: "Repair a copy",
          state: "running",
          text: (
            <>
              A repair is under way, and shows on this page once its copy is made. Its progress is on the{" "}
              <Link to={to("/jobs?show=active")} className={LINK}>Jobs screen</Link>.
            </>
          ),
        }
      : first
        ? {
            title: "Repair a copy",
            state: "next",
            command: repairCommand(first, []) ?? undefined,
            text: (
              <>
                Run this in a WSL or Linux terminal. It repairs a copy of{" "}
                <code className="font-mono text-[12px]">{first}</code>, never the case itself. The run shows on this page
                once the copy is made, and its verdict when it finishes.
                {cases.length > 1 && <> Each other case has its own command on the {casesScreen("Cases screen")}.</>}
              </>
            ),
          }
        : {
            // No case the engine finds by its name alone: the command with its blanks, said in words.
            title: "Repair a copy",
            state: "next",
            command: REPAIR_COMMAND,
            text: (
              <>
                Run this in a WSL or Linux terminal {BLANKS}. It repairs a copy, never the case itself. The run shows on
                this page once the copy is made, and its verdict when it finishes.
              </>
            ),
          };
  const steps: Step[] = [
    {
      title: "Connect to the engine",
      state: "done",
      text: "Mesh Doctor is running on this computer, and this browser is paired with it.",
    },
    cases.length
      ? {
          title: "Add a case",
          state: "done",
          text: <>{casesScreen(formatCount(cases.length, "case"))} in the engine's cases folder.</>,
        }
      : {
          title: "Add a case",
          state: "next",
          // The README's First run, its set-up here to copy: a newcomer needn't leave the app to find what to type.
          block: FIRST_RUN_SETUP.join("\n"),
          text: (
            <>
              None found yet. To try Mesh Doctor on OpenFOAM's motorBike tutorial, run these in a WSL or Linux
              terminal: they copy the tutorial into $FOAM_RUN, where the engine looks, and mesh it, which takes a few
              minutes. The README's{" "}
              <a href={DOCS.firstRun} target="_blank" rel="noreferrer" className={LINK}>First run</a> has the rest. For
              cases of your own, the {casesScreen("Cases screen")} says how to point the engine at their folder.
            </>
          ),
        },
    repair,
  ];
  const done = steps.filter((s) => s.state === "done").length;
  return (
    <Card className="mb-6" aria-labelledby={id} data-tour="start">
      <CardHeader className="block">
        <CardTitleRow>
          <CardTitle id={id}>Getting started</CardTitle>
          <span className="shrink-0 text-[13px] whitespace-nowrap text-muted-foreground">
            {done} of {steps.length} done
          </span>
        </CardTitleRow>
        <CardDescription>Three steps to your first repair. Each ticks itself off once the engine lists it.</CardDescription>
      </CardHeader>
      <ol className="divide-y divide-border border-t border-border">
        {steps.map((s, i) => (
          <li key={s.title} aria-current={s.state === "next" ? "step" : undefined} className="flex gap-3 px-5 py-3.5">
            <span aria-hidden
              className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold", MARK[s.state])}>
              {s.state === "done" ? <Check className="size-3.5" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className={cn("text-sm font-medium", s.state === "later" && "text-muted-foreground")}>{s.title}</h3>
                <StepLabel state={s.state} />
              </div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{s.text}</p>
              {s.command && <CopyCommand command={s.command} className="mt-3 max-w-xl" />}
              {s.block && <CopyBlock code={s.block} className="mt-3 max-w-3xl" />}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

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
  // The engine has answered that it has no repair runs yet (not: the list didn't load).
  const noRuns = repairs.isSuccess && repairItems.length === 0;
  // A newcomer's steps to a first repair, at the top of your own engine's Overview (the demo has runs already) until
  // its first repair run is listed. Not while its cases are unknown: a list that didn't load isn't empty.
  const gettingStarted = mode === "engine" && noRuns && cases.isSuccess;
  // What didn't load, and why, at the top: the engine's own answer first, else the first list that failed. Try again
  // asks again for each one that failed.
  const queries = [info, cases, jobs, repairs];
  const failed = queries.find((q) => q.isError);
  // Easier than filling in the command's blanks: each case's own command, on the Cases screen.
  const ownCommands = (
    <>
      On the{" "}
      <Link to={to("/cases")} className="font-medium text-primary underline-offset-4 hover:underline">Cases screen</Link>,
      each case has its own, with the names filled in.
    </>
  );

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
      {gettingStarted && (
        <GettingStarted cases={cases.data?.items ?? []} repairing={active.some((j) => j.kind === "repair")} />
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
          hint={!repairs.data ? undefined : repairItems.length ? (
            `${improved} improved, ${worse ? `${worse} made worse` : "none worse"}`
          ) : (
            // Not "0 improved, none worse": before the first run there is nothing to compare yet.
            "None yet"
          )}
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
          ) : jobItems.length ? `${formatCount(jobItems.length, "job")} on record` : (
            // Not "0 jobs on record": as the list under it says, none has been started yet.
            "No jobs yet"
          )}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader className="block">
            <CardTitleRow>
              <CardTitle>Recent jobs</CardTitle>
              <Link
                to={to("/jobs")}
                className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium whitespace-nowrap text-primary hover:underline"
              >
                All jobs <ArrowRight className="size-3.5" />
              </Link>
            </CardTitleRow>
            <CardDescription>Repairs and A/B tests, newest first</CardDescription>
          </CardHeader>
          {jobs.isPending ? (
            <TableSkeleton rows={4} cols={3} />
          ) : jobItems.length === 0 ? (
            // A list that didn't load isn't empty: the message at the top says why, and no first steps are offered.
            jobs.isError ? <EmptyState icon={ListChecks} title="The jobs didn't load" /> : <NoJobsYet here />
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
          {/* Like Recent jobs: the screen with every run is a link beside the title. */}
          <CardHeader className="block">
            <CardTitleRow>
              <CardTitle>Repair runs</CardTitle>
              <Link
                to={to("/repairs")}
                className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium whitespace-nowrap text-primary hover:underline"
              >
                All repairs <ArrowRight className="size-3.5" />
              </Link>
            </CardTitleRow>
            <CardDescription>Newest first. The verdict compares checkMesh before and after</CardDescription>
          </CardHeader>
          {repairs.isPending ? (
            <TableSkeleton rows={4} cols={2} />
          ) : repairs.isError && repairItems.length === 0 ? (
            <EmptyState icon={Wrench} title="The repair runs didn't load" />
          ) : noRuns && gettingStarted ? (
            // Getting started, at the top of the page, has the steps to the first run and its command: not again here.
            <EmptyState icon={Wrench} title="No repair runs yet">
              Each repair shows here once its copy is made, and its verdict and report when it finishes.
            </EmptyState>
          ) : noRuns ? (
            // The first step, where you look for your runs, when Getting started doesn't show (the cases didn't load):
            // the command card at the bottom of the page gives way to it.
            <EmptyState icon={Wrench} title="No repair runs yet"
              action={<CopyCommand command={REPAIR_COMMAND} className="max-w-full text-left" />}>
              Repair a copy of one of{" "}
              <Link to={to("/cases")} className="font-medium text-primary underline-offset-4 hover:underline">your cases</Link>{" "}
              with this in a WSL or Linux terminal {BLANKS}, or from the engine's dashboard: the run shows here once its
              copy is made.{" "}
              {ownCommands}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {newestFirst(repairItems).slice(0, RUNS_SHOWN).map((r) => {
                const job = jobOf(jobItems, r.name);
                const link = runLink(r, job);
                const state = shownJobState(r, job);
                return (
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
                  {/* A list's own badge: a run with no verdict says so, not with a dash; one that a job is making says
                      what the job is doing (running, failed, cancelled), as on the Repairs screen. */}
                  {state ? (
                    <JobStateBadge state={state} />
                  ) : (
                    <VerdictBadge verdict={r.verdict} pending={runStep(r)} empty="No verdict" />
                  )}
                  {/* Its report, or else its job's progress or details. */}
                  {link && (
                    <Link to={to(link.path)} aria-label={`${link.label} of ${r.name}`}
                      className="shrink-0 text-[13px] font-medium text-primary hover:underline">
                      {link.label}
                    </Link>
                  )}
                </li>
                );
              })}
            </ul>
          )}
          {/* The list keeps to the newest: it says there are more, where they all are, and where each case's latest is. */}
          {repairItems.length > RUNS_SHOWN && (
            <p className="border-t border-border px-5 py-3 text-[13px] text-muted-foreground">
              The {RUNS_SHOWN} newest of {formatCount(repairItems.length, "run")}. All of them are on the{" "}
              <Link to={to("/repairs")} className={LINK}>Repairs screen</Link>, and each case&apos;s latest on the{" "}
              <Link to={to("/cases")} className={LINK}>Cases screen</Link>.
            </p>
          )}
        </Card>
      </div>

      {/* Once the runs are known, or didn't load: an engine with none has the command in Getting started or its empty
          list instead, so showing the card while they load would show it and then take it away again. */}
      {!repairs.isPending && !noRuns && (
        <Card className="mt-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <Terminal className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            {/* Says how to start one now, rather than only that the app can't yet: this card is where the engine's
                dashboard stays linked once the empty lists that first offer it have gone. */}
            <CardTitle>Start a repair</CardTitle>
            <CardDescription>
              From <DashboardLink />, or with this command in a WSL or Linux terminal {BLANKS}: the run shows under Repair
              runs once its copy is made.{" "}
              {ownCommands} It works on a copy, so your case is never changed. Starting repairs from this app comes next.
            </CardDescription>
          </div>
          <CopyCommand command={REPAIR_COMMAND} className="sm:w-80" />
        </Card>
      )}
    </>
  );
}
