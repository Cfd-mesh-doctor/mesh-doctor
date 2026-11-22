// SPDX-License-Identifier: GPL-3.0-or-later
// Accessibility basics on every page, with no extra library: the page's language, one top heading, one main
// landmark, a name on every control and picture the accessibility tree shows (read from Playwright's ARIA snapshot,
// the browser's own tree), and ids used once.
import { expect, test, type Page } from "@playwright/test";

const PAGES = [
  "/", "/connect", "/install", "/report", "/report?sample=ahmed35-medium-fix", "/estimate", "/how-it-works",
  "/accuracy", "/gallery", "/docs", "/troubleshooting", "/limits", "/safety", "/your-own-case", "/nowhere",
  "/demo", "/demo/cases", "/demo/jobs", "/demo/settings", "/demo/estimate", "/demo/repairs/ahmed35-medium-fix/report",
  "/demo/nowhere",
];

/** A line of the ARIA snapshot for a control or picture with no name: `- button`, `- img`, `- link [disabled]:`. */
const UNNAMED = /^\s*- (button|link|textbox|searchbox|combobox|checkbox|radio|switch|slider|spinbutton|listbox|option|tab|menuitem|img)(?: \[[^\]]*\])*:?$/;

async function problems(page: Page): Promise<string[]> {
  const dom = await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    return {
      lang: document.documentElement.lang,
      h1: document.querySelectorAll("h1").length,
      main: document.querySelectorAll("main, [role=main]").length,
      repeated: [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))],
    };
  });
  const out: string[] = [];
  if (!dom.lang) out.push("no language on <html>");
  if (dom.h1 !== 1) out.push(`${dom.h1} h1 headings`);
  if (dom.main !== 1) out.push(`${dom.main} main landmarks`);
  for (const id of dom.repeated) out.push(`id "${id}" used more than once`);
  const tree = await page.locator("body").ariaSnapshot();
  for (const line of tree.split("\n")) if (UNNAMED.test(line)) out.push(`no name: ${line.trim()}`);
  return out;
}

test("every page has a language, one top heading, one main landmark, named controls and pictures, and unique ids", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const found: string[] = [];
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.locator("h1, main").first().waitFor();
    for (const p of await problems(page)) found.push(`${path}: ${p}`);
  }
  expect(found).toEqual([]);
});

test("the sweep finds what it looks for", async ({ page }) => {
  await page.goto("/docs");
  await page.waitForLoadState("networkidle");
  await page.locator("h1").first().waitFor();
  await page.evaluate(() => {
    document.documentElement.removeAttribute("lang");
    const main = document.querySelector("main")!;
    const add = (tag: string, props: Record<string, string> = {}) => main.appendChild(Object.assign(document.createElement(tag), props));
    add("h1", { textContent: "Second" });
    add("button").appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg")).setAttribute("aria-hidden", "true");
    add("img", { src: "/favicon.svg" });
    add("a", { href: "/docs" });
    add("span", { id: "twice" });
    add("span", { id: "twice" });
  });
  const found = await problems(page);
  expect(found).toContain("no language on <html>");
  expect(found).toContain("2 h1 headings");
  expect(found).toContain('id "twice" used more than once');
  for (const role of ["button", "img", "link"]) expect(found.filter((p) => p.startsWith(`no name: - ${role}`)), role).toHaveLength(1);
  expect(found).toHaveLength(6);
});
