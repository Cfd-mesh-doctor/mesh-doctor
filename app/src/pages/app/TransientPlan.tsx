// SPDX-License-Identifier: GPL-3.0-or-later
// A solved run's transient plan, on its page (Run.tsx). A steady run that won't settle may be a flow that is unsteady
// in fact, which only a transient run with averaged forces solves. Plan a transient run starts a tplan job (API 1.6),
// which works out from the run's result the time step such a run would need at each Courant number, which cells set
// it and what it would cost (GET /tplans/{name}). While it plans, the card says so; once made, it shows the plan, and
// says when the run has been solved further since. The case is only read. With a plan, Start a transient run… starts
// one (TransientDialog in SolveDialog.tsx): a new case of the run's mesh, settings and latest result, solved in time;
// the transient runs made of the run are listed under the plan.
import { Hourglass, RotateCw, Waves } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { TextWithCode } from "@/components/shared/InlineCode";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppPath, useEngine } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { useCases, useEngineInfo, useJobs, useStartJob, useTransientPlan } from "@/engine/hooks";
import { isActive, type RunDetail, type TransientPlan } from "@/engine/types";
import { formatInt } from "@/lib/format";
import { TransientDialog } from "./SolveDialog";
import { planHeadline, planJobOf, planMade, planProcs, planRows, planStale, regionLines, setBy } from "./tplan";

const LINK = "font-medium text-primary underline-offset-4 hover:underline";
const NUM = "text-right tabular-nums";

/** For an engine from before the tplan job (API 1.6). */
export const OLD_ENGINE_TPLAN = "Your engine is older than this page and can't plan a transient run from here yet. "
  + "Update Mesh Doctor (`git pull` in its folder) and restart the engine.";

