// SPDX-License-Identifier: GPL-3.0-or-later
// Docs written as sections of paragraphs and lists, which pages copy exactly as the doc writes them (docTable.ts does
// the same for tables). A test compares each copy with its doc (src/test/markdown.ts), so a page can't fall behind.

/** A paragraph (its lines joined by spaces), or a list with one string per item. */
export type DocBlock = { text: string } | { list: string[] };

/** One "## " section of a doc. */
export type DocSection = { id: string; title: string; blocks: DocBlock[] };

/** The anchor GitHub gives a heading, so a link to a section works on the site and on GitHub alike. */
export function githubAnchor(title: string): string {
  return title.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s/g, "-");
}
