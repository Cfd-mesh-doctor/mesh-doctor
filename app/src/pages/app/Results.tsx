// SPDX-License-Identifier: GPL-3.0-or-later
// The results of the solved cases in the engine's cases folder (GET /results, API 1.23), newest first: each one's
// drag, its downforce or lift, L/D, the judge's verdict and how far its forces still drift, over the judge's window.
// A case opens on its own page (CaseResults.tsx), with every force group, its coefficients and residuals, and another
// window to average over. The cases whose forces can't be averaged yet are listed with why. Asked for every 15 s: a
// run that solves writes its forces as it goes.
import { ArrowLeftRight, ChartLine, Hourglass, Play, TriangleAlert } from "lucide-react";
import { Link } from "react-router";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { EmptyState, PageHeader, TableSkeleton } from "@/components/shared/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { useAppPath } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { useResultsList } from "@/engine/hooks";
import type { CaseResults, ResultsList } from "@/engine/types";
import { comparePagePath } from "./compareView";
import { formatCells, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import { judgeTone } from "@/report/summary";
import {
  DRIFT_WARN, driftText, headlineDrift, newtons, plusMinus, resultsPagePath, spanText, totalGroup, verticalWord,
  waitingParts,
} from "./resultsView";

const LINK = "font-medium text-primary underline-offset-4 hover:underline";

/** An engine without the results routes (before API 1.23) answers not-found. */
const tooOld = (q: { isError: boolean; error: unknown }) => q.isError && asEngineError(q.error).code === "not-found";

/** The headline drift: a warning over 1 % (run longer before comparing), else plain. */
export function DriftBadge({ drift }: { drift: number | null }) {
  if (drift != null && drift > DRIFT_WARN) {
    return (
      <Badge tone="warning" title="Its forces still change by this much between the window's two halves: run it longer before comparing">
        <TriangleAlert aria-hidden /> {driftText(drift)}
      </Badge>
    );
  }
  return <span className="text-[13px] tabular-nums text-muted-foreground">{driftText(drift)}</span>;
}

/** The judge's verdict, as the other screens show it. */
export function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="text-muted-foreground">–</span>;
  return <Badge tone={judgeTone(verdict)} className="whitespace-normal">{verdict}</Badge>;
}

/** A case's second line: steady or transient, the span its forces cover and its cells. */
function about(doc: CaseResults): string {
  return [
    doc.transient ? "Transient" : "Steady",
    spanText(doc),
    doc.cells != null && `${formatCells(doc.cells)} cells`,
  ].filter((x): x is string => typeof x === "string").join(" · ");
}

function NoResultsYet() {
  const to = useAppPath();
  return (
    <EmptyState
      icon={ChartLine}
      title="No results yet"
      action={(
        <Button variant="secondary" size="sm" asChild>
          <Link to={to("/solve")}><Play aria-hidden /> Go to Solve</Link>
        </Button>
      )}
    >
      A case in the engine&apos;s cases folder shows here once it has solved with a forces or forceCoeffs function
      object: Mesh Doctor averages its forces over the judge&apos;s window and says how sure they are. A run that
      solves shows here as it goes.
    </EmptyState>
  );
}