function PlanView({ plan, run }: { plan: TransientPlan; run: RunDetail }) {
  const rows = planRows(plan);
  const regions = regionLines(plan);
  return (
    <div className="space-y-4 text-sm">
      <p className="font-medium">{planHeadline(plan)}</p>
      <Table aria-label="The time step and time of a transient run at each largest Courant number">
        <THead>
          <TR>
            <TH>Largest Courant number</TH>
            <TH className={NUM}>Time step</TH>
            <TH className={NUM}>Steps</TH>
            <TH className={NUM}>Time on {planProcs(plan)}</TH>
            <TH className={NUM}>Without the {formatInt(plan.top)} fastest cells</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.co}>
              <TD className="tabular-nums">{r.co}</TD>
              <TD className={NUM}>{r.step}</TD>
              <TD className={NUM}>{r.steps}</TD>
              <TD className={NUM}>{r.time}</TD>
              <TD className={NUM}>{r.without}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <div>
        <p>{setBy(plan)}</p>
        {regions.length > 0 && (
          <>
            <p className="mt-2 text-muted-foreground">Where the fastest are, fastest first:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
              {regions.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </>
        )}
      </div>
      {plan.notes && plan.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-muted-foreground" aria-label="What the plan assumes">
          {plan.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      <p className="text-[13px] text-muted-foreground">
        {planMade(plan)}
        {planStale(plan, run) && (
          <> The run has been solved to iteration {formatInt(run.written)} since: Plan again plans from there.</>
        )}
      </p>
    </div>
  );
}

/** The run's transient plan: Plan a transient run, the job while it plans, and the plan once made. */
export function TransientPlanCard({ run }: { run: RunDetail }) {
  const to = useAppPath();
  const { mode } = useEngine();
  const info = useEngineInfo();
  const jobs = useJobs();
  const start = useStartJob();
  const job = planJobOf(jobs.data?.items, run.name);
  const planning = job != null && isActive(job.state);
  const can = info.data?.jobKinds?.includes("tplan") ?? false;
  const old = info.data != null && !can;
  const plan = useTransientPlan(run.name, can, job ? `${job.id}:${job.state}` : null);
  const code = plan.isError ? asEngineError(plan.error).code : null;
  const shown = plan.data;
  const failed = !planning && job?.state === "failed" ? job : undefined;
  const cancelled = !planning && !shown && job?.state === "cancelled";
  const cases = useCases();
  // The transient runs made of this run (GET /cases' `made`: `transientOf`), by name.
  const made = Object.entries(cases.data?.made ?? {}).filter(([, m]) => m.transientOf === run.name).map(([n]) => n).sort();
  const [starting, setStarting] = useState(false);
  const body = old || planning || failed || cancelled || shown || (code != null && code !== "not-found") || start.isError
    || made.length > 0;

  return (
    <Card>
      <CardHeader className="block">
        <CardTitle>Plan a transient run</CardTitle>
        <CardDescription>
          A steady run that won&apos;t settle (the judge&apos;s &ldquo;plateau / oscillation&rdquo;) can be a flow that is
          unsteady in fact, such as a wing-tip vortex or a wake. A transient run with averaged forces is then the way on,
          and it costs far more: this works out from the run&apos;s result the time step it would need, which cells set
          it, and how long it would take. It only reads the case. With a plan, Start a transient run starts one, as
          a new case.
        </CardDescription>
      </CardHeader>
      {body && (
        <CardContent className="space-y-4">
          {old && <p className="text-sm text-muted-foreground"><TextWithCode text={OLD_ENGINE_TPLAN} /></p>}
          {planning && job && (
            <div className="text-sm">
              <p>
                {job.state === "queued" ? "Waiting to start" : "Planning"}: OpenFOAM works out each cell&apos;s Courant
                number from this run&apos;s result, in a throwaway case of links to it.{" "}
                <Link to={to(`/jobs?job=${encodeURIComponent(job.id)}`)} className={LINK}>Its job</Link>
              </p>
              <Progress className="mt-2 max-w-sm" value={undefined} label={`Planning a transient run of ${run.name}`} />
            </div>
          )}
          {failed && (
            <p className="text-sm text-danger">
              The plan stopped with an error: {failed.error || `exit code ${failed.exitCode ?? "?"}`}. See{" "}
              <Link to={to(`/jobs?job=${encodeURIComponent(failed.id)}`)} className={LINK}>its job</Link> for its log.
            </p>
          )}
          {cancelled && <p className="text-sm text-muted-foreground">Its job was cancelled before the plan was made.</p>}
          {start.isError && <ErrorPanel compact error={start.error} />}
          {code != null && code !== "not-found" && (
            <ErrorPanel compact error={plan.error} onRetry={() => void plan.refetch()} retrying={plan.isFetching} />
          )}
          {shown && <PlanView plan={shown} run={run} />}
          {made.length > 0 && (
            <p className="text-sm">
              Transient {made.length === 1 ? "run" : "runs"} of it:{" "}
              {made.map((n, i) => (
                <span key={n}>
                  {i > 0 && ", "}
                  <Link to={to(`/solve/${encodeURIComponent(n)}`)} className={`font-mono text-[13px] ${LINK}`}>{n}</Link>
                </span>
              ))}
            </p>
          )}
        </CardContent>
      )}
      <CardFooter className="flex-wrap">
        {shown && (
          <Button size="sm" disabled={!can || planning} onClick={() => setStarting(true)}>
            <Waves aria-hidden /> Start a transient run…
          </Button>
        )}
        <Button size="sm" variant={shown ? "secondary" : "primary"}
          disabled={!can || planning || start.isPending || mode === "demo"}
          onClick={() => start.mutate({ kind: "tplan", params: { name: run.name } })}>
          {shown ? <RotateCw aria-hidden /> : <Hourglass aria-hidden />} {shown ? "Plan again" : "Plan a transient run"}
        </Button>
        <span className="text-muted-foreground">
          {shown ? "Plans again from the run's latest result." : "It reads the result and doesn't solve: about 2 s for half a million cells."}
        </span>
      </CardFooter>
      {shown && <TransientDialog open={starting} onOpenChange={setStarting} target={{ run, plan: shown }} />}
    </Card>
  );
}
