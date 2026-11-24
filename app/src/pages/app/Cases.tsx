// SPDX-License-Identifier: GPL-3.0-or-later
// The source cases the engine may read, with what has been done to each so far, the report of each one's latest
// finished repair, the size estimate for its mesh, a Repair button that starts a repair of a copy of it (its dialog
// is in StartRepair.tsx), and the command that does the same in a terminal; under a case you made that has a result
// (API 1.8), Plan a transient run (CasePlanDialog in TransientPlan.tsx). What's typed in the filter box stays in the
// address (?q=), as in the site's other search boxes, so a reload or a link keeps it.
import { Check, Copy, FolderOpen, Hourglass, Search, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CopyBlock } from "@/components/shared/CopyBlock";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { SearchInput } from "@/components/shared/SearchInput";
import { VerdictBadge } from "@/components/shared/badges";
import { EmptyState, PageHeader, TableSkeleton } from "@/components/shared/page";
import { Card } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tip } from "@/components/ui/tooltip";
import { repairCommand } from "@/engine/commands";
import { useAppPath } from "@/engine/context";
import { useCases, useRepairs } from "@/engine/hooks";
import type { RepairSummary } from "@/engine/types";
import { caseName } from "@/engine/verdict";
import { cellsField } from "@/estimate/estimate";
import { ADDRESS_FIELD } from "@/lib/addressField";
import { formatCells, formatCount, formatDateTime, formatRelative } from "@/lib/format";
import { DOCS } from "@/lib/site";
import { useCopy } from "@/lib/useCopy";
import { useTitle } from "@/lib/useTitle";
import { cn } from "@/lib/utils";
import { FIRST_RUN_SETUP } from "@/pages/install/commands";
import { StartRepairDialog } from "./StartRepair";
import { CasePlanDialog } from "./TransientPlan";

interface Row {
  name: string;
  runs: RepairSummary[];
  latest?: RepairSummary;
  /** the case's cell count: the engine's (API 1.2), else what its latest repair counted, else unknown */
  cells: number | null;
  /** the command that repairs a copy of it; none until the runs are known, as the copy's name must be a new one */
  command: string | null;
  /** a case you made: its latest written time with its face flux, which a transient plan starts from (API 1.8); null
   * before one, for an engine that doesn't say, and for a case Mesh Doctor made, whose run's page plans it */
  result: string | null;
}

const LINK = "font-medium text-primary hover:underline";

/** The report of a case's latest finished run, named like the Overview's link. */
function ReportLink({ run, className }: { run: string; className?: string }) {
  const to = useAppPath();
  return (
    <Link to={to(`/repairs/${encodeURIComponent(run)}/report`)} aria-label={`Report of ${run}`} className={cn(LINK, className)}>
      Report
    </Link>
  );
}

/** The size estimator for a case's mesh; none when its size is unknown or too small for the estimator. */
function EstimateLink({ name, cells, className }: { name: string; cells: number | null; className?: string }) {
  const to = useAppPath();
  const field = cellsField(cells);
  if (!field) return null;
  return (
    <Link to={to(`/estimate?cells=${field}`)} aria-label={`Size estimate for ${name}`} className={cn(LINK, className)}>
      Estimate
    </Link>
  );
}

/** Copies the command that repairs a copy of a case, to run in WSL or a Linux terminal; pointing at it or focusing it
 * shows the command (beside it: above it, it would hide the case's name). */
