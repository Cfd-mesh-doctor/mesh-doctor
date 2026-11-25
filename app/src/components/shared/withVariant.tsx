// SPDX-License-Identifier: GPL-3.0-or-later
// A solver-settings variant's name in running text, in the mono font as field names are: the app's font draws a
// lowercase l as it draws a capital I, so the variant lts read as "Its" ("The Its settings helped the solver"). The
// font's l with a tail (Inter's cv05) isn't in the build the app bundles.
import type { ReactNode } from "react";
import { InlineCode } from "@/components/shared/InlineCode";

/** `text`, with each `variant` in it that stands as a word of its own in the mono font; not one inside a longer name
 * (wing_lts), which is a name of its own. Without a variant, the text as it is. */
export function withVariant(text: string, variant: string | null | undefined): ReactNode {
  if (!variant) return text;
  const name = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Split at the name, kept: the parts at odd places are the name itself.
  const parts = text.split(new RegExp(`(?<![\\w-])(${name})(?![\\w-])`));
  if (parts.length === 1) return text;
  return <>{parts.map((part, i) => (i % 2 ? <InlineCode key={i} text={part} /> : part))}</>;
}
