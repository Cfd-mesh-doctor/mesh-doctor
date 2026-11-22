// SPDX-License-Identifier: GPL-3.0-or-later
// Reading the repository's docs (docs/, the README) for the tests that keep pages equal to them.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { githubAnchor, type DocSection } from "@/lib/docSections";
import type { DocTable } from "@/lib/docTable";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** A doc's text, e.g. readDoc("how-it-works.md"). */
export function readDoc(name: string): string {
  return readRepo(`docs/${name}`);
}

/** The file names of the repository's docs (docs/*.md), sorted. */
export function docNames(): string[] {
  return readdirSync(resolve(ROOT, "docs")).filter((f) => f.endsWith(".md")).sort();
}

/** A file of the repository, e.g. readRepo("README.md"). */
export function readRepo(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

/**
 * A doc's "## " sections, each with its paragraphs (lines joined by spaces) and lists (one string per "- " item), in
 * order. Text before the first section (the "# " title) is left out; a blank line or a paragraph ends a list.
 */
export function markdownSections(md: string): DocSection[] {
  const sections: DocSection[] = [];
  let para: string[] = [];
  let inList = false;
  const flush = () => {
    if (para.length) sections.at(-1)?.blocks.push({ text: para.join(" ") });
    para = [];
  };
  for (const line of md.split(/\r?\n/)) {
    const heading = /^## (.+)$/.exec(line)?.[1];
    if (heading) {
      flush();
      inList = false;
      sections.push({ id: githubAnchor(heading), title: heading, blocks: [] });
      continue;
    }
    const blocks = sections.at(-1)?.blocks;
    if (!blocks) continue;
    const item = /^- (.+)$/.exec(line)?.[1];
    const last = blocks.at(-1);
    if (item) {
      flush();
      if (inList && last && "list" in last) last.list.push(item);
      else blocks.push({ list: [item] });
      inList = true;
    } else {
      if (line.trim()) para.push(line.trim());
      else flush();
      inList = false;
    }
  }
  flush();
  return sections;
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
