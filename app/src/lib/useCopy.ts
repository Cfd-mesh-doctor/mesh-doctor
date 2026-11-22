// SPDX-License-Identifier: GPL-3.0-or-later
// Copying text from a button that then says "Copied" for a moment: the site's copy boxes, the doc headings' links and
// the estimator's link. A screen reader hears it too, whether or not it reads the button's changed label.
import { useEffect, useState } from "react";
import { announce } from "./announce";

/** How long, in milliseconds, a button says it copied. */
export const COPIED_FOR = 1600;
/** What a screen reader hears once the text is copied. */
export const COPIED_SAID = "Copied to the clipboard";

export function useCopy() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_FOR);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      announce(COPIED_SAID);
    } catch {
      /* no clipboard access (insecure context or denied): the text can still be selected and copied by hand */
    }
  };
  return { copied, copy };
}
