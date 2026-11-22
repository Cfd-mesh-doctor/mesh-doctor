// SPDX-License-Identifier: GPL-3.0-or-later
// Telling a screen reader something the page shows only as a picture or a changed label, such as a copy button's
// tick: a polite live region, out of sight, added to the page the first time it is needed. A label that changes
// under the focus isn't read by every screen reader (VoiceOver doesn't); a live region is.

/** How long after the region is added or emptied its words go in: words that arrive with it may not be read. */
export const ANNOUNCE_DELAY = 100;
/** How long the words stay, so a reader going through the page later doesn't come upon them. */
export const KEPT_FOR = 5000;

let region: HTMLElement | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Says `text` to a screen reader, even when it is the same words as last time. */
export function announce(text: string) {
  if (!region?.isConnected) {
    region = document.createElement("div");
    region.setAttribute("aria-live", "polite");
    region.className = "sr-only";
    document.body.append(region);
  }
  const r = region;
  clearTimeout(timer);
  r.textContent = "";
  timer = setTimeout(() => {
    r.textContent = text;
    timer = setTimeout(() => { r.textContent = ""; }, KEPT_FOR);
  }, ANNOUNCE_DELAY);
}
