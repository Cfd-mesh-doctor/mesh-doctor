// SPDX-License-Identifier: GPL-3.0-or-later
// Text as the docs write it, for the pages that show a doc: `code` (in double backticks when it holds a backtick),
// **bold** (which may hold code), *italics* and [links](file.md). A link to another doc opens this site's page for it
// when there is one, otherwise the doc on GitHub (docHref).
import type { ReactNode } from "react";
import { Link } from "react-router";
import { InlineCode } from "@/components/shared/InlineCode";
import { attached } from "@/lib/attached";
import { docHref } from "./entries";

// Italics start at a "*" with a letter after it and never reach into code, so the star of a glob in code
// (processor*, *.dat) or of "2 * 3" stays as it is.
const TOKEN = /``(.+?)``|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*`\s][^*`]*)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
const link = "font-medium text-primary underline-offset-4 hover:underline";

function DocLink({ target, children }: { target: string; children: ReactNode }) {
  const href = docHref(target);
  return href.startsWith("/")
    ? <Link to={href} className={link}>{children}</Link>
    : <a href={href} target="_blank" rel="noreferrer" className={link}>{children}</a>;
}

export function DocText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    const [whole, doubled, single, bold, italic, label, target] = m;
    const code = doubled?.trim() ?? single;
    let before = text.slice(at, m.index);
    at = m.index + whole.length;
    let node: ReactNode;
    if (code != null) {
      // What's written against the code with no space ("(" before it, ")," after it) stays on its line with it.
      const near = attached(before, text.slice(at));
      before = near.before;
      at += near.trail.length;
      node = <InlineCode key={m.index} text={code} lead={near.lead} trail={near.trail} />;
    } else if (bold != null) node = <strong key={m.index} className="font-semibold"><DocText text={bold} /></strong>;
    else if (italic != null) node = <em key={m.index}><DocText text={italic} /></em>;
    else node = <DocLink key={m.index} target={target ?? ""}><DocText text={label ?? ""} /></DocLink>;
    if (before) out.push(before);
    out.push(node);
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}
