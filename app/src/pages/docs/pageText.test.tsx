// SPDX-License-Identifier: GPL-3.0-or-later
// Writes, and then keeps, pageText.ts: the words of the pages written as pages of their own (How it works, Accuracy
// check and Install) as each page shows them, at its top and section by section, for the Docs page's search. The
// pages stay the only place their words are written. After changing one of them, rewrite the file with
//   npx vitest run -u src/pages/docs/pageText.test.tsx
// (this test fails until then, showing what changed).
import { cleanup } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { Accuracy } from "@/pages/accuracy/Accuracy";
import { HowItWorks } from "@/pages/how/HowItWorks";
import { Install } from "@/pages/install/Install";
import { renderScreen } from "@/test/render";
import { ON_SITE } from "./entries";
import type { PageText } from "./pageText";

const PAGES: [page: string, element: ReactElement][] = [
  ["/how-it-works", <HowItWorks />],
  ["/accuracy", <Accuracy />],
  ["/install", <Install />],
];

/** Elements that read as blocks of their own, so the words either side of one don't run together. */
const BLOCKS = new Set(["P", "LI", "DT", "DD", "DIV", "H3", "FIGCAPTION", "TH", "TD", "PRE"]);

/** What isn't read: buttons (copy, heading links), drawings, what only a screen reader hears, and what is hidden from
 *  it (icons, step numbers, a command's prompt); the page's own name, and its list of sections. */
const UNREAD = "button, svg, .sr-only, [aria-hidden='true'], h1, aside, nav";

/** An element's words as the page shows them, in single spaces. */
function shown(root: Element, unread: string): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? "";
    if (!(node instanceof Element)) return;
    if (node.previousSibling instanceof Element) out += " "; // side by side with nothing between: buttons in a row
    if (node.matches(unread)) return;
    const block = BLOCKS.has(node.tagName);
    if (block) out += " ";
    node.childNodes.forEach(walk);
    if (block) out += " ";
  };
  root.childNodes.forEach(walk);
  return out.replace(/\s+/g, " ").trim();
}

/** The page as it renders now: its top (everything outside its sections), then each section named by its heading. */
function read(page: string): PageText[] {
  const main = document.querySelector("main");
  if (!main) throw new Error(`${page} has no main`);
  const title = ON_SITE.find((d) => d.page === page)?.title ?? page;
  const top = { page, id: "", title, text: shown(main, `${UNREAD}, section[id]`) };
  const sections = [...main.querySelectorAll("section[id][aria-labelledby]")].map((s) => {
    const heading = `[id='${s.getAttribute("aria-labelledby")}']`;
    const title = s.querySelector(heading);
    if (!title) throw new Error(`${page}#${s.id} has no heading`);
    return { page, id: s.id, title: shown(title, UNREAD), text: shown(s, `${UNREAD}, ${heading}`) };
  });
  return [top, ...sections];
}

/** pageText.ts as it should be. */
function source(entries: PageText[]): string {
  const items = entries.map((e) =>
    `  {\n    page: ${JSON.stringify(e.page)},\n    id: ${JSON.stringify(e.id)},\n    title: ${JSON.stringify(e.title)},\n` +
    `    text: ${JSON.stringify(e.text)},\n  },\n`);
  return [
    "// SPDX-License-Identifier: GPL-3.0-or-later\n",
    "// Written by pageText.test.tsx from the pages themselves: don't edit it by hand. The words of How it works,\n",
    "// Accuracy check and Install as each page shows them, at its top and section by section, for the Docs page's\n",
    "// search. After changing one of those pages: npx vitest run -u src/pages/docs/pageText.test.tsx\n\n",
    "/** A page's top (id \"\") or one of its sections, and its words in single spaces. */\n",
    "export interface PageText {\n  page: string;\n  id: string;\n  title: string;\n  text: string;\n}\n\n",
    "export const PAGE_TEXT: PageText[] = [\n",
    ...items,
    "];\n",
  ].join("");
}

describe("the words the Docs page's search reads for the pages written as pages of their own", () => {
  it("are the pages' own, as each shows them now (pageText.ts)", async () => {
    const entries: PageText[] = [];
    for (const [page, element] of PAGES) {
      renderScreen(element, { path: page });
      entries.push(...read(page));
      cleanup();
    }
    for (const e of entries) expect(e.text, `${e.page}#${e.id}`).not.toBe("");
    await expect(source(entries)).toMatchFileSnapshot("./pageText.ts");
  });
});
