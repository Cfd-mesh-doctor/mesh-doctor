// SPDX-License-Identifier: GPL-3.0-or-later
// Tables that pages copy from the docs in docs/. A page keeps such a table exactly as the doc writes it (`code` in
// backticks), and a test compares it with the doc (src/test/markdown.ts), so the page can't fall behind the doc.

/** A table as the doc writes it: the header cells, then the rows. */
export type DocTable = { head: string[]; rows: string[][] };

/** The cells of one column, found by its header. */
export function column(table: DocTable, name: string): string[] {
  const i = table.head.indexOf(name);
  if (i < 0) throw new Error(`The table has no "${name}" column`);
  return table.rows.map((row) => row[i] ?? "");
}
