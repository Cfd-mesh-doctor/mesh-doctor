// SPDX-License-Identifier: GPL-3.0-or-later
// The "How it works" page states the engine's quality targets and verdicts: they must match the doc they come from.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMANDS, PROFILES, VERDICTS, type DocTable } from "./tables";

const DOC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../docs/how-it-works.md");

/** Every table in a Markdown text, in order (these tables hold no escaped "|"). */
function tables(md: string): DocTable[] {
  const found: DocTable[] = [];
  let lines: string[] = [];
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const flush = () => {
    const [head, , ...rows] = lines;
    if (head) found.push({ head: cells(head), rows: rows.map(cells) });
    lines = [];
  };
  for (const line of md.split(/\r?\n/)) {
    if (line.trimStart().startsWith("|")) lines.push(line);
    else flush();
  }
  flush();
  return found;
}

describe("the How it works page's tables", () => {
  it("are the tables of docs/how-it-works.md, cell for cell", () => {
    expect(tables(readFileSync(DOC, "utf8"))).toEqual([COMMANDS, PROFILES, VERDICTS]);
  });

  it("are read the way the doc writes them", () => {
    const md = "text\n\n| A | B |\n|---|---|\n| `x`, `y` | 1 % |\n\nmore\n| C |\n|---|\n";
    expect(tables(md)).toEqual([
      { head: ["A", "B"], rows: [["`x`, `y`", "1 %"]] },
      { head: ["C"], rows: [] },
    ]);
  });
});
