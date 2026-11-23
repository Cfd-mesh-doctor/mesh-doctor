// SPDX-License-Identifier: GPL-3.0-or-later
// One A/B test (GET /abtests/{name}): what it is doing, whether the repair helped the solver (the report viewer's
// table and residual chart), and the judge's verdict on each run. While it runs the screen asks again every 3 s, so
// the chart grows; while the repaired-mesh run solves, the engine's live monitor adds its iteration, pace and a
// judge so far. A run is judged (GET /abtests/{name}/judge) once it has ended. Run longer continues the second run
// of a test that has ended (StartAbTest.tsx); a test just started shows as waiting until its job makes its folder.
import { ArrowLeft, FastForward, FileText, ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { AbStateBadge } from "@/components/shared/badges";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { PageHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { useAppPath, useEngine } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { ACTIVE_POLL_MS, IDLE_POLL_MS, useAbtest, useAbtestJudge, useAbtestLive, useJobs, useRepairs } from "@/engine/hooks";
import { isActive, type AbtestDetail, type AbtestLive, type Job } from "@/engine/types";
import { caseName } from "@/engine/verdict";
import { formatCount, formatDateTime, formatDuration, formatInt, formatPercent, formatRelative } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import { AbCard, JudgeCard, ResidualCard } from "@/pages/report/AbCards";
import { Section } from "@/pages/report/Section";
import {
  abJobOf, abState, lastIteration, liveHistory, outcome, stepSide, stepText, type AbState,
} from "@/report/abtest";
import { abSummary, judgeOf } from "@/report/summary";
import { ExtendAbTestDialog, type ExtendTarget } from "./StartAbTest";
import { secondRunAt } from "./abStart";

const LINK = "font-medium text-primary underline-offset-4 hover:underline";

/** How often to ask for the test again: every 3 s while its job runs; every 15 s while it isn't done and no job says
 * why (it may be running in a terminal); not again once it has ended. */
function every(state: AbState): number | false {
  return state === "running" ? ACTIVE_POLL_MS : state === "unfinished" ? IDLE_POLL_MS : false;
}

/** The outcome in a sentence, from the residual ratios. */
function outcomeSentence(o: ReturnType<typeof outcome>, fields: number): string {
  if (!o) return "Both runs have ended, but there are no residuals to compare.";
  const over = fields > 1 ? ` (the geometric mean over ${formatCount(fields, "field")})` : "";
  return `On the repaired mesh the residuals end at ${o.ratio.toFixed(2)}× those on the original mesh${over}, ${
    o.change === "better" ? "so the repair helped the solver." : o.change === "worse" ? "so the solver did not benefit." : "so both meshes converge about the same."
  }`;
}

/** What the live monitor says of the repaired-mesh run: iteration, pace, time left. */
function solverLine(live: AbtestLive | undefined): string | null {
  const s = live?.solver;
  if (!s || s.state === "pending") return null;
  const parts = [
    s.iteration != null && `iteration ${formatInt(s.iteration)} of ${formatInt(s.end)}`,
    s.wall_per_it != null && `${s.wall_per_it.toFixed(2)} s per iteration`,
    s.state === "running" && s.eta != null && `about ${formatDuration(s.eta)} left`,
  ].filter((x): x is string => typeof x === "string");
  if (s.state === "stopped") parts.push(`its log hasn't changed for ${formatDuration(s.idle_s ?? 300)}`);
  if (s.state === "error") parts.push("the solver stopped with an error");
  return parts.length ? parts.join(" · ") : null;
}

/** The status card's title: the step while it runs, else what came of it. */
function title(state: AbState, running: boolean, step: string | null, o: ReturnType<typeof outcome>): string {
  if (running) return stepText(step) ?? "Running";
  if (state === "done" || state === "changed") {
    return !o ? "No residuals to compare" : o.change === "better" ? "The repair helped the solver"
      : o.change === "worse" ? "The solver did not benefit" : "About the same on both meshes";
  }
  if (state === "failed") return "Stopped with an error";
  if (state === "cancelled") return "Cancelled";
  return stepText(step) ?? "Not started yet";
}

function StatusCard({ state, detail, job, live, liveError }: {
  state: AbState;
  detail: AbtestDetail;
  job: Job | undefined;
  live: AbtestLive | undefined;
  liveError: unknown;
}) {
  const to = useAppPath();
  const step = detail.status?.step ?? job?.progress?.step ?? null;
  const ratios = detail.result?.residualRatioFixedOverBase ?? {};
  const fields = Object.values(ratios).filter((r) => typeof r === "number" && r > 0).length;
  const o = outcome(Object.fromEntries(Object.entries(ratios).filter((e): e is [string, number] => typeof e[1] === "number")));
  const running = state === "running" || (state === "unfinished" && live?.solver.state === "running");
  const solver = stepSide(step) === "fixed" ? solverLine(live) : null;
  // The live monitor's iteration gives the run's progress; else the job's own fraction.
  const s = live?.solver;
  const fraction = stepSide(step) === "fixed" && s?.iteration != null && s.end > 0 ? s.iteration / s.end : job?.progress?.fraction;
  const jobLink = job && (
    <Link to={to(`/jobs?job=${encodeURIComponent(job.id)}`)} className={LINK}>its job</Link>
  );
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>{title(state, running, step, o)}</CardTitle>
          <CardDescription>
            {detail.result?.finished && (state === "done" || state === "changed")
              ? `Both runs ended ${formatRelative(detail.result.finished)} (${formatDateTime(detail.result.finished)})`
              : detail.status?.time ? `This step began ${formatRelative(detail.status.time)}` : "No step recorded yet"}
          </CardDescription>
        </div>
        <AbStateBadge state={running ? "running" : state} queued={job?.state === "queued"} />
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {running && (
          <div>
            <Progress value={fraction} label={`Progress of the A/B test of ${detail.result?.label ?? "this run"}`} />
            <p className="mt-2 text-[13px] text-muted-foreground">
              {[fraction != null && formatPercent(fraction), solver].filter(Boolean).join(" · ") || "Under way"}
            </p>
          </div>
        )}
        {(state === "done" || state === "changed") && <p className="text-[15px] leading-relaxed">{outcomeSentence(o, fields)}</p>}
        {state === "changed" && (
          <p className="text-warning">
            The source case changed while the test ran, so the two runs may not have solved the same case. Run the test
            again on a case that stays as it is.
          </p>
        )}
        {state === "failed" && (
          <p className="text-danger">
            {job?.error || `It stopped with exit code ${job?.exitCode ?? "?"}.`} See {jobLink} for its log.
          </p>
        )}
        {state === "cancelled" && <p className="text-muted-foreground">Stopped by request. See {jobLink}.</p>}
        {state === "unfinished" && !running && (
          <p className="text-muted-foreground">
            {solver ? `The repaired-mesh run: ${solver}. ` : ""}
            No job in this app is making it: it may be running in a terminal, or have stopped there. This screen asks the
            engine again every 15 s.
          </p>
        )}
        {running && liveError != null && stepSide(step) === "fixed" && (
          <p className="text-[13px] text-muted-foreground">{asEngineError(liveError).message}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ModesCard({ modes }: { modes: AbtestDetail["modes"] }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Where the solution swings</CardTitle>
          <CardDescription>
            Where the repaired-mesh run's solution moves between two times a few hundred iterations apart: a slow swing
            that a shorter judge window can mistake for a settled run.
          </CardDescription>
        </div>
      </CardHeader>
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Iterations</TH>
            <TH className="text-right">Near mesh defects</TH>
            <TH>Largest swing</TH>
          </TR>
        </THead>
        <TBody>
          {modes.map((m, i) => {
            const top = m.top[0];
            return (
              <TR key={i}>
                <TD className="tabular-nums whitespace-nowrap">{String(m.from ?? "?")} → {String(m.to ?? "?")}</TD>
                <TD className="text-right tabular-nums">{m.nearDefects == null ? "–" : formatPercent(m.nearDefects)}</TD>
                <TD className="text-[13px]">
                  {top ? [
                    `${formatPercent(top.share)} of the change`,
                    formatCount(top.nCells, "cell"),
                    `at ${top.centroid.map((v) => Number(v.toFixed(3))).join(", ")} m`,
                    top.maxNonOrtho != null && `non-orthogonality up to ${top.maxNonOrtho.toFixed(0)}°`,
                  ].filter(Boolean).join(" · ") : "–"}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </Card>
  );
}

export function AbTest() {
  const { name = "" } = useParams();
  useTitle(`A/B test of ${name}`);
  const { mode } = useEngine();
  const to = useAppPath();
  const jobs = useJobs();
  const job = abJobOf(jobs.data?.items, name);
  const repairs = useRepairs();
  // The test's state: its job's, and its own step's once the engine has answered.
  const first = useAbtest(name, (d) => every(abState(d?.status?.step, job)));
  const detail = first.data;
  const step = detail?.status?.step ?? null;
  const state = abState(step, job);
  const solving = (state === "running" || state === "unfinished") && stepSide(step) === "fixed";
  const live = useAbtestLive(name, solving);
  const history = useMemo(() => (detail ? liveHistory(detail.live) : null), [detail]);
  const ab = useMemo(() => abSummary(detail?.result), [detail]);
  const fixedEnd = lastIteration(history?.repaired ?? null);
  const baseDone = detail?.result?.base != null;
  const fixedDone = detail?.result?.fixed != null && state !== "running" && state !== "unfinished";
  const baseJudge = useAbtestJudge(name, "base", baseDone);
  const fixedJudge = useAbtestJudge(name, "fixed", fixedDone, fixedEnd);
  const report = repairs.data?.items.some((r) => r.name === name && r.verdict);
  const [extending, setExtending] = useState(false);
  // Run longer: once the second run has ended, and no job of the test is waiting or running.
  const at = state === "running" || state === "unfinished" ? null : secondRunAt(detail?.result, fixedEnd);
  const longer: ExtendTarget | null = at != null && detail?.result ? {
    name,
    at,
    iters: detail.result.iters,
    source: detail.result.source,
    variant: detail.result.variant ?? null,
    pace: detail.result.fixed?.secondsPerIteration ?? null,
  } : null;

  const sub = [
    caseName(detail?.result?.source) && `case ${caseName(detail?.result?.source)}`,
    detail?.result?.iters != null && `${formatInt(detail.result.iters)} iterations a run`,
    detail?.result?.variant ? `second run with ${detail.result.variant} settings` : detail?.result && "the same settings on both meshes",
    mode === "demo" && "recorded demo",
  ].filter((x): x is string => typeof x === "string");
  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" asChild>
        <Link to={to("/abtests")}><ArrowLeft />A/B tests</Link>
      </Button>
      {report && (
        <Button variant="secondary" asChild>
          <Link to={to(`/repairs/${encodeURIComponent(name)}/report`)}><FileText />Repair report</Link>
        </Button>
      )}
      {job && (
        <Button variant="ghost" asChild>
          <Link to={to(`/jobs?job=${encodeURIComponent(job.id)}`)}><ListChecks />Job details</Link>
        </Button>
      )}
      {longer && (
        <Button onClick={() => setExtending(true)}><FastForward />Run longer</Button>
      )}
      {longer && <ExtendAbTestDialog open={extending} onOpenChange={setExtending} test={longer} />}
    </div>
  );

  // A test just started: its job hasn't made the test's folder yet, so the engine has none of that name for now.
  const missing = first.isError && asEngineError(first.error).code === "not-found";
  if (!detail && job && missing) {
    return (
      <>
        <PageHeader title={name} description="A/B test" actions={actions} />
        <Card>
          <CardHeader className="flex-wrap">
            <div>
              <CardTitle>{isActive(job.state) ? "Starting" : "The test didn't start"}</CardTitle>
              <CardDescription>
                {isActive(job.state) ? `Its job ${job.state === "queued" ? "is waiting to start" : "has started"}` : "Its job stopped first"}
              </CardDescription>
            </div>
            <AbStateBadge state={isActive(job.state) ? "running" : abState(null, job)} queued={job.state === "queued"} />
          </CardHeader>
          <CardContent className="text-sm">
            {isActive(job.state) ? (
              <p className="text-muted-foreground">
                The engine is checking that the case fits in its memory and making the copies: the test shows here as
                soon as its first step begins. This screen asks again every 3 s.
              </p>
            ) : (
              <p className="text-danger">
                {job.error || `It stopped with exit code ${job.exitCode ?? "?"}.`} See{" "}
                <Link to={to(`/jobs?job=${encodeURIComponent(job.id)}`)} className={LINK}>its job</Link> for its log.
              </p>
            )}
          </CardContent>
        </Card>
      </>
    );
  }

  if (!detail) {
    return (
      <>
        <PageHeader title={name} description="A/B test" actions={actions} />
        {first.isError ? (
          <>
            <ErrorPanel error={first.error} onRetry={() => void first.refetch()} retrying={first.isFetching} />
            {asEngineError(first.error).code === "not-found" && (
              <p className="mt-4 text-sm text-muted-foreground">
                The engine has no A/B test of this name. <Link to={to("/abtests")} className={LINK}>See the A/B tests it
                has</Link>.
              </p>
            )}
          </>
        ) : (
          <Card className="p-5">
            <p role="status" className="text-sm text-muted-foreground">Asking the engine for the A/B test…</p>
          </Card>
        )}
      </>
    );
  }

  // The repaired-mesh run's judge: the engine's, once it has ended; the live monitor's while it solves.
  const liveJudge = solving ? judgeOf(live.data?.judge) : null;
  const judges = [
    { key: "base", title: "Is the original-mesh run converged?", judge: judgeOf(baseJudge.data), q: baseJudge },
    {
      key: "fixed",
      title: liveJudge ? "Is the repaired-mesh run converged so far?" : "Is the repaired-mesh run converged?",
      judge: liveJudge ?? judgeOf(fixedJudge.data),
      q: fixedJudge,
    },
  ];
  const shownJudges = judges.filter((j) => j.judge);
  const judgeErrors = judges.filter((j) => j.q.isError && asEngineError(j.q.error).code !== "not-found");
  const finished = detail.result?.residualRatioFixedOverBase != null && Object.keys(detail.result.residualRatioFixedOverBase).length > 0;

  return (
    <>
      <PageHeader title={name} description={["A/B test", ...sub].join(" · ")} actions={actions} />
      {first.isError && (
        <ErrorPanel className="mb-4" compact error={first.error} onRetry={() => void first.refetch()} retrying={first.isFetching} />
      )}
      <StatusCard state={state} detail={detail} job={job} live={live.data} liveError={live.error} />

      {ab && finished && (
        <Section title="Did it help the solver?">
          <div className="mt-4"><AbCard ab={ab} /></div>
        </Section>
      )}

      {history && history.fields.length > 0 ? (
        <Section title="Residuals, original vs repaired mesh">
          <ResidualCard history={history} />
        </Section>
      ) : (
        <Card className="mt-4 p-5">
          <p className="text-sm text-muted-foreground">No residuals yet: they show here as soon as the first run writes them.</p>
        </Card>
      )}

      {shownJudges.length > 0 && (
        <Section title="Are the runs converged?">
          <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {shownJudges.map((j) => j.judge && <JudgeCard key={j.key} judge={j.judge} title={j.title} className="" />)}
          </div>
        </Section>
      )}
      {judgeErrors.map((j) => (
        <ErrorPanel key={j.key} className="mt-4" compact error={j.q.error} onRetry={() => void j.q.refetch()} retrying={j.q.isFetching} />
      ))}

      {detail.modes.length > 0 && (
        <Section title="Where the solution swings">
          <div className="mt-4"><ModesCard modes={detail.modes} /></div>
        </Section>
      )}
    </>
  );
}
