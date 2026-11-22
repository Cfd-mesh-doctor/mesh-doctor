// SPDX-License-Identifier: GPL-3.0-or-later
// Moving the focus to something that can't otherwise take it: the page's main landmark (the skip link), or the first
// problem that matches a search (Troubleshooting's Enter).

/** Focuses `el`, which can take the focus only until it loses it again (as GOV.UK's skip link does), so a later click
 *  inside it doesn't focus the whole of it, and Tab never stops on it. */
export function focusOnce(el: HTMLElement, options?: FocusOptions) {
  if (!el.hasAttribute("tabindex")) {
    el.setAttribute("tabindex", "-1");
    el.addEventListener("blur", () => el.removeAttribute("tabindex"), { once: true });
  }
  el.focus(options);
}
