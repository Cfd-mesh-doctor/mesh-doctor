// SPDX-License-Identifier: GPL-3.0-or-later
// A doc's sections, as the pages that show a whole doc lay them out (Limits, Safety model): a heading with GitHub's
// anchor, then its paragraphs and lists, with the doc's own `code`, **bold** and links (DocText).
import type { DocSection } from "@/lib/docSections";
import { DocText } from "./DocText";

export function DocSectionsView({ sections }: { sections: DocSection[] }) {
  return (
    <div className="max-w-3xl space-y-10">
      {sections.map((s) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-20">
          <h2 id={`${s.id}-title`} className="text-lg font-semibold tracking-tight">{s.title}</h2>
          <div className="mt-3 space-y-3 text-[15px] leading-relaxed">
            {s.blocks.map((b, i) => ("list" in b ? (
              <ul key={i} className="list-disc space-y-2 pl-5 marker:text-muted-foreground">
                {b.list.map((item) => <li key={item}><DocText text={item} /></li>)}
              </ul>
            ) : (
              <p key={i}><DocText text={b.text} /></p>
            )))}
          </div>
        </section>
      ))}
    </div>
  );
}
