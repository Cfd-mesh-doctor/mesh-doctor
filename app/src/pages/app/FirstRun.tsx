// SPDX-License-Identifier: GPL-3.0-or-later
// Try it on the Ahmed body: a first run from start to finish, each step started here with the screens' own dialogs
// and ticked off once the engine lists it (firstRunSteps.ts): the engine's checks, a coarse Ahmed case made from the
// template (New case), a short solve of it (Solve), the judge's verdict on it (its run's page), a repair of a copy
// of it (Repair) and an A/B test of that repair (A/B test). In the demo, each dialog gives the command instead.
import { CircleAlert, FlaskConical, FolderPlus, Play, Wrench } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { InlineCode } from "@/components/shared/InlineCode";
import { PageHeader } from "@/components/shared/page";
import { StepList, type Step } from "@/components/shared/Steps";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle, CardTitleRow } from "@/components/ui/card";
import { useAppPath } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { isActive } from "@/engine/types";
import {
  ACTIVE_POLL_MS, IDLE_POLL_MS, useAbtests, useCaseJudge, useCases, useJobs, useReadiness, useRepairs, useRuns,
  useTemplates,
} from "@/engine/hooks";
import { formatCount, formatInt } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import { OLD_ENGINE_CASES } from "./caseStart";
import { Note } from "./dialogParts";
import { SHORT_TO, SIZE, TEMPLATE, firstRun, type StepId } from "./firstRunSteps";
import { NewCaseDialog } from "./NewCase";
import { SolveDialog } from "./SolveDialog";
import { StartAbTestDialog } from "./StartAbTest";
import { StartRepairDialog } from "./StartRepair";

const LINK = "font-medium text-primary underline-offset-4 hover:underline";

