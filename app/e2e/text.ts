// SPDX-License-Identifier: GPL-3.0-or-later
import type { Locator } from "@playwright/test";

/** The text before each line break in an element: where a character's top is lower than the one before it. */
export function lineBreaks(el: Locator): Promise<string[]> {
  return el.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const tops: number[] = [];
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const t = node as Text;
      for (let i = 0; i < t.length; i++) {
        range.setStart(t, i);
        range.setEnd(t, i + 1);
        tops.push(range.getBoundingClientRect().top);
      }
      text += t.data;
    }
    return tops.flatMap((top, i) => (top > (tops[i - 1] ?? Infinity) + 1 ? [text.slice(0, i)] : []));
  });
}
