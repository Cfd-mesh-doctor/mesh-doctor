// SPDX-License-Identifier: GPL-3.0-or-later
// Every repair run in the engine's workspace, newest first: its case, size, limits and verdict, its report once it
// has finished, and the job of a run the engine is making. The filter lives in the address (?show=worse), so a
// reload or a link keeps it.
import { FolderOpen, Wrench } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { JobStateBadge, VerdictBadge } from "@/components/shared/badges";
import { EmptyState, PageHeader, TableSkeleton } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { useAppPath } from "@/engine/context";
import { useJobs, useRepairs } from "@/engine/hooks";
import { caseName, newestFirst, runStep, runUpdated } from "@/engine/verdict";
import { formatCells, formatDateTime, formatRelative } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import { RUN_FILTERS, jobOf, runGroup, runLink, shownJobState, type RunFilter } from "./runs";

/** The limits a run's checkMesh used, named as the engine's dashboard names them. */
const LIMITS: Record<string, string> = { openfoam: "OpenFOAM's", strict: "Strict" };

const LINK = "font-medium text-primary underline-offset-4 hover:underline";

/** No run yet: where one starts. Each case on the Cases screen has its own repair command, names filled in. */
function NoRunsYet() {
  const to = useAppPath();
  return (
    <EmptyState
      icon={Wrench}
      title="No repair runs yet"
      action={(
        <Button variant="secondary" size="sm" asChild>
          <Link to={to("/cases")}><FolderOpen aria-hidden /> Go to your cases</Link>
        </Button>
      )}
    >
      Each case on the Cases screen has the command that repairs a copy of it, to run in a WSL or Linux terminal. The
      run shows here once its copy is made, and its verdict and report when it finishes.
    </EmptyState>
  );
}

export function Repairs() {
  useTitle("Repairs");
  const to = useAppPath();
  const repairs = useRepairs();
  const jobs = useJobs();
  // No filter, or a word the page doesn't know, shows every run.
  const [params, setParams] = useSearchParams();
  const filter: RunFilter = RUN_FILTERS.find((f) => f === params.get("show")) ?? "all";
  const setFilter = (f: RunFilter) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (f === "all") next.delete("show");
      else next.set("show", f);
      return next;
    }, { replace: true, preventScrollReset: true });

  const items = useMemo(() => newestFirst(repairs.data?.items ?? []), [repairs.data]);
  const counts = useMemo(() => {
    const c: Record<RunFilter, number> = { all: items.length, improved: 0, unchanged: 0, worse: 0, unfinished: 0 };
    for (const r of items) c[runGroup(r)]++;
    return c;
  }, [items]);
  const shown = filter === "all" ? items : items.filter((r) => runGroup(r) === filter);

  const label = (text: string, n: number) => (
    <span className="inline-flex items-center gap-1.5">
      {text}
      <span className="text-[11px] text-muted-foreground tabular-nums">{n}</span>
    </span>
  );

  return (
    <>
      <PageHeader
        title="Repairs"
        description={
          <>
            Every repair run, newest first. A repair works on a copy of a case, so the case itself is never changed;
            its verdict compares checkMesh before and after. Each case&apos;s repair command is on the{" "}
            <Link to={to("/cases")} className={LINK}>Cases screen</Link>.
          </>
        }
        actions={
          repairs.data && (
            <span className="text-[13px] text-muted-foreground">
              Updated {formatRelative(new Date(repairs.dataUpdatedAt).toISOString())}
            </span>
          )
        }
      />
      {repairs.isError && (
        <ErrorPanel className="mb-6" error={repairs.error} onRetry={() => repairs.refetch()} retrying={repairs.isFetching} />
      )}
      <Card>
        <div className="flex items-center gap-3 border-b border-border px-3 py-3 sm:px-4">
          {/* Like the Jobs screen's: the choices that don't fit a phone's width go on to a second line. */}
          <Segmented
            label="Show repair runs"
            wrap
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: label("All", counts.all) },
              { value: "improved", label: label("Improved", counts.improved) },
              { value: "unchanged", label: label("Unchanged", counts.unchanged) },
              { value: "worse", label: label("Worse", counts.worse) },
              { value: "unfinished", label: label("Not finished", counts.unfinished) },
            ]}
          />
        </div>
        {repairs.isPending ? (
          <TableSkeleton rows={5} cols={4} />
        ) : !items.length ? (
          // A list that didn't load isn't empty: the message above says why, and no first step is offered.
          repairs.isError ? <EmptyState icon={Wrench} title="The repair runs didn't load" /> : <NoRunsYet />
        ) : shown.length === 0 ? (
          <EmptyState icon={Wrench} title="No repair runs in this view">Pick another filter to see the rest.</EmptyState>
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                {/* A column shows from the width where the card has room for it, as on the Jobs screen: Finished and
                    the link from sm, Cells from md, Limits from xl. On phones the run's name is its link. */}
                <TH>Run</TH>
                <TH>Verdict</TH>
                <TH className="hidden text-right md:table-cell">Cells</TH>
                <TH className="hidden xl:table-cell">Limits</TH>
                <TH className="hidden sm:table-cell">Finished</TH>
                <TH className="hidden text-right sm:table-cell"><span className="sr-only">Open</span></TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((r) => {
                const job = jobOf(jobs.data?.items, r.name);
                const link = runLink(r, job);
                const step = runStep(r);
                const updated = runUpdated(r);
                const state = shownJobState(r, job);
                return (
                  <TR key={r.name}>
                    <TD>
                      {link ? (
                        <Link to={to(link.path)} className="font-medium wrap-anywhere underline-offset-4 hover:underline">{r.name}</Link>
                      ) : (
                        <span className="font-medium wrap-anywhere">{r.name}</span>
                      )}
                      <div className="text-xs text-muted-foreground wrap-anywhere">
                        {/* A finished run names its case; one under way says its last step and when it was. */}
                        {r.source ? caseName(r.source) : (step ?? "Starting")}
                        {!r.source && updated && <>{" "}<span className="whitespace-nowrap">· {formatRelative(updated)}</span></>}
                      </div>
                    </TD>
                    <TD>
                      {/* A run with no verdict that a job is making says what the job is doing (running, failed,
                          cancelled), rather than only that it hasn't finished. */}
                      {state ? <JobStateBadge state={state} /> : <VerdictBadge verdict={r.verdict} pending={step} empty="No verdict" />}
                    </TD>
                    <TD className="hidden text-right text-[13px] tabular-nums md:table-cell">{formatCells(r.nCells)}</TD>
                    <TD className="hidden text-[13px] xl:table-cell">{r.profile ? (LIMITS[r.profile] ?? r.profile) : "–"}</TD>
                    <TD className="hidden text-[13px] whitespace-nowrap text-muted-foreground sm:table-cell"
                      title={r.finished ? formatDateTime(r.finished) : undefined}>
                      {r.finished ? formatRelative(r.finished) : "–"}
                    </TD>
                    <TD className="hidden text-right sm:table-cell">
                      {link && (
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={to(link.path)} aria-label={`${link.label} of ${r.name}`}>{link.label}</Link>
                        </Button>
                      )}
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
