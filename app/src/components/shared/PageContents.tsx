// SPDX-License-Identifier: GPL-3.0-or-later
// A page's "On this page" list (How it works, and the pages that show a long doc): each section a link to its heading,
// and the one being read marked (aria-current), so a reader of a long page sees where they are.
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useSectionInView } from "@/lib/useSectionInView";
import { cn } from "@/lib/utils";

/** `numbered` puts each section's number before it (01, 02, ...), for steps read in order. */
export function PageContents({ sections, numbered = false }: {
  sections: readonly { id: string; title: ReactNode }[];
  numbered?: boolean;
}) {
  const current = useSectionInView(sections.map((s) => s.id));
  const List = numbered ? "ol" : "ul";
  return (
    <nav aria-label="On this page">
      <p className="px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">On this page</p>
      <List className="mt-2 grid gap-0.5 text-sm sm:grid-cols-2 lg:grid-cols-1">
        {sections.map((s, i) => {
          const here = s.id === current;
          return (
            <li key={s.id}>
              <Link
                to={`#${s.id}`}
                aria-current={here ? "location" : undefined}
                className={cn(
                  "flex gap-2 rounded-md px-2 py-1.5",
                  here ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                )}
              >
                {numbered && (
                  <span className={cn("font-mono text-xs leading-5", here && "text-primary")} aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                )}
                <span className="min-w-0">{s.title}</span>
              </Link>
            </li>
          );
        })}
      </List>
    </nav>
  );
}
