// SPDX-License-Identifier: GPL-3.0-or-later
// A doc's text, as the pages that show a whole doc lay it out (Limits, Safety model, Your own case): headings with
// GitHub's anchors, paragraphs and lists with the doc's own `code`, **bold** and links (DocText), and code blocks.
import { CopyCommand } from "@/components/shared/CopyCommand";
import type { DocBlock, DocSection } from "@/lib/docSections";
import { cn } from "@/lib/utils";
import { DocText } from "./DocText";

/** A fenced code block: a one-line shell command gets the site's copy box, anything else is shown as the doc has it. */
function DocCode({ code, lang, className }: { code: string; lang?: string; className?: string }) {
  if (lang === "bash" && !code.includes("\n")) return <CopyCommand command={code} className={className} />;
  return (
    <pre className={cn("overflow-x-auto rounded-lg border border-border bg-surface-2 px-3 py-2.5 font-mono text-[13px] leading-relaxed", className)}>
      <code>{code}</code>
    </pre>
  );
}

/** Paragraphs, lists and code blocks, in the doc's order. */
function DocBlocks({ blocks }: { blocks: DocBlock[] }) {
  return blocks.map((b, i) => {
    if ("code" in b) return <DocCode key={i} code={b.code} lang={b.lang} />;
    if ("text" in b) return <p key={i}><DocText text={b.text} /></p>;
    return (
      <ul key={i} className="list-disc space-y-2 pl-5 marker:text-muted-foreground">
        {b.list.map((item) => (typeof item === "string" ? (
          <li key={item}><DocText text={item} /></li>
        ) : (
          <li key={item.text}><DocText text={item.text} /><DocCode code={item.code} className="mt-2" /></li>
        )))}
      </ul>
    );
  });
}

export function DocSectionsView({ sections }: { sections: DocSection[] }) {
  return (
    <div className="max-w-3xl space-y-10">
      {sections.map((s) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-20">
          <h2 id={`${s.id}-title`} className="text-lg font-semibold tracking-tight">{s.title}</h2>
          <div className="mt-3 space-y-3 text-[15px] leading-relaxed">
            <DocBlocks blocks={s.blocks} />
          </div>
        </section>
      ))}
    </div>
  );
}