export function FirstRun() {
  useTitle("Try it on the Ahmed body");
  const to = useAppPath();
  const id = useId();
  const readiness = useReadiness();
  const templates = useTemplates();
  const cases = useCases();
  const jobs = useJobs();
  const repairs = useRepairs();
  // While a job waits or runs, the lists are asked for again sooner, so its step ticks off soon after it ends.
  const busy = (jobs.data?.items ?? []).some((j) => isActive(j.state));
  const runs = useRuns(busy);
  const tests = useAbtests(busy ? ACTIVE_POLL_MS : IDLE_POLL_MS);
  const [open, setOpen] = useState<StepId | null>(null);

  const lists = {
    readiness: readiness.data, cases: cases.data, runs: runs.data?.items, repairs: repairs.data?.items,
    tests: tests.data, jobs: jobs.data?.items,
  };
  const before = firstRun(lists);
  const ended = before.states.solve === "done";
  const judge = useCaseJudge(before.name ?? "", ended && before.name != null, before.run?.written ?? null);
  const g = firstRun({ ...lists, judged: judge.isSuccess });

  const template = templates.data?.items.find((t) => t.name === TEMPLATE);
  const size = template?.sizes.find((s) => s.name === SIZE);
  const old = templates.isError && asEngineError(templates.error).code === "not-found";
  const failed = [readiness, templates, cases, jobs, repairs].find((q) => q.isError && !(q === templates && old));
  const name = g.name ?? "";
  const cells = cases.data?.cells?.[name];
  const runPage = <Link to={to(`/solve/${encodeURIComponent(name)}`)} className={LINK}>its page</Link>;
  const jobsScreen = <Link to={to("/jobs?show=active")} className={LINK}>Jobs screen</Link>;
  const button = (step: StepId, label: string, icon: ReactNode) => (
    <Button size="sm" onClick={() => setOpen(step)}>{icon} {label}</Button>
  );
  const fails = readiness.data?.checks.filter((c) => c.state === "fail").length ?? 0;
  const verdict = (judge.data as { verdict?: unknown } | undefined)?.verdict;

  const steps: Step[] = [
    {
      title: "Check the engine's computer",
      state: g.states.ready,
      text: g.states.ready === "done"
        ? "It has what a solve needs: OpenFOAM 14, its programs, and the memory."
        : readiness.isPending
          ? "Asking the engine…"
          : readiness.isError
            ? "The engine couldn't say: what went wrong is at the top of this page."
            : <>{formatCount(fails, "check")} {fails === 1 ? "fails" : "fail"}: each says how to fix it, on the{" "}
              <Link to={to("/solve")} className={LINK}>Solve screen</Link>. This ticks itself off once they pass.</>,
    },
    {
      title: "Make a coarse Ahmed case",
      state: g.states.case,
      text: g.states.case === "done"
        ? <><InlineCode text={name} trail="," /> made from the Ahmed body template
            {cells != null ? `: about ${formatInt(cells)} cells` : ""}. It's on the{" "}
            <Link to={to("/cases")} className={LINK}>Cases screen</Link> too.</>
        : g.states.case === "running"
          ? <>The engine copies the template and meshes it, a minute or two. Its progress is on the {jobsScreen}.</>
          : <>New case makes it from the Ahmed body template with the coarse mesh
              {size ? `, about ${formatInt(size.cells)} cells` : ""}: the quickest to solve.</>,
      action: g.states.case === "next" ? button("case", "New case…", <FolderPlus aria-hidden />) : undefined,
    },
    {
      title: `Solve it, to iteration ${formatInt(SHORT_TO)}`,
      state: g.states.solve,
      text: g.states.solve === "done"
        ? <>Solved to iteration {formatInt(g.run?.written ?? 0)}: {runPage} has its residuals and forces.</>
        : g.states.solve === "running"
          ? <>Solving{g.run?.iteration != null ? `: iteration ${formatInt(g.run.iteration)}` : ""}
              {g.run?.end != null ? ` of ${formatInt(g.run.end)}` : ""}. {name && <>Follow it on {runPage}.</>}</>
          : <>A short solve: split over the processes you pick, started with potentialFoam, then foamRun. A run's
              page draws its residuals and forces as it goes.</>,
      action: g.states.solve === "next" ? button("solve", "Solve…", <Play aria-hidden />) : undefined,
    },
    {
      title: "Read the judge's verdict",
      state: g.states.judge,
      text: g.states.judge === "done"
        ? <>The judge says {typeof verdict === "string" ? <strong>{verdict}</strong> : "it has judged it"}. Its page shows
            why; if it hasn't converged yet, Continue there solves on from where it ended.</>
        : g.states.judge === "next" && judge.isError
          ? <>The judge couldn't say: {asEngineError(judge.error).message}. See {runPage}.</>
          : g.states.judge === "next"
            ? "Asking the engine's judge…"
            : "Whether the forces and residuals have settled: converged, or not yet.",
    },
    {
      title: "Repair a copy of it",
      state: g.states.repair,
      text: g.states.repair === "done" && g.repair
        ? <><InlineCode text={g.repair.name} trail=":" /> its{" "}
            <Link to={to(`/repairs/${encodeURIComponent(g.repair.name)}/report`)} className={LINK}>report</Link> says
            what changed in the mesh.</>
        : g.states.repair === "running"
          ? <>A copy of it is being repaired. Its progress is on the {jobsScreen}.</>
          : "A repair works on a copy, never the case itself: the mesh fixed where checkMesh finds it worst.",
      action: g.states.repair === "next" ? button("repair", "Repair a copy…", <Wrench aria-hidden />) : undefined,
    },
    {
      title: "A/B test the repair",
      state: g.states.abtest,
      text: g.states.abtest === "done" && g.repair
        ? <>Done: <Link to={to(`/abtests/${encodeURIComponent(g.repair.name)}`)} className={LINK}>its page</Link> says
            which mesh converges further. That's a first run from start to finish.</>
        : g.states.abtest === "running" && g.repair
          ? <>Both meshes are solving: <Link to={to(`/abtests/${encodeURIComponent(g.repair.name)}`)}
              className={LINK}>its page</Link> follows them.</>
          : "It solves the original and the repaired mesh side by side, and judges which converges further.",
      action: g.states.abtest === "next" ? button("abtest", "A/B test it…", <FlaskConical aria-hidden />) : undefined,
    },
  ];
  const done = steps.filter((s) => s.state === "done").length;
  // The step to do now says when its last try failed, and where that job's log is.
  const failedNote = g.failed && (
    <span className="mt-1 flex gap-1.5 text-danger">
      <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>
        The last try failed{g.failed.error ? <>: {g.failed.error}</> : ""}. Its log is on the{" "}
        <Link to={to("/jobs?show=failed")} className={LINK}>Jobs screen</Link>.
      </span>
    </span>
  );
  const shown = steps.map((s) => (s.state === "next" && failedNote ? { ...s, text: <>{s.text}{failedNote}</> } : s));

  return (
    <>
      <PageHeader
        title="Try it on the Ahmed body"
        description="A first run from start to finish on the engine's computer: a case made from the Ahmed body template, solved and judged, then repaired and A/B tested."
      />
      {failed && (
        <div className="mb-6">
          <ErrorPanel error={failed.error} onRetry={() => void failed.refetch()} retrying={failed.isFetching} />
        </div>
      )}
      {old ? (
        <Note tone="info">{OLD_ENGINE_CASES}</Note>
      ) : templates.isSuccess && !template ? (
        <Note tone="info">
          Your engine has no Ahmed body template: its examples folder is missing it. Update Mesh Doctor (`git pull` in its
          folder) and restart the engine.
        </Note>
      ) : (
        <Card aria-labelledby={id}>
          <CardHeader className="block">
            <CardTitleRow>
              <CardTitle id={id}>Steps</CardTitle>
              <span className="shrink-0 text-[13px] whitespace-nowrap text-muted-foreground">
                {done} of {steps.length} done
              </span>
            </CardTitleRow>
            <CardDescription>
              Each starts here, and ticks itself off once the engine lists it. One big job runs at a time: the next
              step's button waits for the one before.
            </CardDescription>
          </CardHeader>
          <StepList steps={shown} />
        </Card>
      )}
      {open === "case" && (
        <NewCaseDialog open onOpenChange={(o) => { if (!o) setOpen(null); }} preset={{ template: TEMPLATE, size: SIZE }} />
      )}
      {open === "solve" && g.name && (
        <SolveDialog open onOpenChange={(o) => { if (!o) setOpen(null); }} target={{ name: g.name, run: g.run, to: SHORT_TO }} />
      )}
      {open === "repair" && g.name && (
        <StartRepairDialog open onOpenChange={(o) => { if (!o) setOpen(null); }} source={g.name} />
      )}
      {open === "abtest" && g.repair && (
        <StartAbTestDialog open onOpenChange={(o) => { if (!o) setOpen(null); }} run={g.repair.name} />
      )}
    </>
  );
}
