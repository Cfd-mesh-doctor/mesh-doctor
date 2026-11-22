// SPDX-License-Identifier: GPL-3.0-or-later
// Limits: what Mesh Doctor is not, and where each part of it stops. The text is docs/limits.md's (sections.ts, kept
// equal to the doc by a test); each section has the anchor GitHub gives its heading.
import { PublicFooter, PublicHeader } from "@/components/layout/PublicChrome";
import { PageHeader } from "@/components/shared/page";
import { useTitle } from "@/lib/useTitle";
import { DocText } from "@/pages/docs/DocText";
import { LIMITS } from "./sections";

export function Limits() {
  useTitle("Limits");
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <PageHeader
          title="Limits"
          description="What Mesh Doctor is not, the versions it runs on, and where each part of it stops. Worth reading before you trust a result."
        />
        <div className="max-w-3xl space-y-10">
          {LIMITS.map((s) => (
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
      </main>
      <PublicFooter />
    </div>
  );
}