function CopyRepairCommand({ command }: { command: string }) {
  const { copied, copy } = useCopy();
  return (
    <Tip label={<code className="font-mono text-[12px]">{command}</code>} side="right">
      <button
        type="button"
        onClick={() => void copy(command)}
        aria-label={copied ? "Copied" : `Copy repair command: ${command}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
      >
        {copied ? <Check className="size-3.5 shrink-0 text-success" aria-hidden /> : <Copy className="size-3.5 shrink-0" aria-hidden />}
        {/* Both words take the same room, so the table doesn't shift while it says "Copied". */}
        <span className="grid text-left">
          <span className={cn("col-start-1 row-start-1", copied && "invisible")}>Copy repair command</span>
          <span className={cn("col-start-1 row-start-1", !copied && "invisible")}>Copied</span>
        </span>
      </button>
    </Tip>
  );
}

export function Cases() {
  useTitle("Cases");
  const to = useAppPath();
  const cases = useCases();
  const repairs = useRepairs();
  // The case whose repair dialog is open, if any.
  const [repairing, setRepairing] = useState<string | null>(null);
  // The case you made whose transient plan is open, with its latest result.
  const [planning, setPlanning] = useState<{ name: string; result: string } | null>(null);
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const setQuery = (q: string) => setParams(q ? { q } : {}, ADDRESS_FIELD);

  const rows = useMemo<Row[]>(() => {
    const bySource = new Map<string, RepairSummary[]>();
    for (const r of repairs.data?.items ?? []) {
      const name = caseName(r.source);
      if (!name) continue;
      const list = bySource.get(name) ?? [];
      list.push(r);
      bySource.set(name, list);
    }
    // Every run's name, whichever case it copied: the workspace has one folder for each.
    const names = (repairs.data?.items ?? []).map((r) => r.name);
    return (cases.data?.items ?? []).map((name) => {
      const runs = (bySource.get(name) ?? []).sort((a, b) => (b.finished ?? "").localeCompare(a.finished ?? ""));
      // An engine older than API 1.2 doesn't say a case's size: its repairs counted the same mesh.
      const cells = cases.data?.cells?.[name] ?? runs.find((r) => r.nCells != null)?.nCells ?? null;
      const result = cases.data?.made?.[name] ? null : cases.data?.results?.[name] ?? null;
      return { name, runs, latest: runs[0], cells, command: repairs.data ? repairCommand(name, names) : null, result };
    });
  }, [cases.data, repairs.data]);

  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
  // What didn't load, and why, at the top: the cases first, else the repair runs. Try again asks again for each one
  // that failed. Runs that didn't load are unknown, not none: no case is called "Not repaired yet" for that.
  const lists = [cases, repairs];
  const failed = lists.find((list) => list.isError);
  const runsFailed = repairs.isError && !repairs.data;

  return (
    <>
      <PageHeader
        title="Cases"
        description={
          <>
            OpenFOAM cases in the engine's cases folder. Mesh Doctor never changes them: every repair works on a copy,
            and a new case from a template goes in a folder of its own. To repair one, press Repair under its name and follow the job on the Jobs screen, or copy its repair command
            and run it in a WSL or Linux terminal. The run shows up here when it finishes.
          </>
        }
      />
      {failed && (
        <ErrorPanel
          className="mb-6"
          error={failed.error}
          onRetry={() => {
            for (const list of lists) if (list.isError) void list.refetch();
          }}
          retrying={lists.some((list) => list.isError && list.isFetching)}
        />
      )}
      <Card data-tour="cases">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          {/* The site's search box: "/" puts the cursor in it, as in the Docs and Troubleshooting searches. */}
          <SearchInput
            icon={Search}
            className="w-full max-w-xs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter cases"
            aria-label="Filter cases"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="text-[13px] text-muted-foreground tabular-nums">
            <span>{cases.data ? `${shown.length} of ${formatCount(rows.length, "case")}` : ""}</span>
            {/* What the message at the top is about: the cases are here, but not what was done to them. */}
            {cases.data && runsFailed && <span> · repair runs didn't load</span>}
          </span>
        </div>
        {cases.isPending ? (
          <TableSkeleton rows={5} cols={4} />
        ) : rows.length === 0 && cases.isError ? (
          // A list that didn't load isn't empty: the message above says why, and the filter has nothing to match.
          <EmptyState icon={FolderOpen} title="The cases didn't load" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="No cases found"
            // Wider than the text above it, so its longest line shows whole on a computer's screen; a phone scrolls it.
            action={<CopyBlock code={FIRST_RUN_SETUP.join("\n")} className="max-w-full text-left" />}
          >
            <p>
              The engine lists folders with a mesh (constant/polyMesh) in its cases folder, by default $FOAM_RUN. To use
              another folder, set it and restart the engine:
            </p>
            <CopyCommand command="MESHDOCTOR_CASES=~/cases meshdoctor serve" className="mx-auto mt-3 max-w-sm text-left" />
            {/* A newcomer's first case: the README's First run, its set-up below to copy, as Getting started gives it. */}
            <p className="mt-4">
              No case yet? <Link to={to("/solve")}
                className="font-medium text-primary underline-offset-4 hover:underline">New case</Link> on the Solve
              screen makes one from a template, the Ahmed body or a wheel and a front wing: the engine copies it into
              its cases folder and meshes it.
            </p>
            <p className="mt-4">
              Or, to try Mesh Doctor on OpenFOAM&apos;s motorBike tutorial, run these in a WSL or Linux
              terminal: they copy it into $FOAM_RUN, where the engine looks, and mesh it, which takes a few minutes. The
              README&apos;s{" "}
              <a href={DOCS.firstRun} target="_blank" rel="noreferrer"
                className="font-medium text-primary underline-offset-4 hover:underline">First run</a>{" "}
              has the rest.
            </p>
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState icon={Search} title="No case matches">Try another part of the name.</EmptyState>
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Case</TH>
                <TH className="hidden sm:table-cell">Repair runs</TH>
                <TH>Latest verdict</TH>
                <TH className="hidden md:table-cell">Cells</TH>
                <TH className="hidden text-right sm:table-cell">Last repaired</TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((r) => (
                <TR key={r.name}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <div className="hidden size-8 shrink-0 place-items-center rounded-lg bg-surface-2 ring-1 ring-border sm:grid">
                        <FolderOpen className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium">{r.name}</div>
                        {/* Phones have only two columns: the runs and the date go under the name; nothing when the
                            runs didn't load, as they are unknown. */}
                        {!runsFailed && (
                          <div className="text-xs text-muted-foreground sm:hidden">
                            {repairs.isPending
                              ? "…"
                              : r.runs.length
                                ? `${r.runs.length} ${r.runs.length === 1 ? "run" : "runs"} · ${formatRelative(r.latest?.finished)}`
                                : "Not repaired yet"}
                          </div>
                        )}
                        {/* The Cells column shows from md: below that, the size and its estimate go here. */}
                        {r.cells != null && (
                          <div className="text-xs text-muted-foreground md:hidden">
                            {formatCells(r.cells)} cells
                            {cellsField(r.cells) && <> · <EstimateLink name={r.name} cells={r.cells} /></>}
                          </div>
                        )}
                        {(r.command || r.result) && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                            {r.command && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setRepairing(r.name)}
                                  aria-label={`Repair ${r.name}`}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                                >
                                  <Wrench className="size-3.5 shrink-0" aria-hidden />
                                  Repair
                                </button>
                                <CopyRepairCommand command={r.command} />
                              </>
                            )}
                            {r.result && (
                              <button
                                type="button"
                                onClick={() => setPlanning({ name: r.name, result: r.result! })}
                                aria-label={`Plan a transient run of ${r.name}`}
                                className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                              >
                                <Hourglass className="size-3.5 shrink-0" aria-hidden />
                                Plan a transient run
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </TD>
                  <TD className="hidden tabular-nums sm:table-cell">
                    {repairs.isPending ? "…" : runsFailed ? <span className="text-muted-foreground">–</span>
                      : r.runs.length || <span className="text-muted-foreground">none</span>}
                  </TD>
                  <TD>
                    {/* The latest run is the latest finished one when there is one (unfinished runs sort last). On
                        phones the link goes under the badge, so this column stays narrow and the names keep their room.
                        A run with no verdict says so in words, as on the Overview; a case never repaired keeps its
                        dash. */}
                    <div className="flex flex-col items-start gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
                      <VerdictBadge verdict={r.latest?.verdict} empty={r.latest && "No verdict"} />
                      {r.latest?.verdict && <ReportLink run={r.latest.name} className="text-[13px]" />}
                    </div>
                  </TD>
                  <TD className="hidden md:table-cell">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="tabular-nums">{formatCells(r.cells)}</span>
                      <EstimateLink name={r.name} cells={r.cells} className="text-[13px]" />
                    </div>
                  </TD>
                  <TD className="hidden text-right text-[13px] whitespace-nowrap text-muted-foreground sm:table-cell" title={formatDateTime(r.latest?.finished)}>
                    {r.latest?.finished ? formatRelative(r.latest.finished) : "–"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <StartRepairDialog open={repairing !== null} onOpenChange={(o) => { if (!o) setRepairing(null); }} source={repairing} />
      {planning && (
        <CasePlanDialog open name={planning.name} result={planning.result}
          onOpenChange={(o) => { if (!o) setPlanning(null); }} />
      )}
    </>
  );
}
