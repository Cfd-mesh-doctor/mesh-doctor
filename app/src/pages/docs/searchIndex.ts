// SPDX-License-Identifier: GPL-3.0-or-later
// Searching all the docs at once, by the words typed: an entry for each section of the pages that show a doc's
// sections, for each of the Gallery's sections and for each group of Troubleshooting's problems, from the texts
// those pages show; and for How it works, Accuracy check and Install, written as pages of their own, one for the
// page's top and one for each of its sections, from the words those pages show (pageText.ts, which a test writes
// from them). The two tools are found by what the Docs page says about them. It is kept apart from the pages, so the
// Docs page's search (DocSearch.tsx) loads it only when it is used.
import { plainText, type DocBlock, type DocItem, type DocSection } from "@/lib/docSections";
import { DESIGN } from "@/pages/architecture/design";
import { GUIDE as CLAUDE } from "@/pages/claude/guide";
import { TOUR } from "@/pages/dashboard/tour";
import { GALLERY, type GallerySection } from "@/pages/gallery/pictures";
import { LIMITS } from "@/pages/limits/sections";
import { GUIDE as OWN_CASE } from "@/pages/own-case/guide";
import { SAFETY } from "@/pages/safety/rules";
import { GROUPS } from "@/pages/troubleshooting/problems";
import { holdsMessage, matches, plain } from "@/pages/troubleshooting/search";
import { ON_SITE } from "./entries";
import { PAGE_TEXT } from "./pageText";

/** A section to find, or a page's top (no anchor): its page and the page's name on the Docs page, its anchor, its title
 *  as the doc writes it (so its `code` can show as code) and its text as the page reads, in single spaces. */
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

/** A Gallery section as the page reads it: what made its pictures and what they show, then their captions. */
const gallery = (s: GallerySection): SearchEntry => {
  const said = [`Made by ${s.tool}. ${s.text}`, s.see ? `See the ${s.see.label}.` : "", ...s.pictures.map((p) => `${p.alt}.`)];
  return { page: "/gallery", pageTitle: titleOf("/gallery"), id: s.id, title: s.title, text: tidy(said.join(" ")) };
};

/** Where a page is in the Docs page's list. */
const listedAt = (page: string) => ON_SITE.findIndex((d) => d.page === page);

/** The sections, in the Docs page's order, so a tie between two sections goes to the page listed first. */
const SECTIONS: SearchEntry[] = [
  ...PAGE_TEXT.map((e) => ({ ...e, pageTitle: titleOf(e.page) })),
  ...GALLERY.map(gallery),
  ...sections("/dashboard-tour", TOUR),
  ...sections("/your-own-case", OWN_CASE),
  ...sections("/claude-code", CLAUDE),
  ...GROUPS.map((g) => ({
    page: "/troubleshooting",
    pageTitle: titleOf("/troubleshooting"),
    id: g.id,
    title: g.title,
    text: tidy(g.table.rows.flat().map(plainText).join(" ")),
  })),
  ...sections("/limits", LIMITS),
  ...sections("/safety", SAFETY),
  ...sections("/architecture", DESIGN),
].sort((a, b) => listedAt(a.page) - listedAt(b.page));

/** The pages the Docs page lists whose words aren't searched (the two tools): each is found by what the Docs page
 *  says about it instead. */
const summed = ON_SITE.filter((d) => d.page && !SECTIONS.some((e) => e.page === d.page));

/** Their names, in the Docs page's order. */
export const SUMMED = summed.map((d) => d.title);

/** The sections, then each page whose words aren't searched, by what the Docs page says about it, opening at its top
 *  (no anchor). */
export const SEARCH_INDEX: SearchEntry[] = [
  ...SECTIONS,
  ...summed.map((d) => ({ page: d.page ?? "/", pageTitle: d.title, id: "", title: d.title, text: d.about })),
];

/** The words of a query, as they are looked for. */
export const queryWords = (query: string) => plain(query).split(" ").filter(Boolean);

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Where the text holds the word at the start of one of its own words ("pair" in "pairing", not in "repair"); a word
 *  that begins with a mark, such as "-->", anywhere. */
