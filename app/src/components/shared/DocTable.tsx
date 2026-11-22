// SPDX-License-Identifier: GPL-3.0-or-later
// A table copied from a doc (see lib/docTable.ts), shown with the doc's `code` as code.
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import type { DocTable } from "@/lib/docTable";

/** Text as the doc writes it, with `code` in backticks. A command name, and a number with its "%", stay on one line. */
function Inline({ text }: { text: string }) {
  const parts = text.replace(/ %/g, "\u00a0%").split("`");
  return <>{parts.map((part, i) => (i % 2 ? <code key={i} className="whitespace-nowrap">{part}</code> : part))}</>;
}

/** format: how a cell reads on the page, when it differs from the doc's text ("25 deg" as "25°"). */
export function DocTableView({ table, caption, format = (cell) => cell }: {
  table: DocTable;
  caption: string;
  format?: (cell: string) => string;
}) {
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <THead>
        <TR className="hover:bg-transparent">{table.head.map((h) => <TH key={h}>{h}</TH>)}</TR>
      </THead>
      <TBody>
        {table.rows.map((row) => (
          <TR key={row[0]}>
            {row.map((cell, i) => (
              <TD key={i} className={i === 0 ? "align-top font-medium" : "align-top"}><Inline text={format(cell)} /></TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
