// SPDX-License-Identifier: GPL-3.0-or-later
// A doc's text, as the pages that show a whole doc lay it out (Limits, Safety model, Your own case, Claude Code,
// Dashboard tour): headings with GitHub's anchors, paragraphs and lists with the doc's own `code`, **bold** and links
// (DocText), code blocks, and pictures.
import { CopyCommand } from "@/components/shared/CopyCommand";
import { githubAnchor, type DocBlock, type DocItem, type DocPictures, type DocSection } from "@/lib/docSections";
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

/** A picture as the gallery shows one: its own size or the column's width, whichever is smaller, opening full size
 *  when clicked, with the doc's alt text under it. */
function DocPicture({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) {
  return (
    <figure className="py-1">
      <a href={src} target="_blank" rel="noreferrer" className="block w-fit max-w-full overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" className="block h-auto max-w-full" />
      </a>
      <figcaption aria-hidden className="mt-2 text-[13px] text-muted-foreground">{alt}</figcaption>
    </figure>
  );
}

/** A list item, with the code block or the list the doc writes under it. */
function DocListItem({ item }: { item: DocItem }) {
  if (typeof item === "string") return <li><DocText text={item} /></li>;
  if ("code" in item) return <li><DocText text={item.text} /><DocCode code={item.code} className="mt-2" /></li>;
  return (
    <li>
      <DocText text={item.text} />
      <ul className="mt-1.5 list-[circle] space-y-1 pl-5 marker:text-muted-foreground">
        {item.list.map((sub) => <li key={sub}><DocText text={sub} /></li>)}
      </ul>
    </li>
  );
}

/** Paragraphs, lists, code blocks, sub-headings and pictures, in the doc's order. */
function DocBlocks({ blocks, pictures }: { blocks: DocBlock[]; pictures: DocPictures }) {
  return blocks.map((b, i) => {
    if ("code" in b) return <DocCode key={i} code={b.code} lang={b.lang} />;
    if ("text" in b) return <p key={i}><DocText text={b.text} /></p>;
    if ("heading" in b) {
      return (
        <h3 key={i} id={githubAnchor(b.heading)} className="scroll-mt-20 pt-3 text-base font-semibold tracking-tight">
          <DocText text={b.heading} />
        </h3>
      );
    }
    if ("picture" in b) {
      const p = pictures[b.picture];
      return p ? <DocPicture key={i} alt={b.alt} {...p} /> : null;
    }
    const List = b.numbered ? "ol" : "ul";
    return (
      <List key={i} className={cn("space-y-2 pl-5 marker:text-muted-foreground", b.numbered ? "list-decimal" : "list-disc")}>
        {b.list.map((item) => <DocListItem key={typeof item === "string" ? item : item.text} item={item} />)}
      </List>
    );
  });
}

/** The doc's sections; `pictures` holds the built files for the pictures the doc shows. */
export function DocSectionsView({ sections, pictures = {} }: { sections: DocSection[]; pictures?: DocPictures }) {
  return (
    <div className="max-w-3xl space-y-10">
      {sections.map((s) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-20">
          <h2 id={`${s.id}-title`} className="text-lg font-semibold tracking-tight"><DocText text={s.title} /></h2>
          <div className="mt-3 space-y-3 text-[15px] leading-relaxed">
            <DocBlocks blocks={s.blocks} pictures={pictures} />
          </div>
        </section>
      ))}
    </div>
  );
}
