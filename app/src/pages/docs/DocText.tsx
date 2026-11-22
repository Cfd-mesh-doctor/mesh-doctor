// SPDX-License-Identifier: GPL-3.0-or-later
// Text as the docs write it, for the pages that show a doc: `code`, **bold** (which may hold code) and [links](file.md).
// A link to another doc opens this site's page for it when there is one, otherwise the doc on GitHub (docHref).
import type { ReactNode } from "react";
import { Link } from "react-router";
import { docHref } from "./entries";

const TOKEN = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
const link = "font-medium text-primary underline-offset-4 hover:underline";

/** Short code stays on one line (a flag like -copyZero never splits at its hyphen); code longer than a narrow column
 *  may break anywhere, so a phone never scrolls sideways. */
function Code({ text }: { text: string }) {
  return <code className={text.length <= 24 ? "whitespace-nowrap" : "[overflow-wrap:anywhere]"}>{text}</code>;
}

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
    const [whole, code, bold, label, target] = m;
    if (m.index > at) out.push(text.slice(at, m.index));
    if (code != null) out.push(<Code key={m.index} text={code} />);
    else if (bold != null) out.push(<strong key={m.index} className="font-semibold"><DocText text={bold} /></strong>);
    else out.push(<DocLink key={m.index} target={target ?? ""}><DocText text={label ?? ""} /></DocLink>);
    at = m.index + whole.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}