/** The cases with a force history that can't be averaged yet, and why. */
function Waiting({ waiting }: { waiting: ResultsList["waiting"] }) {
  return (
    <Card className="mt-4">
      <CardHeader>
        <div>
          <CardTitle>Not averaged yet</CardTitle>
          <CardDescription>These cases have begun a force history, but there isn&apos;t enough of it to average.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {waiting.map((w) => {
            const [name, rest] = waitingParts(w);
            return (
              <li key={w.case} className="flex gap-2">
                <Hourglass className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 wrap-anywhere">
                  <span className="font-medium">{name}</span>
                  <span className="text-muted-foreground">{rest}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

export function Results() {
  useTitle("Results");
  const to = useAppPath();
  const q = useResultsList();
  const old = tooOld(q);
  const items = q.data?.items ?? [];
  const waiting = q.data?.waiting ?? [];

  return (
    <>
      <PageHeader
        title="Results"
        description={
          <>
            The forces of each solved case, averaged over the judge&apos;s window: its drag, its downforce or lift and
            L/D, with how sure each mean is, the judge&apos;s verdict and how far its forces still drift. A case&apos;s
            own page has every force group, its coefficients and residuals, and averages over another window. Cases
            solve on the <Link to={to("/solve")} className={LINK}>Solve screen</Link>.
          </>
        }
        actions={q.data && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[13px] text-muted-foreground">
              Updated {formatRelative(new Date(q.dataUpdatedAt).toISOString())}
            </span>
            {items.length > 1 && (
              <Button variant="secondary" asChild>
                <Link to={to(comparePagePath())}><ArrowLeftRight />Compare two cases</Link>
              </Button>
            )}
          </div>
        )}
      />
      {q.isError && !old && (
        <ErrorPanel className="mb-6" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      )}
      <Card data-tour="results">
        {q.isPending ? (
          <TableSkeleton rows={4} cols={5} />
        ) : old ? (
          <EmptyState icon={ChartLine} title="Your engine can't show results yet">
            It is older than the Results screen (it speaks API 1.22 or older). Update Mesh Doctor on your computer,
            then see them here.
          </EmptyState>
        ) : !items.length ? (
          // A list that didn't load isn't empty: the message above says why, and no first step is offered.
          q.isError ? <EmptyState icon={ChartLine} title="The results didn't load" /> : <NoResultsYet />
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                {/* The case and its two forces always show; L/D from sm, the verdict and the drift from md, when its
                    forces were written from lg. On phones the case's second line says its verdict. */}
                <TH>Case</TH>
                <TH className="text-right">Drag (N)</TH>
                <TH className="text-right">Downforce or lift (N)</TH>
                <TH className="hidden text-right sm:table-cell">L/D</TH>
                <TH className="hidden md:table-cell">Verdict</TH>
                <TH className="hidden md:table-cell">Drift</TH>
                <TH className="hidden lg:table-cell">Forces written</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((doc) => {
                const g = totalGroup(doc);
                return (
                  <TR key={doc.case}>
                    <TD>
                      <Link to={to(resultsPagePath(doc.case))} className="font-medium wrap-anywhere underline-offset-4 hover:underline">
                        {doc.case}
                      </Link>
                      <div className="text-xs text-muted-foreground wrap-anywhere">
                        {about(doc)}
                        {doc.verdict && <span className="md:hidden"> · {doc.verdict}</span>}
                      </div>
                    </TD>
                    <TD className="text-right tabular-nums whitespace-nowrap">
                      {newtons(g?.drag)}
                      <div className="text-xs text-muted-foreground">{plusMinus(g?.drag)}</div>
                    </TD>
                    <TD className="text-right tabular-nums whitespace-nowrap">
                      {newtons(g?.vertical)}
                      <div className="text-xs text-muted-foreground">
                        {verticalWord(doc).toLowerCase()} {plusMinus(g?.vertical)}
                      </div>
                    </TD>
                    <TD className="hidden text-right tabular-nums sm:table-cell">{formatNumber(g?.LD, 3)}</TD>
                    <TD className="hidden md:table-cell"><VerdictBadge verdict={doc.verdict} /></TD>
                    <TD className="hidden md:table-cell"><DriftBadge drift={headlineDrift(doc)} /></TD>
                    <TD className="hidden text-[13px] whitespace-nowrap text-muted-foreground lg:table-cell"
                      title={doc.updated ? formatDateTime(doc.updated) : undefined}>
                      {formatRelative(doc.updated)}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
      {!old && waiting.length > 0 && <Waiting waiting={waiting} />}
    </>
  );
}
