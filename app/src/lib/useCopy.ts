// SPDX-License-Identifier: GPL-3.0-or-later
// Copying text from a button that then says "Copied" for a moment: the site's copy boxes and the doc headings' links.
import { useEffect, useState } from "react";

/** How long, in milliseconds, a button says it copied. */
export const COPIED_FOR = 1600;

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
    } catch {
      /* no clipboard access (insecure context or denied): the text can still be selected and copied by hand */
    }
  };
  return { copied, copy };
}