function places(text: string, word: string): number[] {
  const found: number[] = [];
  for (let i = text.indexOf(word); i !== -1; i = text.indexOf(word, i + 1)) {
    if (!isWordChar(word[0]) || !isWordChar(text[i - 1])) found.push(i);
  }
  return found;
}

/** Each entry as searched: its title and text in lower case, without quotes, with straight apostrophes; and for a
 *  Troubleshooting group, its problems, whose messages a line pasted from a log may hold. */
const FIND = SEARCH_INDEX.map((entry) => ({
  entry,
  title: plain(plainText(entry.title)),
  text: plain(entry.text),
  rows: entry.page === "/troubleshooting" ? (GROUPS.find((g) => g.id === entry.id)?.table.rows ?? []) : [],
}));

const BEFORE = 60; // characters of the text shown before the word
const LENGTH = 160; // characters shown in all

/** About 160 characters of the text, from a little before the first of the words it holds, cut between words, with
 *  "…" where it was cut. */
function snippet(text: string, words: string[]): string {
  const lower = text.toLowerCase().replace(/[‘’]/g, "'");
  let at = 0;
  let size = 0;
  for (const w of words) {
    const i = places(lower, w)[0] ?? -1;
    if (i >= 0 && (size === 0 || i < at)) [at, size] = [i, w.length];
  }
  let start = Math.max(0, at - BEFORE);
  if (start > 0 && text[start - 1] !== " ") {
    const space = text.indexOf(" ", start);
    if (space !== -1 && space < at) start = space + 1;
  }
  // Nor on a stray mark ("….); ./Allwmake"): a first word without a letter or digit in it is left out.
  while (start > 0) {
    const space = text.indexOf(" ", start);
    if (space === -1 || space >= at || /[\p{L}\p{N}]/u.test(text.slice(start, space))) break;
    start = space + 1;
  }
  let end = Math.min(text.length, start + LENGTH);
  const space = text.lastIndexOf(" ", end);
  if (end < text.length && space >= at + size) end = space;
  const cut = end < text.length;
  const piece = text.slice(start, end);
  return `${start > 0 ? "…" : ""}${cut ? piece.replace(/[.,;:]+$/, "") : piece}${cut ? "…" : ""}`; // not "place).…"
}

/** The sections that hold every word of the query where one of their own words starts (case, Markdown, quotes and
 *  curly apostrophes aside), and the Troubleshooting groups with a problem whose message the query holds (a line
 *  pasted from a log, with more around it than the doc quotes). Those groups come first, then the sections whose
 *  title holds all the words, then those where the words appear most; at most `limit`. */
export function searchDocs(query: string, limit = 8): SearchHit[] {
  const words = queryWords(query);
  if (!words.length) return [];
  const found: { entry: SearchEntry; pasted: boolean; inTitle: boolean; count: number }[] = [];
  for (const { entry, title, text, rows } of FIND) {
    const inTitle = words.map((w) => places(title, w).length);
    const counts = words.map((w, i) => (inTitle[i] ?? 0) + places(text, w).length);
    const pasted = rows.some((row) => holdsMessage(row, query));
    if (!pasted && !counts.every(Boolean)) continue;
    found.push({ entry, pasted, inTitle: inTitle.every(Boolean), count: counts.reduce((a, b) => a + b, 0) });
  }
  found.sort((a, b) =>
    Number(b.pasted) - Number(a.pasted) || Number(b.inTitle) - Number(a.inTitle) || b.count - a.count);
  return found.slice(0, limit).map(({ entry }) => ({ ...entry, snippet: snippet(entry.text, words) }));
}

/** Where a section found opens: at its heading. A Troubleshooting group opens searched for the same words too when
 *  one of its problems matches them there, so its page shows just those problems. */
export function hitTarget(hit: SearchEntry, query: string): { pathname: string; search: string; hash: string } {
  const q = query.trim();
  const group = hit.page === "/troubleshooting" ? GROUPS.find((g) => g.id === hit.id) : undefined;
  const search = group?.table.rows.some((row) => matches(row, q)) ? `?${new URLSearchParams({ q })}` : "";
  return { pathname: hit.page, search, hash: hit.id ? `#${hit.id}` : "" };
}
