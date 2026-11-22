// SPDX-License-Identifier: GPL-3.0-or-later
// Troubleshooting: the problems of docs/troubleshooting.md (problems.ts, kept equal to the doc by a test), with a
// search box, as the doc says to search it for the message you see. What's typed stays in the address (?q=), so a
// link can open the page at one problem.
import { Fragment } from "react";
import { useSearchParams } from "react-router";
import { PublicFooter, PublicHeader } from "@/components/layout/PublicChrome";
import { PageHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/misc";
import { useTitle } from "@/lib/useTitle";
import { GROUPS } from "./problems";
import { matches } from "./search";

const TOTAL = GROUPS.reduce((n, g) => n + g.table.rows.length, 0);
/** The three columns from tablet width up; on a phone each problem reads top to bottom. */
const COLUMNS = "md:grid-cols-[minmax(0,5fr)_minmax(0,5fr)_minmax(0,6fr)] md:gap-6";

/** A cell as the doc writes it: `code` in backticks, **bold**. Short code stays on one line (a flag like -copyZero
 *  never splits at its hyphen); code longer than a narrow column may break anywhere, so a phone never scrolls sideways. */
function Md({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) => (i % 2 ? (
        <code key={i} className={part.length <= 24 ? "whitespace-nowrap" : "[overflow-wrap:anywhere]"}>{part}</code>
      ) : (
        <Fragment key={i}>{part.split("**").map((p, j) => (j % 2 ? <strong key={j} className="font-semibold">{p}</strong> : p))}</Fragment>
      )))}
    </>
  );
}

export function Troubleshooting() {
  useTitle("Troubleshooting");
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const setQuery = (q: string) => setParams(q ? { q } : {}, { replace: true, preventScrollReset: true });
  const shown = GROUPS.map((g) => ({ ...g, rows: g.table.rows.filter((r) => matches(r, query)) })).filter((g) => g.rows.length);
  const found = shown.reduce((n, g) => n + g.rows.length, 0);
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <PageHeader
          title="Troubleshooting"
          description="Problems people actually hit, with the fix. Search for the message you see, or a word from it."
        />
        <div role="search" className="max-w-xl">
          <label htmlFor="problem-search" className="text-sm font-medium">Search for the message you see</label>
          <Input
            id="problem-search"
            type="search"
            className="mt-1.5 [font-variant-ligatures:none]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="For example: Cannot find patchField entry"
            autoComplete="off"
            spellCheck={false}
          />
          <p aria-live="polite" className="mt-2 text-[13px] text-muted-foreground">
            {!query.trim()
              ? `${TOTAL} problems, in ${GROUPS.length} groups.`
              : found
                ? `${found} of ${TOTAL} problems ${found === 1 ? "matches" : "match"}.`
                : "No problem matches."}
          </p>
        </div>
        {found === 0 && (
          <Card className="mt-8 p-6 text-sm">
            <p className="font-medium">Nothing here matches “{query.trim()}”.</p>
            <p className="mt-1 text-muted-foreground">Try one distinctive word from the message, such as a file or utility name.</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => setQuery("")}>Show all problems</Button>
          </Card>
        )}
        <div className="mt-8 space-y-8">
          {shown.map((g) => (
            <section key={g.id} id={g.id} aria-labelledby={`${g.id}-title`} className="scroll-mt-20">
              <h2 id={`${g.id}-title`} className="text-lg font-semibold tracking-tight">{g.title}</h2>
              <Card className="mt-3 overflow-hidden">
                <div aria-hidden className={`hidden border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground md:grid ${COLUMNS}`}>
                  {g.table.head.map((h) => <span key={h}>{h}</span>)}
                </div>
                <ul className="divide-y divide-border">
                  {g.rows.map(([seen = "", why = "", fix = ""]) => (
                    <li key={seen} className={`grid gap-1 px-4 py-3 text-sm ${COLUMNS}`}>
                      <p className="font-medium"><span className="sr-only">{g.table.head[0]}: </span><Md text={seen} /></p>
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground md:sr-only">{g.table.head[1]}: </span><Md text={why} />
                      </p>
                      <p><span className="font-medium md:sr-only">{g.table.head[2]}: </span><Md text={fix} /></p>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
