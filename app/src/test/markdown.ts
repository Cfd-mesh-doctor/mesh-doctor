// SPDX-License-Identifier: GPL-3.0-or-later
// Reading the repository's docs (docs/, the README) for the tests that keep pages equal to them.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { githubAnchor, type DocBlock, type DocItem, type DocSection } from "@/lib/docSections";
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
 * A doc's "## " sections in order, each as blocks (markdownBlocks). Text before the first section is left out:
 * markdownOpening reads it.
 */
export function markdownSections(md: string): DocSection[] {
  const [, ...parts] = md.split(/^## /m);
  return parts.map((part) => {
    const [title = "", ...body] = part.split(/\r?\n/);
    return { id: githubAnchor(title), title, blocks: markdownBlocks(body) };
  });
}

/** The blocks before a doc's first "## " section, without its "# " title. */
export function markdownOpening(md: string): DocBlock[] {
  const [opening = ""] = md.split(/^## /m);
  return markdownBlocks(opening.split(/\r?\n/).filter((line) => !line.startsWith("# ")));
}

/**
 * Lines of a doc as blocks: paragraphs (lines joined by spaces), lists (one entry per "- " item, with the item's
 * indented lines joined to it and a fenced code block indented under it kept with it) and fenced code blocks, with
 * the language the doc names. A paragraph ends a list, and so does a blank line unless the item's own indented lines
 * follow it.
 */
function markdownBlocks(lines: string[]): DocBlock[] {
  const blocks: DocBlock[] = [];
  let para: string[] = [];
  let list: DocItem[] | undefined;
  const flush = () => {
    if (para.length) blocks.push({ text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const last = list?.at(-1);
    const fence = /^( *)```(\w*)\s*$/.exec(line);
    if (fence) {
      const indent = fence[1]?.length ?? 0;
      const lang = fence[2];
      const body: string[] = [];
      for (i++; i < lines.length && !/^ *```\s*$/.test(lines[i] ?? ""); i++) body.push((lines[i] ?? "").slice(indent));
      const code = body.join("\n");
      flush();
      if (indent > 0 && list && typeof last === "string") list[list.length - 1] = { text: last, code };
      else {
        list = undefined;
        blocks.push(lang ? { code, lang } : { code });
      }
      continue;
    }
    const item = /^- (.+)$/.exec(line)?.[1];
    if (item) {
      flush();
      if (list) list.push(item);
      else {
        list = [item];
        blocks.push({ list });
      }
      continue;
    }
    const more = /^ {2,}(\S.*)$/.exec(line)?.[1];
    if (more && list && typeof last === "string") {
      list[list.length - 1] = `${last} ${more.trim()}`;
      continue;
    }
    if (line.trim()) {
      list = undefined;
      para.push(line.trim());
    } else {
      flush();
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (!next || !/^ {2,}\S/.test(next)) list = undefined;
    }
  }
  flush();
  return blocks;
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
