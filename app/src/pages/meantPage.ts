// SPDX-License-Identifier: GPL-3.0-or-later
// The page an address that leads nowhere most likely meant, for the not-found page: a page's address typed a little
// wrong ("/instal", "/galery"), cut short ("/trouble") or run on ("/installation"), a page's name ("/size-estimator"),
// or a doc's file name from the repository ("/docs/validation.md" is the Accuracy check). NotFound.tsx loads this only
// when a page isn't found, so the home page doesn't carry it.
import { ON_SITE } from "./docs/entries";

export interface Meant {
  page: string;
  title: string;
}

/** A name as a piece of an address: "Accuracy check" → "accuracy-check", "Validation.md" → "validation". */
const slug = (s: string) =>
  s.toLowerCase().replace(/\.(md|html?)$/, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

/** Every page an address can mean: the doc pages and the two tools, then the Docs page, the demo and Connect. */
const PAGES: { page: string; title: string; file?: string }[] = [
  ...ON_SITE.flatMap((d) => (d.page ? [{ page: d.page, title: d.title, file: d.file }] : [])),
  { page: "/docs", title: "Docs" },
  { page: "/demo", title: "Demo" },
  { page: "/connect", title: "Connect" },
];

/** Each page with the names it goes by: its address, its title and its doc's file. */
const PLACES = PAGES.map((p) => ({
  page: p.page,
  title: p.title,
  names: [...new Set([p.page, p.title, p.file ?? ""].map(slug))].filter(Boolean),
}));

/** How many letters to add, drop, change or swap to turn one word into the other. */
function distance(a: string, b: string): number {
  let before: number[] = [];
  let last = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(last[j]! + 1, row[j - 1]! + 1, last[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, before[j - 2]! + 1);
      row.push(d);
    }
    [before, last] = [last, row];
  }
  return last[b.length]!;
}

/** How near a piece of an address is to a page's name, lower being nearer: 0 the same, 1 when one starts the other
 *  (three letters at least), else 1 + the letters apart when that's few for the name's length; undefined if far. */
function nearness(piece: string, name: string): number | undefined {
  if (piece === name) return 0;
  if ((piece.length >= 3 && name.startsWith(piece)) || (name.length >= 4 && piece.startsWith(name))) return 1;
  const apart = distance(piece, name);
  return apart <= (name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3) ? 1 + apart : undefined;
}

/** The page the address most likely meant, or undefined when none is near. The last piece of the address that's near
 *  a page decides, so "/docs/install" means Install and "/how-it-works/detect" How it works. */
export function meantPage(pathname: string): Meant | undefined {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // a broken %-escape: read the address as typed
  }
  for (const piece of path.split("/").map(slug).filter(Boolean).reverse()) {
    let best: { score: number; page: string; title: string } | undefined;
    for (const place of PLACES)
      for (const name of place.names) {
        const score = nearness(piece, name);
        if (score !== undefined && (!best || score < best.score)) best = { score, page: place.page, title: place.title };
      }
    if (best) return { page: best.page, title: best.title };
  }
  return undefined;
}
