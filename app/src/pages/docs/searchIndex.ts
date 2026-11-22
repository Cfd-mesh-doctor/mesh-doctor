// SPDX-License-Identifier: GPL-3.0-or-later
// Searching all the docs at once: an entry for each section of the pages that show a doc's sections, and for each
// group of Troubleshooting's problems, from the texts those pages show, found by the words typed. How it works,
// Accuracy check, Gallery and Install are written as pages of their own rather than from a doc's sections, so they
// aren't in it yet. It is kept apart from the pages, so a search box can load it only when it is used.
import { plainText, type DocBlock, type DocItem, type DocSection } from "@/lib/docSections";
import { DESIGN } from "@/pages/architecture/design";
import { GUIDE as CLAUDE } from "@/pages/claude/guide";
import { TOUR } from "@/pages/dashboard/tour";
import { LIMITS } from "@/pages/limits/sections";
import { GUIDE as OWN_CASE } from "@/pages/own-case/guide";
import { SAFETY } from "@/pages/safety/rules";
import { GROUPS } from "@/pages/troubleshooting/problems";
import { plain } from "@/pages/troubleshooting/search";
import { ON_SITE } from "./entries";

/** A section to find: its page and the page's name on the Docs page, its anchor, its title as the doc writes it (so
 *  its `code` can show as code) and its text as the page reads, in single spaces. */
export interface SearchEntry {
  page: string;
  pageTitle: string;
  id: string;
  title: string;
  text: string;
}

/** A section found, with a short piece of its text from a little before the first word typed that it holds. */
export interface SearchHit extends SearchEntry {
  snippet: string;
}

const titleOf = (page: string) => ON_SITE.find((d) => d.page === page)?.title ?? page;

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** An item as it reads; a code block shows as the doc writes it. */
function itemText(item: DocItem): string {
  if (typeof item === "string") return plainText(item);
  if ("code" in item) return `${plainText(item.text)} ${item.code}`;
  return [item.text, ...item.list, item.after ?? ""].map(plainText).join(" ");
}

function blockText(b: DocBlock): string {
  if ("code" in b) return b.code;
  if ("text" in b) return plainText(b.text);
  if ("table" in b) return [b.table.head, ...b.table.rows].flat().map(plainText).join(" ");
  if ("heading" in b) return plainText(b.heading);
  if ("picture" in b) return b.alt;
  return b.list.map(itemText).join(" ");
}

const sections = (page: string, list: DocSection[]): SearchEntry[] =>
  list.map((s) => ({ page, pageTitle: titleOf(page), id: s.id, title: s.title, text: tidy(s.blocks.map(blockText).join(" ")) }));

export const SEARCH_INDEX: SearchEntry[] = [
  ...sections("/limits", LIMITS),
  ...sections("/safety", SAFETY),
  ...sections("/your-own-case", OWN_CASE),
  ...sections("/claude-code", CLAUDE),
  ...sections("/dashboard-tour", TOUR),
  ...sections("/architecture", DESIGN),
  ...GROUPS.map((g) => ({
    page: "/troubleshooting",
    pageTitle: titleOf("/troubleshooting"),
    id: g.id,
    title: g.title,
    text: tidy([g.table.head, ...g.table.rows].flat().map(plainText).join(" ")),
  })),
];

/** Each entry's title, and its title and text, as searched: lower case, no quotes, straight apostrophes. */
const FIND = SEARCH_INDEX.map((entry) => {
  const title = plain(plainText(entry.title));
  return { entry, title, all: `${title} ${plain(entry.text)}` };
});

const BEFORE = 60; // characters of the text shown before the word
const LENGTH = 160; // characters shown in all

/** About 160 characters of the text, from a little before the first of the words it holds, cut between words, with
 *  "…" where it was cut. */
function snippet(text: string, words: string[]): string {
  const lower = text.toLowerCase().replace(/[‘’]/g, "'");
  let at = 0;
  let size = 0;
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i >= 0 && (size === 0 || i < at)) [at, size] = [i, w.length];
  }
  let start = Math.max(0, at - BEFORE);
  if (start > 0 && text[start - 1] !== " ") {
    const space = text.indexOf(" ", start);
    if (space !== -1 && space < at) start = space + 1;
  }
  let end = Math.min(text.length, start + LENGTH);
  const space = text.lastIndexOf(" ", end);
  if (end < text.length && space >= at + size) end = space;
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** The sections that hold every word of the query (case, Markdown, quotes and curly apostrophes aside): those whose
 *  title holds them all first, then those where the words appear most; at most `limit`. */
export function searchDocs(query: string, limit = 8): SearchHit[] {
  const words = plain(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const found: { entry: SearchEntry; inTitle: boolean; count: number }[] = [];
  for (const { entry, title, all } of FIND) {
    if (!words.every((w) => all.includes(w))) continue;
    const count = words.reduce((n, w) => n + all.split(w).length - 1, 0);
    found.push({ entry, inTitle: words.every((w) => title.includes(w)), count });
  }
  found.sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || b.count - a.count);
  return found.slice(0, limit).map(({ entry }) => ({ ...entry, snippet: snippet(entry.text, words) }));
}
