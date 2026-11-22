// SPDX-License-Identifier: GPL-3.0-or-later
// Reading the repository's docs (docs/, the README) for the tests that keep pages equal to them.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DocTable } from "@/lib/docTable";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** A doc's text, e.g. readDoc("how-it-works.md"). */
export function readDoc(name: string): string {
  return readRepo(`docs/${name}`);
}

/** A file of the repository, e.g. readRepo("README.md"). */
export function readRepo(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

/** Every table in a Markdown text, in order (these tables hold no escaped "|"). */
export function markdownTables(md: string): DocTable[] {
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

/** The lines of every fenced code block in a Markdown text, in order. */
export function markdownCode(md: string): string[][] {
  const blocks: string[][] = [];
  let open: string[] | null = null;
  for (const line of md.split(/\r?\n/)) {
    if (line.trimStart().startsWith("```")) {
      if (open) blocks.push(open);
      open = open ? null : [];
    } else if (open) {
      open.push(line);
    }
  }
  return blocks;
}
