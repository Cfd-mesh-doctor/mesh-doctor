// SPDX-License-Identifier: GPL-3.0-or-later
// The source cases the engine may read, with what has been done to each so far.
import { FolderOpen, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { VerdictBadge } from "@/components/shared/badges";
import { EmptyState, PageHeader, TableSkeleton } from "@/components/shared/page";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { useCases, useRepairs } from "@/engine/hooks";
import type { RepairSummary } from "@/engine/types";
import { caseName } from "@/engine/verdict";
import { formatCells, formatDateTime, formatRelative } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";

interface Row {
  name: string;
  runs: RepairSummary[];
  latest?: RepairSummary;
}

export function Cases() {
  useTitle("Cases");
  const cases = useCases();
  const repairs = useRepairs();
  const [query, setQuery] = useState("");

  const rows = useMemo<Row[]>(() => {
    const bySource = new Map<string, RepairSummary[]>();
    for (const r of repairs.data?.items ?? []) {
      const name = caseName(r.source);
      if (!name) continue;
      const list = bySource.get(name) ?? [];
      list.push(r);
      bySource.set(name, list);
    }
    return (cases.data?.items ?? []).map((name) => {
      const runs = (bySource.get(name) ?? []).sort((a, b) => (b.finished ?? "").localeCompare(a.finished ?? ""));
      return { name, runs, latest: runs[0] };
    });
  }, [cases.data, repairs.data]);

  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;

  return (
    <>
      <PageHeader
        title="Cases"
        description="OpenFOAM cases in the engine's cases folder. Mesh Doctor only ever reads them: every repair works on a copy."
      />
      {cases.isError && <ErrorPanel className="mb-6" error={cases.error} onRetry={() => cases.refetch()} retrying={cases.isFetching} />}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter cases"
              aria-label="Filter cases"
              className="pl-9"
            />
          </div>
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {cases.data ? `${shown.length} of ${rows.length} cases` : ""}
          </span>
        </div>
        {cases.isPending ? (
          <TableSkeleton rows={5} cols={4} />
        ) : rows.length === 0 && !cases.isError ? (
          <EmptyState icon={FolderOpen} title="No cases found">
            <p>
              The engine lists folders with a mesh (constant/polyMesh) in its cases folder, by default $FOAM_RUN. To use
              another folder, set it and restart the engine:
            </p>
            <CopyCommand command="MESHDOCTOR_CASES=~/cases meshdoctor serve" className="mx-auto mt-3 max-w-sm text-left" />
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
                        {/* Phones have only two columns: the runs and the date go under the name. */}
                        <div className="text-xs text-muted-foreground sm:hidden">
                          {repairs.isPending
                            ? "…"
                            : r.runs.length
                              ? `${r.runs.length} ${r.runs.length === 1 ? "run" : "runs"} · ${formatRelative(r.latest?.finished)}`
                              : "Not repaired yet"}
                        </div>
                      </div>
                    </div>
                  </TD>
                  <TD className="hidden tabular-nums sm:table-cell">
                    {repairs.isPending ? "…" : r.runs.length || <span className="text-muted-foreground">none</span>}
                  </TD>
                  <TD><VerdictBadge verdict={r.latest?.verdict} /></TD>
                  <TD className="hidden tabular-nums md:table-cell">{formatCells(r.latest?.nCells)}</TD>
                  <TD className="hidden text-right text-[13px] whitespace-nowrap text-muted-foreground sm:table-cell" title={formatDateTime(r.latest?.finished)}>
                    {r.latest?.finished ? formatRelative(r.latest.finished) : "–"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
