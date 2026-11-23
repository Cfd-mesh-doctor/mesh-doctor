// SPDX-License-Identifier: GPL-3.0-or-later
// Code in running text: a command, a setting or a file name.
import { cn } from "@/lib/utils";

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
