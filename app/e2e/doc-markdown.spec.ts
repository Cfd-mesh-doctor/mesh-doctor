// SPDX-License-Identifier: GPL-3.0-or-later
// The pages that show a doc must show it, not its Markdown: no table rows, headings or numbered steps left as text,
// and no "**", "``" or "![" outside code. (The Claude Code page showed its tables as "|" lines from pass 48 to 53.)
import { expect, test, type Page } from "@playwright/test";

const DOC_PAGES = [
  "/how-it-works", "/accuracy", "/gallery", "/install", "/dashboard-tour", "/your-own-case", "/claude-code",
  "/troubleshooting", "/limits", "/safety", "/architecture",
];

/** The text of the page's paragraphs, list items, cells, headings and captions that still looks like Markdown. */
async function leftovers(page: Page): Promise<string[]> {
  return page.getByRole("main").evaluate((main) => {
    const found: string[] = [];
    for (const el of main.querySelectorAll("p, li, td, th, h1, h2, h3, h4, figcaption")) {
      if (el.closest("pre")) continue;
      const text = (el.textContent ?? "").trim();
      const prose = el.cloneNode(true) as Element;
      prose.querySelectorAll("code").forEach((c) => c.remove());
      const raw = /^(\||#{1,6} )/.test(text) || (el.tagName === "P" && /^\d+\. /.test(text))
        || /\*\*|``|!\[/.test(prose.textContent ?? "");
      if (raw) found.push(text.slice(0, 60));
    }
    return found;
  });
}

test("the doc pages show no Markdown left as text", async ({ page }) => {
  test.setTimeout(60_000);
  const found: string[] = [];
  for (const path of DOC_PAGES) {
    await page.goto(path);
    await page.locator("h1").first().waitFor();
    for (const text of await leftovers(page)) found.push(`${path}: ${text}`);
  }
  expect(found).toEqual([]);
});

test("the sweep finds each kind of Markdown left as text", async ({ page }) => {
  await page.goto("/limits");
  await page.locator("h1").first().waitFor();
  const planted = ["| A | B |", "## A heading", "1. one 2. two", "Some **bold**", "A ``code`` span", "![A picture](x.png)"];
  await page.getByRole("main").evaluate((main, texts) => {
    for (const text of texts) main.appendChild(Object.assign(document.createElement("p"), { textContent: text }));
  }, planted);
  expect(await leftovers(page)).toEqual(planted);
});
