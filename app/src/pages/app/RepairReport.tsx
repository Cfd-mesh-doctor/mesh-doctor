// SPDX-License-Identifier: GPL-3.0-or-later
// A repair's report straight from the engine (GET /repairs/{name}/report), shown as the report viewer shows a file.
// Checked like an opened file first, so a wrong answer reads as an error, not as a broken page.
import { skipToken, useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { PageHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/engine/client";
import { useAppPath, useEngine } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { useTitle } from "@/lib/useTitle";
import { ReportView } from "@/pages/report/Report";
import { checkReport } from "@/report/read";
import { SAMPLES } from "@/report/samples";
import { summarize } from "@/report/summary";

const link = "font-medium text-primary underline-offset-4 hover:underline";

export function RepairReport() {
  const { name = "" } = useParams();
  const { transport, mode } = useEngine();
  const to = useAppPath();
  useTitle(`Report of ${name}`);
  const report = useQuery({
    queryKey: [transport?.scope, "report", name],
    queryFn: transport ? async ({ signal }) => checkReport(await api.report(transport, name, signal)) : skipToken,
    staleTime: 60_000,
  });
  const summary = useMemo(() => (report.data ? summarize(report.data) : undefined), [report.data]);
  const back = (
    <Button variant="secondary" asChild>
      <Link to={to()}><ArrowLeft />Overview</Link>
    </Button>
  );

  if (summary) return <ReportView summary={summary} from={mode === "demo" ? "the recorded demo" : "your engine"} action={back} />;
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
                {SAMPLES.map((s) => (
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
