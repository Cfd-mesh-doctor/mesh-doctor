// SPDX-License-Identifier: GPL-3.0-or-later
// Code in running text: a command, a setting or a file name.
import type { ReactNode } from "react";
import { attached } from "@/lib/attached";
import { cn } from "@/lib/utils";

/** Text with the commands, settings and file names it names (in backticks) as code, as the docs show them, each kept
 *  whole on a line where it fits (index.css): split over two lines ("meshdoctor pair", then "--new"), a command
 *  wouldn't read as one. */
export function TextWithCode({ text }: { text: string }) {
  // Split at a pair of backticks, keeping what they hold: that comes at the odd places. What's written against a
  // command with no space ("(", "),") stays on its line with it.
  const parts = text.split(/`([^`]+)`/);
  const out: ReactNode[] = [];
  let rest = parts[0] ?? "";
  for (let i = 1; i < parts.length; i += 2) {
    const near = attached(rest, parts[i + 1] ?? "");
    if (near.before) out.push(near.before);
    out.push(<InlineCode key={i} text={parts[i] ?? ""} lead={near.lead} trail={near.trail} />);
    rest = near.after;
  }
  if (rest) out.push(rest);
  return <>{out}</>;
}

/** Code in running text, with what's written against it with no space ("(" before it, ")," after it; see attached).
 *  index.css keeps the code whole on a line where it fits, as a box (code-box), and a browser may break a line on
 *  either side of a box, even next to a bracket: what's written against the code goes in the box with it, so it isn't
 *  left behind at a line's end. */
export function InlineCode({ text, lead = "", trail = "", className }: {
  text: string; lead?: string; trail?: string; /** for the code itself, not what's written against it */ className?: string;
}) {
  if (!lead && !trail) return <code className={cn("code-box", className)}>{text}</code>;
  return <span className="code-box">{lead}<code className={className}>{text}</code>{trail}</span>;
}
