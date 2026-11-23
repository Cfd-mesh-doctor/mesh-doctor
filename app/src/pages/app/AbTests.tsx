// SPDX-License-Identifier: GPL-3.0-or-later
// Every A/B test in the engine's workspace, running ones first, then newest first: what each is doing and, once
// both its runs have ended, whether the repaired mesh's residuals ended lower. A test has the name of the repair run
// it tests, and opens on its own screen (AbTest.tsx), live while it runs. An engine older than API 1.3 only names its
// tests: the list then has their jobs' states, and each test's own screen has the rest.
import { ExternalLink, FlaskConical, Wrench } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { AbStateBadge } from "@/components/shared/badges";
import { DashboardLink } from "@/components/shared/DashboardLink";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { EmptyState, PageHeader, TableSkeleton } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { useAppPath, useEngineDashboard } from "@/engine/context";
import { ACTIVE_POLL_MS, IDLE_POLL_MS, useAbtests, useJobs, useRepairs } from "@/engine/hooks";
import { isActive } from "@/engine/types";
import { caseName } from "@/engine/verdict";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import { abRows, outcomeText, stepText } from "@/report/abtest";
import { changeText } from "@/pages/report/tone";

const LINK = "font-medium text-primary underline-offset-4 hover:underline";

function NoTestsYet() {
  const to = useAppPath();
  const dashboard = useEngineDashboard();
  return (
    <EmptyState
      icon={FlaskConical}
      title="No A/B tests yet"
      action={(
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link to={to("/repairs")}><Wrench aria-hidden /> Go to your repairs</Link>
          </Button>
          {dashboard && (
            <Button variant="secondary" size="sm" asChild>
              <a href={dashboard} target="_blank" rel="noreferrer">
                Open the engine's dashboard <ExternalLink aria-hidden />
              </a>
            </Button>
          )}
        </div>
      )}
    >
      An A/B test solves a case twice with the same settings, on the original mesh and on its repaired copy, to see
      whether the repair helps the solver. For now it starts from the engine&apos;s own dashboard, or in a WSL or Linux
      terminal with the command a finished repair&apos;s report gives. Each test shows here while it runs.
    </EmptyState>
  );
}

export function AbTests() {
  useTitle("A/B tests");
  const to = useAppPath();
  const jobs = useJobs();
  const busy = jobs.data?.items.some((j) => (j.kind === "abtest" || j.kind === "abextend") && isActive(j.state)) ?? false;
  const list = useAbtests(busy ? ACTIVE_POLL_MS : IDLE_POLL_MS);
  const repairs = useRepairs();
  const cases = useMemo(() => new Map((repairs.data?.items ?? []).map((r) => [r.name, caseName(r.source)])), [repairs.data]);
  const rows = useMemo(
    () => abRows(list.data?.items ?? [], list.data?.tests, jobs.data?.items, cases),
    [list.data, jobs.data, cases],
  );
  const old = list.data != null && list.data.tests == null;

  return (
    <>
      <PageHeader
        title="A/B tests"
        description={
          <>
            Each A/B test solves a case twice with the same settings, on the original mesh and on the repaired one, and
            compares how far each converges: below 1× the repaired mesh&apos;s residuals end lower. A test has the name of
            the repair it tests, on the <Link to={to("/repairs")} className={LINK}>Repairs screen</Link>; tests start
            from <DashboardLink /> for now.
          </>
        }
        actions={list.data && (
          <span className="text-[13px] text-muted-foreground">
            Updated {formatRelative(new Date(list.dataUpdatedAt).toISOString())}
          </span>
        )}
      />
      {list.isError && (
        <ErrorPanel className="mb-6" error={list.error} onRetry={() => list.refetch()} retrying={list.isFetching} />
      )}
      {old && rows.length > 0 && (
        <p className="mb-4 text-sm text-muted-foreground">
          Your engine names its A/B tests but is too old to say how each went (it speaks API 1.2 or older). Open a test
          to see it, or update Mesh Doctor.
        </p>
      )}
      <Card>
        {list.isPending ? (
          <TableSkeleton rows={3} cols={4} />
        ) : !rows.length ? (
          list.isError ? <EmptyState icon={FlaskConical} title="The A/B tests didn't load" /> : <NoTestsYet />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                {/* As on the Repairs screen: the result and the link from sm, Finished from md. On phones the
                    test's name is its link and its result goes under it. */}
                <TH>Test</TH>
                <TH>State</TH>
                <TH className="hidden text-right sm:table-cell">Repaired ÷ original</TH>
                <TH className="hidden md:table-cell">Finished</TH>
                <TH className="hidden text-right sm:table-cell"><span className="sr-only">Open</span></TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const path = `/abtests/${encodeURIComponent(r.name)}`;
                const doing = r.state === "running" || r.state === "unfinished" ? stepText(r.step ?? r.job?.progress?.step) : null;
                return (
                  <TR key={r.name}>
                    <TD>
                      <Link to={to(path)} className="font-medium wrap-anywhere underline-offset-4 hover:underline">{r.name}</Link>
                      <div className="text-xs text-muted-foreground wrap-anywhere">
                        {[r.caseName, doing].filter(Boolean).join(" · ") || "–"}
                        {r.outcome && (
                          <span className="sm:hidden"> · <span className={changeText(r.outcome.change)}>{r.outcome.ratio.toFixed(2)}×</span></span>
                        )}
                      </div>
                    </TD>
                    <TD><AbStateBadge state={r.state} queued={r.job?.state === "queued"} /></TD>
                    <TD className="hidden text-right text-[13px] whitespace-nowrap tabular-nums sm:table-cell">
                      {r.outcome ? (
                        <><span className={changeText(r.outcome.change)}>{r.outcome.ratio.toFixed(2)}×</span>
                          <span className="text-muted-foreground"> {outcomeText(r.outcome)}</span></>
                      ) : "–"}
                    </TD>
                    <TD className="hidden text-[13px] whitespace-nowrap text-muted-foreground md:table-cell"
                      title={r.finished ? formatDateTime(r.finished) : undefined}>
                      {r.finished ? formatRelative(r.finished) : "–"}
                    </TD>
                    <TD className="hidden text-right sm:table-cell">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={to(path)} aria-label={`${r.state === "running" ? "Follow" : "Open"} the A/B test of ${r.name}`}>
                          {r.state === "running" ? "Follow" : "Open"}
                        </Link>
                      </Button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
