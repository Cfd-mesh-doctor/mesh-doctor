// SPDX-License-Identifier: GPL-3.0-or-later
// Docs written as sections of paragraphs and lists, which pages copy exactly as the doc writes them (docTable.ts does
// the same for tables). A test compares each copy with its doc (src/test/markdown.ts), so a page can't fall behind.

import type { DocTable } from "@/lib/docTable";

/** A list item: its text, with the code block or the list the doc writes under it when it has one (and the paragraph
 *  the doc writes after that list, still in the item). */
export type DocItem = string | { text: string; code: string } | { text: string; list: string[]; after?: string };

/** A paragraph (its lines joined by spaces), a list ("1. " items make it numbered), a fenced code block with the
 *  language the doc names, a table, a picture (its file as the doc writes it, relative to docs/, and its alt text) or
 *  a "### " heading inside a section. */
export type DocBlock =
  | { text: string }
  | { list: DocItem[]; numbered?: boolean }
  | { code: string; lang?: string }
  | { table: DocTable }
  | { picture: string; alt: string }
  | { heading: string };

/** One "## " section of a doc. */
export type DocSection = { id: string; title: string; blocks: DocBlock[] };

/** The pictures a page shows for its doc, by the path the doc writes ("images/run.png"): the built file and its size
 *  in pixels, so the page doesn't jump while they load. */
export type DocPictures = Record<string, { src: string; width: number; height: number }>;

/** The anchor GitHub gives a heading, so a link to a section works on the site and on GitHub alike. */
export function githubAnchor(title: string): string {
  return title.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s/g, "-");
}

/** A doc's text without its Markdown, as the page reads: `code`, **bold** and [label](link) read as their words. */
export const plainText = (text: string) => text.replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1").replace(/[`*]/g, "");
