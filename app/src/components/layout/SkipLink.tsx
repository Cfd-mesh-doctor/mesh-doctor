// SPDX-License-Identifier: GPL-3.0-or-later
// "Skip to the content": the first thing Tab reaches on every page, so a keyboard needn't go through the whole header
// (or the app's sidebar) first. Out of sight until it has the focus.
import type { MouseEvent } from "react";

/** Moves the focus to the page's main landmark. The landmark can take the focus only until it loses it again (as
 *  GOV.UK's skip link does), so a later click inside it doesn't focus the whole of it. The address doesn't change,
 *  so a page's own "#..." (a section of the page, the pairing code) stays as it was. */
function skip(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  const main = document.querySelector("main");
  if (!main) return;
  if (!main.hasAttribute("tabindex")) {
    main.setAttribute("tabindex", "-1");
    main.addEventListener("blur", () => main.removeAttribute("tabindex"), { once: true });
  }
  main.focus();
}

export function SkipLink() {
  return (
    <a
      href="#main"
      onClick={skip}
      className="fixed -top-20 left-3 z-50 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-pop focus:top-3 print:hidden"
    >
      Skip to the content
    </a>
  );
}
