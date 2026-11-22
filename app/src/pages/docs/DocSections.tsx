// SPDX-License-Identifier: GPL-3.0-or-later
// A doc's text, as the pages that show a whole doc lay it out (Limits, Safety model, Your own case, Claude Code,
// Dashboard tour, Architecture): headings with GitHub's anchors, paragraphs, lists and tables with the doc's own
// `code`, **bold** and links (DocText), code blocks, and pictures; an "On this page" list for a long doc, and the line
// saying which doc the page follows.
import { CopyCommand } from "@/components/shared/CopyCommand";
import { PageContents } from "@/components/shared/PageContents";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { githubAnchor, type DocBlock, type DocItem, type DocPictures, type DocSection } from "@/lib/docSections";
import type { DocTable } from "@/lib/docTable";
import { cn } from "@/lib/utils";
import { DocSource } from "./DocSource";
import { DocText } from "./DocText";
import { HeadingLink } from "./HeadingLink";

/** A table as the doc writes it, its first column the row's name; it scrolls sideways on its own when too wide. */
function DocTableBlock({ table }: { table: DocTable }) {
  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">{table.head.map((h, i) => <TH key={i}><DocText text={h} /></TH>)}</TR>
      </THead>
      <TBody>
        {table.rows.map((row, r) => (
          <TR key={r}>
            {row.map((cell, i) => (
              <TD key={i} className={i === 0 ? "align-top font-medium" : "align-top"}><DocText text={cell} /></TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

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
      {item.after && <p className="mt-2"><DocText text={item.after} /></p>}
    </li>
  );
}

/** Paragraphs, lists, code blocks, sub-headings and pictures, in the doc's order. */
function DocBlocks({ blocks, pictures }: { blocks: DocBlock[]; pictures: DocPictures }) {
  return blocks.map((b, i) => {
    if ("code" in b) return <DocCode key={i} code={b.code} lang={b.lang} />;
    if ("text" in b) return <p key={i}><DocText text={b.text} /></p>;
    if ("table" in b) return <DocTableBlock key={i} table={b.table} />;
    if ("heading" in b) {
      const id = githubAnchor(b.heading);
      return (
        <div key={i} className="group flex items-start gap-1.5 pt-3">
          <h3 id={id} className="scroll-mt-20 text-base font-semibold tracking-tight"><DocText text={b.heading} /></h3>
          <HeadingLink id={id} title={b.heading} />
        </div>
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

/** From this many sections a doc gets an "On this page" list, as How it works has (each doc page now has 5 to 10). */
export const CONTENTS_FROM = 4;

/** The doc's sections, then the line saying which doc they follow (`source`, its file in docs/); `pictures` holds the
 *  built files for the pictures the doc shows. A long doc gets its "On this page" list beside it on a wide screen,
 *  staying in view, and above it on a phone; the list isn't printed. */
export function DocSectionsView({ sections, pictures = {}, source }: {
  sections: DocSection[];
  pictures?: DocPictures;
  source?: string;
}) {
  const doc = (
    <div className="max-w-3xl min-w-0">
      <div className="space-y-10">
        {sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-20">
            <div className="group flex items-start gap-1.5">
              <h2 id={`${s.id}-title`} className="text-lg font-semibold tracking-tight"><DocText text={s.title} /></h2>
              <HeadingLink id={s.id} title={s.title} />
            </div>
            <div className="mt-3 space-y-3 text-[15px] leading-relaxed">
              <DocBlocks blocks={s.blocks} pictures={pictures} />
            </div>
          </section>
        ))}
      </div>
      {source && <DocSource file={source} />}
    </div>
  );
  if (sections.length < CONTENTS_FROM) return doc;
  // grid-cols-1, not the default: a wide table then scrolls inside the doc's column instead of widening the page
  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
      <aside className="rounded-xl border border-border bg-surface p-3 shadow-card lg:sticky lg:top-24 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none print:hidden">
        <PageContents sections={sections.map((s) => ({ id: s.id, title: <DocText text={s.title} /> }))} />
      </aside>
      {doc}
    </div>
  );
}
