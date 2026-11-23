// SPDX-License-Identifier: GPL-3.0-or-later
// A repair's report straight from the engine (GET /repairs/{name}/report), shown as the report viewer shows a file.
// Checked like an opened file first, so a wrong answer reads as an error, not as a broken page. Save report keeps
// it as the file `meshdoctor report` makes, to share: it opens in the report viewer without the app or the engine.
// A run of your own engine with no A/B test yet can start one (StartAbTest.tsx), or follow the one under way.
import { skipToken, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, FlaskConical } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { PageHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/engine/client";
import { abCommand } from "@/engine/commands";
import { useAppPath, useEngine } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { useJobs } from "@/engine/hooks";
import { isActive, type Job } from "@/engine/types";
import { abJobOf } from "@/report/abtest";
import { useTitle } from "@/lib/useTitle";
import { DEMO_CLUSTERS_NOTE } from "@/demo/clusters";
import type { ClusterSource } from "@/pages/report/Clusters";
import { ReportView } from "@/pages/report/Report";
import { checkReport } from "@/report/read";
import { RECORDED } from "@/report/samples";
import { saveReport } from "@/report/save";
import { summarize } from "@/report/summary";
import { StartAbTestDialog } from "./StartAbTest";

const link = "font-medium text-primary underline-offset-4 hover:underline";

/** Where the report would show the A/B test's result: Start an A/B test, and the command that does the same in a
 * terminal, or, while a test of the run is under way, a link to follow it. */
function AbNextCard({ run, command, job, onStart }: {
  run: string;
  command: string | null;
  job: Job | undefined;
  onStart: () => void;
}) {
  const to = useAppPath();
  const testing = job && isActive(job.state);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Did it help the solver?</CardTitle>
          <CardDescription>{testing ? "Being tested" : "Not tested yet"}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {testing ? (
          <>
            <p className="text-sm text-muted-foreground">
              Its A/B test is {job.state === "queued" ? "waiting to start" : "running"}: the result shows up in this report
              once both runs have ended.
            </p>
            <Button variant="secondary" size="sm" className="mt-3" asChild>
              <Link to={to(`/abtests/${encodeURIComponent(run)}`)}><FlaskConical aria-hidden />Follow the A/B test</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              The A/B solver test runs your case twice, on the original mesh and on the repaired one, with the same
              settings, and compares how they converge. Start it here, or run this in a WSL or Linux terminal: its result
              shows up in this report.
            </p>
            <Button size="sm" className="mt-3" onClick={onStart}><FlaskConical aria-hidden />Start an A/B test</Button>
            {command && <CopyCommand command={command} className="mt-3" />}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function RepairReport() {
  const { name = "" } = useParams();
  const { transport, mode } = useEngine();
  const to = useAppPath();
  useTitle(`Report of ${name}`);
  const jobs = useJobs();
  const [starting, setStarting] = useState(false);
  const report = useQuery({
    queryKey: [transport?.scope, "report", name],
    queryFn: transport ? async ({ signal }) => checkReport(await api.report(transport, name, signal)) : skipToken,
    staleTime: 60_000,
  });
  const summary = useMemo(() => (report.data ? summarize(report.data) : undefined), [report.data]);
  // The 3D view of a cluster asks the same engine for its shapes (the demo has three recorded).
  const clusters = useMemo<ClusterSource | null>(() => (transport ? {
    key: [transport.scope, "cluster", name],
    load: (tag, id, signal) => api.cluster(transport, name, id, tag, signal),
    missing: mode === "demo" ? DEMO_CLUSTERS_NOTE : undefined,
  } : null), [transport, name, mode]);
  const back = (
    <Button variant="secondary" asChild>
      <Link to={to()}><ArrowLeft />Overview</Link>
    </Button>
  );

  if (summary && report.data) {
    const doc = report.data;
    const actions = (
      <div className="flex flex-wrap gap-2">
        {back}
        {summary.ab && (
          <Button variant="secondary" asChild>
            <Link to={to(`/abtests/${encodeURIComponent(name)}`)}><FlaskConical />A/B test</Link>
          </Button>
        )}
        <Button onClick={() => saveReport(doc)}><Download />Save report</Button>
      </div>
    );
    // A run of your own engine with no A/B test yet can start one (the view shows the card only then); the demo's
    // runs are recordings.
    const next = mode === "demo" ? null : (
      <AbNextCard run={name} command={abCommand(summary.caseName, summary.name)} job={abJobOf(jobs.data?.items, name)}
        onStart={() => setStarting(true)} />
    );
    return (
      <>
        <ReportView summary={summary} from={mode === "demo" ? "the recorded demo" : "your engine"} action={actions}
          abNext={next} clusterSource={clusters} />
        {next && <StartAbTestDialog open={starting} onOpenChange={setStarting} run={name} />}
      </>
    );
  }
  return (
    <>
      <PageHeader title={name} description="Mesh Doctor report" actions={back} />
      {report.isError ? (
        <>
          <ErrorPanel error={report.error} onRetry={() => void report.refetch()} retrying={report.isFetching} />
          {mode === "demo" && asEngineError(report.error).code === "not-found" && (
            <Card className="mt-4 p-5 text-sm">
              <p className="font-medium">Recorded reports in the demo</p>
              <ul className="mt-2 space-y-1.5">
                {RECORDED.map((s) => (
                  <li key={s.name}>
                    <Link to={to(`/repairs/${s.name}/report`)} className={link}>{s.label}</Link>
                    <span className="text-muted-foreground"> ({s.name})</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      ) : (
        <Card className="p-5">
          <p role="status" className="text-sm text-muted-foreground">Asking the engine for the report…</p>
        </Card>
      )}
    </>
  );
}
