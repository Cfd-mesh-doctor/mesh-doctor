// SPDX-License-Identifier: GPL-3.0-or-later
// One solve of a case Mesh Doctor made (GET /runs/{name}, API 1.6): what it is doing and how far it has come, its
// residuals and forces as they are now (GET /runs/{name}/live, the engine's live monitor), and the convergence judge
// on it: the live monitor's while it solves, the engine's (GET /judge?case=) once it has ended. Stop ends it at the
// iteration it has reached (POST /runs/{name}/stop), and Continue… solves on from the latest one written
// (SolveDialog.tsx). A solve run in a terminal (meshdoctor solve) has no job: the page says so, and Stop works on it
// as on a job's. A solve just started shows as starting until its job writes the run's status, and a copy of a
// case you made as copying while its job makes it. While it solves the screen asks again every 3 s, so the charts
// grow. Once it has ended, a run of the Ahmed body template, Verify install's among them, says how it compares with
// the accuracy check (VerifyInstall.tsx's RunComparison, GET /runs/{name}/validation), and Plan a transient run
// (TransientPlan.tsx) says what a transient run of it would take, and starts one. A transient run (`transient`)
// counts time in s: its progress, stretches, charts and Continue are in seconds, it names the steady run it started
// from, and says from when it averages its flow (`averaging`, API 1.9: once its forces have settled), and its judge
// is the transient judge, in time steps, which the live page answers while it solves and once it has ended.
import { ArrowLeft, CircleStop, FastForward, ListChecks, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { LineChart, type LineSeries } from "@/components/charts/LineChart";
import { RunStateBadge } from "@/components/shared/badges";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { InlineCode } from "@/components/shared/InlineCode";
import { PageHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, Segmented } from "@/components/ui/misc";
import { useAppPath, useEngine } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { ACTIVE_POLL_MS, IDLE_POLL_MS, useCaseJudge, useCases, useJobs, useRun, useRunLive, useStopRun } from "@/engine/hooks";
import { isActive, type Job, type RunDetail, type RunLive, type RunShown } from "@/engine/types";
import { formatDateTime, formatDuration, formatInt, formatPercent, formatRelative } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import { JudgeCard, LegendLine } from "@/pages/report/AbCards";
import { Section } from "@/pages/report/Section";
import { tableRun } from "@/report/abtest";
import { judgeOf } from "@/report/summary";
import { SolveDialog } from "./SolveDialog";
import { TransientPlanCard } from "./TransientPlan";
import { RunComparison } from "./VerifyInstall";
import {
  atText, averagingText, current, formatTime, isTransient, madeFrom, madeOfJob, ofText, runShown, solveJobOf,
  solveStep, stretchFraction, stretchesText, timeNumber, totalForces, transientText,
} from "./solveStart";
import { formatStep } from "./tplan";
import { VERIFY, isVerifyName } from "./verify";

const LINK = "font-medium text-primary underline-offset-4 hover:underline";

/** The status card's title: the step while it solves, else how it ended. */
function title(shown: RunShown, run: RunDetail): string {
  const at = atText(run.written, isTransient(run));
  switch (shown) {
    case "queued": return "Waiting to start";
    case "running": return solveStep(current(run, shown)?.step) ?? "Starting";
    case "done": return `Solved to ${at}`;
    case "stopped": return `Stopped at ${at}`;
    case "cancelled": return "Cancelled";
    case "failed": return "Stopped with an error";
    case "interrupted": return "Interrupted";
    case "unsolved": return "Not solved yet";
  }
}

/** What the live monitor says of the solver: iteration, pace and time left; else the run's own iteration. A
 * transient run's: its time, its latest time step, and its pace per time step. */
function paceLine(solver: RunLive["solver"] | undefined, run: RunDetail): string | null {
  const transient = isTransient(run);
  const it = solver?.iteration ?? run.iteration;
  const end = solver?.end ?? run.end;
  const parts = [
    it != null && end != null && ofText(it, end, transient),
    transient && solver?.deltaT != null && solver.deltaT > 0 && `time step ${formatStep(solver.deltaT)}`,
    solver?.wall_per_it != null && solver.wall_per_it > 0
      && `${solver.wall_per_it.toFixed(2)} s per ${transient ? "time step" : "iteration"}`,
    solver?.state === "running" && solver.eta != null && (solver.wall_per_it ?? 0) > 0
      && `about ${formatDuration(solver.eta)} left`,
  ].filter((x): x is string => typeof x === "string");
  return parts.length ? parts.join(" · ") : null;
}

function StatusCard({ shown, run, job, live, stopping, outside }: {
  shown: RunShown;
  run: RunDetail;
  job: Job | undefined;
  live: RunLive | undefined;
  /** Stop was asked for this stretch, which hasn't ended yet. */
  stopping: boolean;
  /** It solves in a terminal (meshdoctor solve), with no job. */
  outside: boolean;
}) {
  const to = useAppPath();
  const transient = isTransient(run);
  // Until its job writes the run's status, the status and the live data are an earlier stretch's.
  const now = current(run, shown);
  const solver = now ? live?.solver : undefined;
  const fraction = now ? stretchFraction({ start: now.start, end: solver?.end ?? now.end, iteration: solver?.iteration ?? now.iteration }) : undefined;
  const pace = now ? paceLine(solver, now) : null;
  const stretches = stretchesText(run.stretches, transient);
  const ended = shown !== "running" && shown !== "queued";
  const averaged = averagingText(run.averaging, ended);
  const at = atText(run.written, transient);
  const kept = `What it wrote is kept, to ${at}: Continue solves on from there.`;
  const jobLink = job && <Link to={to(`/jobs?job=${encodeURIComponent(job.id)}`)} className={LINK}>its job</Link>;
  const split = run.nProcs == null ? null : run.nProcs > 1 ? `on ${run.nProcs} processes` : "unsplit, on one process";
  // While it solves: what is written so far (a Stop or a cancel keeps it), and any stretches before this one; once it
  // has ended, its stretches.
  const written = run.written > 0 ? `Written to ${at}` : "Nothing written yet";
  const sofar = ended
    ? (stretches ? `Solved ${stretches}` : written)
    : `${written}${stretches ? ` (solved before: ${stretches})` : ""}`;
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>{title(shown, run)}</CardTitle>
          <CardDescription>
            {ended && run.finished
              ? `Ended ${formatRelative(run.finished)} (${formatDateTime(run.finished)})`
              : run.started ? `This stretch began ${formatRelative(run.started)}` : "No stretch started yet"}
          </CardDescription>
        </div>
        <RunStateBadge state={shown} />
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {shown === "running" && (
          <div>
            <Progress value={fraction} label={`Progress of the solve of ${run.name}`} />
            <p className="mt-2 text-[13px] text-muted-foreground">
              {[fraction != null && formatPercent(fraction), pace].filter(Boolean).join(" · ") || "Under way"}
            </p>
          </div>
        )}
        {run.transient && (
          <p>
            A transient run of{" "}
            <Link to={to(`/solve/${encodeURIComponent(run.transient.steady)}`)} className={LINK}>{run.transient.steady}</Link>:{" "}
            {transientText(run.transient)}.
          </p>
        )}
        {run.transient && averaged && <p>{averaged}</p>}
        {outside && (
          <p>
            It is solving in a terminal <InlineCode text="meshdoctor solve" lead="(" trail=")," /> not as a job: Stop
            ends it at the {transient ? "time" : "iteration"} it has reached, which it writes first; Ctrl+C in its
            terminal ends it at the one it wrote last.
          </p>
        )}
        {stopping && <p>Stopping: the solver writes the {transient ? "time" : "iteration"} it has reached, then ends.</p>}
        <p className="text-muted-foreground">
          {[sofar, split].filter(Boolean).join(", ")}.
        </p>
        {shown === "failed" && (
          <p className="text-danger">
            {run.error || job?.error || "The solve stopped with an error."}
            {jobLink && <> See {jobLink} for its log.</>}
          </p>
        )}
        {shown === "stopped" && (
          <p className="text-muted-foreground">
            Stopped by request at {at}, which it wrote: Continue solves on from there.
          </p>
        )}
        {shown === "cancelled" && (
          <p className="text-muted-foreground">
            Its job was cancelled.{" "}
            {run.written > 0 ? kept : `It hadn't written ${transient ? "a time" : "an iteration"}: Solve again starts afresh.`}
          </p>
        )}
        {shown === "interrupted" && (
          <p className="text-muted-foreground">
            Its status says it was solving, but nothing is solving it now: the computer was restarted, its job was
            killed, or the terminal it was solving in was closed. {run.written > 0 ? kept : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** The run's initial residuals per iteration (a transient run's: per time step, over time) over all its stretches,
 * one field at a time. */
function ResidualsCard({ residuals, transient }: { residuals: RunLive["residuals"]; transient: boolean }) {
  const history = useMemo(() => tableRun(residuals), [residuals]);
  const fields = Object.keys(history?.y ?? {});
  const [picked, setPicked] = useState<string | null>(null);
  const field = picked && fields.includes(picked) ? picked
    : fields.includes("p") ? "p" : fields.includes("p_rgh") ? "p_rgh" : (fields[0] ?? "");
  const series = useMemo((): LineSeries[] => history ? [
    { name: field, stroke: "stroke-primary", swatch: "bg-primary", x: history.x, y: history.y[field] ?? [] },
  ] : [], [history, field]);
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>Residuals</CardTitle>
          <CardDescription>
            {transient
              ? "Initial residual at each time step, log scale: in a transient run they rise and fall with the flow, "
                + "and what counts is that each time step converges, which the judge checks."
              : "Initial residual per iteration, log scale: lower and still falling is better."}
          </CardDescription>
        </div>
        {fields.length > 1 && (
          <Segmented label="Field" value={field} onChange={setPicked}
            options={fields.map((f) => ({ value: f, label: <span className="font-mono">{f}</span> }))} />
        )}
      </CardHeader>
      <CardContent>
        <LineChart series={series} log xLabel={transient ? "time (s)" : "iteration"} empty="No residuals for this field"
          xFormat={transient ? timeNumber : undefined}
          label={`Initial residual of ${field} per ${transient ? "time step" : "iteration"}, log scale`} />
      </CardContent>
    </Card>
  );
}

/** The total force group's drag or vertical force per iteration (a transient run's: over time), one at a time: they
 * differ too much to share an axis. */
function ForcesCard({ live, transient, averagedFrom }: {
  live: RunLive;
  transient: boolean;
  /** a transient run's: when its forces settled, where the judge's means start */
  averagedFrom?: number | null;
}) {
  const { group, rows, vertical } = useMemo(() => totalForces(live), [live]);
  const [which, setWhich] = useState<"vertical" | "drag">("vertical");
  const name = which === "drag" ? "Drag" : vertical.charAt(0).toUpperCase() + vertical.slice(1);
  const series = useMemo((): LineSeries[] => [{
    name, stroke: "stroke-primary", swatch: "bg-primary",
    x: rows.map((r) => r[0]), y: rows.map((r) => (which === "drag" ? r[1] : r[2])),
  }], [rows, which, name]);
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>Forces</CardTitle>
          <CardDescription>
            {group ? <>From the case's <span className="font-mono">{group}</span> output, {transient ? "over time" : "per iteration"}: </>
              : transient ? "Over time: " : "Per iteration: "}
            {transient
              ? "a transient run's forces swing with the flow; their means settling is the sign of a run that is "
                + "statistically stationary, which the judge checks."
                + (averagedFrom != null ? " The shaded part, from when they settled, is what it averages." : "")
              : "a force that settles to a steady value is a sign of a converged run."}
          </CardDescription>
        </div>
        <Segmented label="Force" value={which} onChange={setWhich}
          options={[{ value: "vertical", label: vertical === "lift" ? "Lift" : "Downforce" }, { value: "drag", label: "Drag" }]} />
      </CardHeader>
      <CardContent>
        <LineChart series={series} xLabel={transient ? "time (s)" : "iteration"} empty="No forces written yet"
          xFormat={transient ? timeNumber : undefined}
          band={transient && averagedFrom != null ? { from: averagedFrom, label: "averaged" } : undefined}
          label={`${name}${group ? ` from ${group}` : ""} ${transient ? "over time" : "per iteration"}`} />
      </CardContent>
    </Card>
  );
}

/** A transient run's time step and Courant number at each time step (its page's `steps`), one at a time: OpenFOAM
 * sets each time step so that the largest Courant number stays at the run's setting. */
function StepsCard({ steps, maxCo }: { steps: NonNullable<RunLive["steps"]>; maxCo: number | null | undefined }) {
  const [which, setWhich] = useState<"step" | "courant">("step");
  const series = useMemo((): LineSeries[] => {
    const at = (name: string) => steps.cols.indexOf(name);
    const t = steps.rows.map((r) => r[at("Time")] ?? Number.NaN);
    const col = (name: string, scale = 1) => steps.rows.map((r) => {
      const v = r[at(name)];
      return v == null ? null : v * scale;
    });
    return which === "step"
      ? [{ name: "time step (µs)", stroke: "stroke-primary", swatch: "bg-primary", x: t, y: col("deltaT", 1e6) }]
      : [{ name: "largest", stroke: "stroke-primary", swatch: "bg-primary", x: t, y: col("coMax") },
        { name: "mean", stroke: "stroke-foreground", swatch: "bg-foreground", dashed: true, x: t, y: col("coMean") }];
  }, [steps, which]);
  const setting = maxCo != null ? `${maxCo}, the run's setting` : "the run's setting";
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>Time step</CardTitle>
          <CardDescription>
            {which === "step"
              ? `In µs. OpenFOAM sets each time step so that the largest Courant number stays at ${setting}: it `
                + "shrinks when the flow through the smallest cells speeds up."
              : `The largest Courant number, which the time step holds at about ${setting}, and the mean over all `
                + "the cells: a few small, fast cells set the pace of the whole run."}
          </CardDescription>
        </div>
        <Segmented label="Show" value={which} onChange={setWhich}
          options={[{ value: "step", label: "Time step" }, { value: "courant", label: "Courant number" }]} />
      </CardHeader>
      <CardContent>
        {which === "courant" && (
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <LegendLine className="stroke-primary">largest</LegendLine>
            <LegendLine dashed className="stroke-foreground">mean</LegendLine>
          </div>
        )}
        <LineChart series={series} xLabel="time (s)" xFormat={timeNumber} empty="No time steps in its log yet"
          label={which === "step" ? "Time step over time, in µs" : "Largest and mean Courant number over time"} />
      </CardContent>
    </Card>
  );
}

export function RunPage() {
  const { name = "" } = useParams();
  useTitle(`Solve of ${name}`);
  const { mode } = useEngine();
  const to = useAppPath();
  const jobs = useJobs();
  const job = solveJobOf(jobs.data?.items, name);
  const working = job != null && isActive(job.state);
  const first = useRun(name, (d) => (working || d?.state === "running" ? ACTIVE_POLL_MS : IDLE_POLL_MS));
  const run = first.data;
  const shown = runShown(run, working ? job : undefined);
  const solving = shown === "running" || shown === "queued";
  // While it solves, the live data is asked for every 3 s; once it has ended, once more, for its last iterations.
  const live = useRunLive(name, solving ? "solving" : `${run?.state}:${run?.written}`, solving ? ACTIVE_POLL_MS : false, run != null);
  const ended = run != null && !solving && run.written > 0;
  // A transient run's judge is the live page's at its end too: the transient judge over the last half of its time
  // steps, where GET /judge's window would be 200 of them.
  const transient = isTransient(run);
  const judge = useCaseJudge(name, ended && !transient, run?.written ?? null);
  const cases = useCases();
  const stop = useStopRun();
  const [stoppedAt, setStoppedAt] = useState<string | null>(null);
  const [goingOn, setGoingOn] = useState(false);

  const made = cases.data?.made?.[name] ?? madeOfJob(job);
  const from = madeFrom(made);
  // A run of the Ahmed body template compares with the accuracy check once it has ended, as Verify install's does.
  const ahmed = made?.template === VERIFY.template || isVerifyName(name);
  const stopping = shown === "running" && run != null && stoppedAt === (run.started ?? "");
  // A solve run in a terminal has no job; the engine says it runs, and Stop works on it as on a job's.
  const outside = shown === "running" && run?.state === "running" && !working && jobs.data != null;
  const canStop = shown === "running" && run?.state === "running" && run.step === "solving" && !stopping;
  const canGoOn = run != null && !solving && !working;
  const sub = [
    "Solve",
    from,
    run?.end != null && `to ${transient ? formatTime(run.end) : `iteration ${formatInt(run.end)}`}`,
    mode === "demo" && "recorded demo",
  ].filter((x): x is string => typeof x === "string");
  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" asChild>
        <Link to={to("/solve")}><ArrowLeft />Solve</Link>
      </Button>
      {job && (
        <Button variant="ghost" asChild>
          <Link to={to(`/jobs?job=${encodeURIComponent(job.id)}`)}><ListChecks />Job details</Link>
        </Button>
      )}
      {canStop && (
        <Button variant="secondary" disabled={stop.isPending}
          onClick={() => stop.mutate(name, { onSuccess: () => setStoppedAt(run?.started ?? "") })}>
          <CircleStop />{stop.isPending ? "Stopping…" : "Stop"}
        </Button>
      )}
      {canGoOn && run && (
        <Button onClick={() => setGoingOn(true)}>
          {run.written > 0 ? <><FastForward />Continue…</> : <><Play />Solve again…</>}
        </Button>
      )}
      {canGoOn && run && <SolveDialog open={goingOn} onOpenChange={setGoingOn} target={{ name, run }} />}
    </div>
  );

  // A solve just started: its job hasn't written the run's status yet, so the engine has no run of that name.
  const missing = first.isError && asEngineError(first.error).code === "not-found";
  if (!run && job && missing) {
    return (
      <>
        <PageHeader title={name} description={sub.join(" · ")} actions={actions} />
        <Card>
          <CardHeader className="flex-wrap">
            <div>
              <CardTitle>{working ? "Starting" : "The solve didn't start"}</CardTitle>
              <CardDescription>
                {working ? `Its job ${job.state === "queued" ? "is waiting to start" : "has started"}` : "Its job stopped first"}
              </CardDescription>
            </div>
            <RunStateBadge state={working ? runShown(null, job) : job.state === "cancelled" ? "cancelled" : "failed"} />
          </CardHeader>
          <CardContent className="text-sm">
            {working ? (
              <p className="text-muted-foreground">
                The engine is checking that the solve fits in its memory: the run shows here as soon as it begins. This
                screen asks again every 3 s.
              </p>
            ) : (
              <p className="text-danger">
                {job.state === "cancelled" ? "It was cancelled before the solve began."
                  : job.error || `It stopped with exit code ${job.exitCode ?? "?"}.`} See{" "}
                <Link to={to(`/jobs?job=${encodeURIComponent(job.id)}`)} className={LINK}>its job</Link> for its log.
              </p>
            )}
          </CardContent>
        </Card>
      </>
    );
  }

  if (!run) {
    return (
      <>
        <PageHeader title={name} description={sub.join(" · ")} actions={actions} />
        {first.isError ? (
          <>
            <ErrorPanel error={first.error} onRetry={() => void first.refetch()} retrying={first.isFetching} />
            {missing && (
              <p className="mt-4 text-sm text-muted-foreground">
                The engine has no solve of this case. <Link to={to("/solve")} className={LINK}>See the runs it has</Link>.
              </p>
            )}
          </>
        ) : (
          <Card className="p-5">
            <p role="status" className="text-sm text-muted-foreground">Asking the engine for the run…</p>
          </Card>
        )}
      </>
    );
  }

  const doc = live.data;
  const liveCode = live.isError ? asEngineError(live.error).code : null;
  const hasResiduals = (doc?.residuals.rows?.length ?? 0) > 0;
  const hasForces = doc != null && totalForces(doc).rows.length > 0;
  const liveJudge = solving ? judgeOf(doc?.judge) : null;
  const shownJudge = liveJudge ?? (ended ? judgeOf(transient ? doc?.judge : judge.data) : null);

  return (
    <>
      <PageHeader title={name} description={sub.join(" · ")} actions={actions} />
      {first.isError && (
        <ErrorPanel className="mb-4" compact error={first.error} onRetry={() => void first.refetch()} retrying={first.isFetching} />
      )}
      {stop.isError && <ErrorPanel className="mb-4" compact error={stop.error} />}
      <StatusCard shown={shown} run={run} job={job} live={doc} stopping={stopping} outside={outside} />

      {liveCode === "unavailable" ? (
        <Card className="mt-4 p-5">
          <p className="text-sm text-muted-foreground">
            This engine&apos;s server has no live monitor, so the residuals and forces don&apos;t show here.
          </p>
        </Card>
      ) : live.isError && liveCode !== "not-found" ? (
        <ErrorPanel className="mt-4" compact error={live.error} onRetry={() => void live.refetch()} retrying={live.isFetching} />
      ) : null}

      {doc && hasResiduals ? (
        <Section title="Residuals">
          <div className="mt-4"><ResidualsCard residuals={doc.residuals} transient={transient} /></div>
        </Section>
      ) : liveCode == null && (
        <Card className="mt-4 p-5">
          <p className="text-sm text-muted-foreground">
            {doc || !live.isPending ? "No residuals yet: they show here as soon as the solver writes them." : "Asking the engine for the residuals…"}
          </p>
        </Card>
      )}

      {doc && hasForces && (
        <Section title="Forces">
          <div className="mt-4"><ForcesCard live={doc} transient={transient} averagedFrom={shownJudge?.settled} /></div>
        </Section>
      )}

      {doc?.steps && transient && (
        <Section title="Time step">
          <div className="mt-4"><StepsCard steps={doc.steps} maxCo={run?.transient?.maxCo} /></div>
        </Section>
      )}

      {shownJudge && (
        <Section title={liveJudge ? "Is it converged so far?" : "Is it converged?"}>
          <JudgeCard judge={shownJudge} title={liveJudge ? "The live judge, so far" : "The judge on the whole run"} />
        </Section>
      )}
      {!liveJudge && judge.isError && (
        <ErrorPanel className="mt-4" compact error={judge.error} onRetry={() => void judge.refetch()} retrying={judge.isFetching} />
      )}

      {ended && !transient && ahmed && (
        <Section title="Against the accuracy check">
          <RunComparison className="mt-4" run={run} />
        </Section>
      )}

      {ended && !transient && (
        <Section title="Transient plan">
          <div className="mt-4"><TransientPlanCard run={run} /></div>
        </Section>
      )}
    </>
  );
}
