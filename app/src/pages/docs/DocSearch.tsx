// SPDX-License-Identifier: GPL-3.0-or-later
// The Docs page's search: one box that finds a word, or a message from a log, in the doc pages at once, and lists
// the sections that hold it, each a link to its heading. What's typed stays in the address (?q=), as on
// Troubleshooting, so coming back from a section finds the same list. The texts (searchIndex.ts) load only when the
// box is used, so they don't weigh on the page.
import { Fragment, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/shared/SearchInput";
import { DocText } from "./DocText";

type SearchIndex = typeof import("./searchIndex");
const load = () => import("./searchIndex");

/** The most sections listed; past it, the list asks for another word. */
export const SHOWN = 8;

const link = "font-medium text-primary underline-offset-4 hover:underline";

/** A word as a regular expression, found as the search finds it: where one of the text's own words starts (unless it
 *  begins with a mark), its straight apostrophe matching a curly one too. */
const pattern = (word: string) =>
  (/^[\p{L}\p{N}]/u.test(word) ? "(?<![\\p{L}\\p{N}])" : "") +
  word.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&").replace(/'/g, "['\u2019]");

/** The piece of a section's text, each word typed marked in it. */
function Marked({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return text;
  const longest = [...words].sort((a, b) => b.length - a.length);
  return text.split(new RegExp(`(${longest.map(pattern).join("|")})`, "giu")).map((part, i) => (
    <Fragment key={i}>
      {i % 2 ? <mark className="rounded-sm bg-primary-soft px-0.5 text-foreground">{part}</mark> : part}
    </Fragment>
  ));
}

/** "A, B and C" */
const listed = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

export function DocSearch() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const setQuery = (q: string) => setParams(q ? { q } : {}, { replace: true, preventScrollReset: true });
  const asked = query.trim() !== "";
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!asked || index) return;
    let live = true;
    load().then(
      (m) => { if (live) setIndex(m); },
      () => { if (live) setFailed(true); },
    );
    return () => { live = false; };
  }, [asked, index]);

  const ready = asked && index ? index : null;
  const hits = ready ? ready.searchDocs(query, Number.POSITIVE_INFINITY) : [];
  const words = ready ? ready.queryWords(query) : [];
  const status = !asked ? ""
    : ready ? (hits.length ? `${hits.length} ${hits.length === 1 ? "match" : "matches"}.` : "Nothing matches.")
      : failed ? "The search couldn't load. Reload the page to try again." : "Searching…";

  return (
    <>
      <div role="search" className="max-w-xl">
        <label htmlFor="doc-search" className="text-sm font-medium">Search all the docs</label>
        <SearchInput
          id="doc-search"
          className="mt-1.5"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => void load().catch(() => undefined)}
          placeholder="A word, or a message from a log"
          autoComplete="off"
          spellCheck={false}
        />
        <p aria-live="polite" className="mt-2 text-[13px] text-muted-foreground">{status}</p>
      </div>
      {ready && hits.length > 0 && (
        <section aria-label="Search results" className="mt-4 max-w-3xl">
          <Card>
            <ol className="divide-y divide-border">
              {hits.slice(0, SHOWN).map((h) => (
                <li key={`${h.page}#${h.id}`} className="px-4 py-3">
                  <p className="text-xs text-muted-foreground">{h.id ? h.pageTitle : "Page"}</p>
                  <Link to={ready.hitTarget(h, query)} className={link}><DocText text={h.title} /></Link>
                  <p className="mt-1 text-sm text-muted-foreground"><Marked text={h.snippet} words={words} /></p>
                </li>
              ))}
            </ol>
          </Card>
          {hits.length > SHOWN && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              The first {SHOWN} of {hits.length}. Add a word to find fewer.
            </p>
          )}
        </section>
      )}
      {ready && hits.length === 0 && (
        <Card className="mt-4 max-w-3xl p-6 text-sm">
          <p className="font-medium">Nothing in the docs holds “{query.trim()}”.</p>
          <p className="mt-1 text-muted-foreground">
            Try one distinctive word, such as a file or utility name. The search reads every page listed below
            {ready.SUMMED.length
              ? ` except ${listed(ready.SUMMED)}, which it finds by what this page says about ${ready.SUMMED.length > 1 ? "them" : "it"}.`
              : "."}
          </p>
        </Card>
      )}
    </>
  );
}
