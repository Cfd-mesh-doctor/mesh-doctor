// SPDX-License-Identifier: GPL-3.0-or-later
// The Solve screen's Verify install (API 1.6): the coarse Ahmed body made from its template and solved to iteration
// 2,000 in one solve job, as the accuracy check's run of that mesh was, then its drag against that run's and the wind
// tunnel's (GET /runs/{name}/validation), drawn as the accuracy check draws its cases (CdChart). Before it: what it
// does, and Verify install…; while it runs: its step and how far it has come; after: the comparison, Continue… when
// it ended short of 2,000, or Verify install again… when it failed or stopped before it solved.
import { CircleAlert, CircleCheck, FastForward, ShieldCheck, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { RunStateBadge } from "@/components/shared/badges";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { InlineCode, TextWithCode } from "@/components/shared/InlineCode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, CardTitleRow } from "@/components/ui/card";
import { Progress, Skeleton } from "@/components/ui/misc";
import { useAppPath } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { useCases, useJobs, useRunValidation, useRuns } from "@/engine/hooks";
import { isActive, type RunValidation } from "@/engine/types";
import { formatInt } from "@/lib/format";
import { CdChart } from "@/pages/accuracy/CdChart";
import { SolveDialog, VerifyDialog } from "./SolveDialog";
import { current, runRows, solveStep, stretchFraction, type RunRow } from "./solveStart";
import {
  VERIFY, VERIFY_NAME, signedPercent, verifyCases, verifyCommand, verifyRow, verifyStage, verifyTime, verifyVerdict,
} from "./verify";

const LINK = "font-medium text-primary underline-offset-4 hover:underline";

/** For an engine from before Verify install: before the solve job (API 1.6), or before its comparison. */
export const OLD_ENGINE_VERIFY = "Your engine is older than this page and can't verify the install from here yet. "
  + "Update Mesh Doctor (`git pull` in its folder) and restart the engine.";

function RunLink({ name }: { name: string }) {
  const to = useAppPath();
  return <Link to={to(`/solve/${encodeURIComponent(name)}`)} className={`font-mono text-[13px] ${LINK}`}>{name}</Link>;
}

/** Making the case, or solving it: the step in plain words, the iteration it is at, and how far it has come. */
function Working({ row }: { row: RunRow }) {
  const now = current(row.run, row.shown);
  const meshing = !now || now.step === "" || now.step.startsWith("meshing");
  const at = now && !meshing && now.iteration != null ? ` · iteration ${formatInt(now.iteration)} of ${formatInt(VERIFY.to)}` : "";
  return (
    <div className="space-y-2 text-sm">
      <p>
        <RunLink name={row.name} />{" "}
        <span className="text-muted-foreground">
          {row.shown === "queued" ? "Waiting to start" : `${solveStep(now?.step) ?? "Starting"}${at}`}
        </span>
      </p>
      <Progress className="max-w-sm" value={meshing ? undefined : stretchFraction(now)}
        label={`Progress of ${row.name}`} />
      <p className="text-[13px] text-muted-foreground">
        It makes the mesh first, in about a minute, then solves. Its page draws the residuals and forces as it goes.
      </p>
    </div>
  );
}

const TONE = { success: CircleCheck, warning: TriangleAlert, neutral: CircleAlert } as const;

/** The comparison: whether your install gives the accuracy check's answer, and the two runs on its chart. */
function Comparison({ v, time }: { v: RunValidation; time: string }) {
  const verdict = verifyVerdict(v);
  const Icon = TONE[verdict.tone];
  const all = useMemo(() => verifyCases(v, time), [v, time]);
  return (
    <div className="space-y-4">
      <p className="flex gap-2 text-sm">
        <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${verdict.tone === "success" ? "text-success"
          : verdict.tone === "warning" ? "text-warning" : "text-muted-foreground"}`} />
        <span>{verdict.said}</span>
      </p>
      <CdChart cases={all} />
      <p className="text-[13px] text-muted-foreground">
        Cd {v.cd.toFixed(4)} and Cl {v.cl.toFixed(4)} over the last {formatInt(v.window)} of its{" "}
        {formatInt(v.iterations)} iterations, {signedPercent(v.published.difference, 2)} from the accuracy
        check&apos;s run; drift {signedPercent(v.drift, 2)} between that window&apos;s halves (under 1&nbsp;% means
        settled). The wind tunnel&apos;s {v.tunnel.cd} is the one Ahmed, Ramm and Faltin measured at a {v.slant}°
        slant.{" "}
        <Link to="/accuracy" className={LINK}>The whole accuracy check</Link>
      </p>
    </div>
  );
}

/** Once it has solved to iteration 2,000: the engine's comparison. */
function Ended({ row }: { row: RunRow }) {
  const v = useRunValidation(row.name, true, row.run?.written ?? null);
  if (v.data) return <Comparison v={v.data} time={verifyTime(row.run)} />;
  if (v.isError) {
    const e = asEngineError(v.error);
    if (e.code === "not-found") return <p className="text-sm text-muted-foreground"><TextWithCode text={OLD_ENGINE_VERIFY} /></p>;
    return <ErrorPanel compact error={v.error} onRetry={() => void v.refetch()} retrying={v.isFetching} />;
  }
  return (
    <div className="space-y-3" aria-busy>
      <p role="status" className="text-sm text-muted-foreground">Comparing {row.name} with the accuracy check…</p>
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

/** Ended short of iteration 2,000: where it stopped, to continue there. */
function Short({ row }: { row: RunRow }) {
  return (
    <p className="text-sm text-muted-foreground">
      <RunLink name={row.name} /> {row.shown === "cancelled" ? "was cancelled" : "stopped"} at iteration{" "}
      {formatInt(row.run?.written ?? 0)} of {formatInt(VERIFY.to)}. Continue it to {formatInt(VERIFY.to)}, as the
      accuracy check&apos;s run went, and the comparison shows here.
    </p>
  );
}

/** Ended with an error, or before it solved: what happened, and where its log is. */
function Again({ row }: { row: RunRow }) {
  const to = useAppPath();
  const error = row.run?.error ?? (row.job?.state === "failed" ? row.job.error : null);
  return (
    <p className="flex gap-2 text-sm text-muted-foreground">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      <span>
        <RunLink name={row.name} />{" "}
        {row.shown === "failed" || error
          ? <>stopped with an error{error ? `: ${error}` : ""}.</>
          : row.shown === "cancelled" ? "was cancelled before it solved." : "ended before it solved."}{" "}
        Its log is on the <Link to={to("/jobs?show=failed")} className={LINK}>Jobs screen</Link>. Verify install
        again starts a new one beside it.
      </span>
    </p>
  );
}

export function VerifyInstall() {
  const jobs = useJobs();
  const cases = useCases();
  const active = jobs.data?.items.some((j) => j.kind === "solve" && isActive(j.state)) ?? false;
  const runs = useRuns(active);
  const [verifying, setVerifying] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const old = runs.isError && !runs.data && asEngineError(runs.error).code === "not-found";
  const row = useMemo(() => verifyRow(runRows(cases.data?.made, runs.data?.items, jobs.data?.items)),
    [cases.data, runs.data, jobs.data]);
  const stage = verifyStage(row);
  const loading = !old && (runs.isPending || jobs.isPending);
  const v = useRunValidation(row?.name ?? "", stage === "ended" && row != null, row?.run?.written ?? null);
  const verdict = v.data ? verifyVerdict(v.data) : null;

  return (
    <Card className="mt-6">
      <CardHeader className="block">
        <CardTitleRow>
          <CardTitle>Verify install</CardTitle>
          {verdict && stage === "ended" ? (
            <Badge tone={verdict.tone}>{verdict.tone === "success" ? <CircleCheck aria-hidden /> : <TriangleAlert aria-hidden />} {verdict.badge}</Badge>
          ) : row && stage !== "ended" ? (
            <RunStateBadge state={row.shown} />
          ) : null}
        </CardTitleRow>
        <CardDescription>
          Whether your install gives the answer the accuracy check got: the coarse Ahmed body, made from its template
          and solved to iteration {formatInt(VERIFY.to)} as in that check, its drag against that check&apos;s run of the
          same mesh and the wind tunnel&apos;s. About 15 minutes on 6 processes.
        </CardDescription>
      </CardHeader>
      {(old || loading || runs.isError || stage !== "none") && (
        <CardContent>
          {old ? (
            <p className="text-sm text-muted-foreground"><TextWithCode text={OLD_ENGINE_VERIFY} /></p>
          ) : runs.isError ? (
            <ErrorPanel compact error={runs.error} onRetry={() => void runs.refetch()} retrying={runs.isFetching} />
          ) : loading ? (
            <div aria-busy><Skeleton className="h-4 w-64" /></div>
          ) : row && stage === "working" ? (
            <Working row={row} />
          ) : row && stage === "ended" ? (
            <Ended row={row} />
          ) : row && stage === "short" ? (
            <Short row={row} />
          ) : row && stage === "again" ? (
            <Again row={row} />
          ) : null}
        </CardContent>
      )}
      <CardFooter className="flex-wrap">
        {stage === "short" && row ? (
          <Button size="sm" onClick={() => setContinuing(true)}>
            <FastForward aria-hidden /> Continue to {formatInt(VERIFY.to)}…
          </Button>
        ) : stage !== "working" && (
          <Button size="sm" variant={stage === "ended" ? "secondary" : "primary"} onClick={() => setVerifying(true)} disabled={old}>
            <ShieldCheck aria-hidden /> {stage === "none" ? "Verify install…" : "Verify install again…"}
          </Button>
        )}
        <span className="text-muted-foreground">
          In a terminal: <InlineCode text={verifyCommand(VERIFY_NAME, VERIFY.np)} />
        </span>
      </CardFooter>
      {verifying && <VerifyDialog open onOpenChange={(o) => { if (!o) setVerifying(false); }} />}
      {continuing && row && (
        <SolveDialog open onOpenChange={(o) => { if (!o) setContinuing(false); }}
          target={{ name: row.name, run: row.run, to: VERIFY.to }} />
      )}
    </Card>
  );
}
