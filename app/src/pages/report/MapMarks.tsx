// SPDX-License-Identifier: GPL-3.0-or-later
// The repair map's marks as a table. The map's read-out opens only where a pointer points, so this is the way to them
// with a keyboard or a screen reader, and for anyone who wants the numbers: each defect left after the repair (first,
// as they need a look) and each one found and repaired.
import { ChevronRight } from "lucide-react";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatInt } from "@/lib/format";
import type { Defect, MapSummary } from "@/report/map";

const where = (d: Defect) => `(${d.c.map((x) => x.toFixed(3)).join(", ")})`;

const wrong = (d: Defect) =>
  [d.kinds.join(", "), d.nonOrtho != null && `non-ortho ${d.nonOrtho}°`, d.skew != null && `skew ${d.skew}`]
    .filter(Boolean).join(" · ");

export function MapMarks({ map }: { map: MapSummary }) {
  const rows = [...map.after.map((d) => ({ d, left: true })), ...map.before.map((d) => ({ d, left: false }))];
  if (!rows.length) return null;
  const patches = rows.some(({ d }) => d.patches.length > 0); // older maps don't name them: no empty column then
  return (
    <details className="group mt-4 print:hidden">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
        List the {formatInt(rows.length)} mark{rows.length === 1 ? "" : "s"}
      </summary>
      <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-border">
        <Table aria-label="Marks on the repair map">
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Defect</TH>
              <TH>Where (x, y, z) in m</TH>
              <TH className="text-right">Faces</TH>
              <TH>What was wrong</TH>
              {patches && <TH>Patch</TH>}
            </TR>
          </THead>
          <TBody>
            {rows.map(({ d, left }, i) => (
              <TR key={i}>
                <TD className="whitespace-nowrap">{left ? "left after the repair" : "found and repaired"}</TD>
                <TD className="font-mono text-xs whitespace-nowrap">{where(d)}</TD>
                <TD className="text-right tabular-nums">{formatInt(d.n)}</TD>
                <TD>{wrong(d)}</TD>
                {patches && <TD>{d.patches.join(", ")}</TD>}
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </details>
  );
}
