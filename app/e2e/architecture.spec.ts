// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("architecture: from the Docs page, the doc's tables, numbered steps and code, and nothing sent", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" || new URL(r.url()).origin !== "http://localhost:4173") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/docs");
  await page.getByRole("region", { name: "On this site" }).getByRole("link", { name: "Architecture" }).click();
  await expect(page).toHaveURL(/\/architecture$/);
  await expect(page.getByRole("heading", { level: 1, name: "Architecture" })).toBeVisible();
  await expect(page).toHaveTitle("Architecture · Mesh Doctor");
  const main = page.getByRole("main");
  await expect(main.getByRole("table")).toHaveCount(6);
  // An escaped "|" in the doc's table stays in its cell.
  await expect(main.getByRole("cell", { name: "GET /repairs/{name}/clusters/{id}?tag=before|after|report" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Order of work" }).locator("ol > li")).toHaveCount(8);
  await expect(main.locator("code", { hasText: "MD.html`<b>${name}</b>`" })).toBeVisible();
  await expect(main.getByText(/^The command comes from the wrapper's own arguments/)).toBeVisible();
  // The foot of the page says which doc it follows, linked on GitHub.
  await expect(main.getByRole("link", { name: "docs/architecture.md" }))
    .toHaveAttribute("href", "https://github.com/Cfd-mesh-doctor/mesh-doctor/blob/main/docs/architecture.md");
  expect(sent).toEqual([]);
});

test("architecture: the On this page list goes to a section, stays in view beside the doc and marks the section read", async ({ page }) => {
  await page.goto("/architecture");
  const nav = page.getByRole("navigation", { name: "On this page" });
  await expect(nav.getByRole("link")).toHaveCount(10);
  await nav.getByRole("link", { name: "Order of work" }).click();
  await expect(page).toHaveURL(/\/architecture#order-of-work$/);
  await expect(page.getByRole("heading", { level: 2, name: "Order of work" })).toBeInViewport();
  await expect(nav).toBeInViewport();
  await expect(nav.getByRole("link", { name: "Order of work" })).toHaveAttribute("aria-current", "location");
  await nav.getByRole("link", { name: "Jobs" }).click();
  await expect(nav.getByRole("link", { name: "Jobs" })).toHaveAttribute("aria-current", "location");
  await expect(nav.locator("[aria-current]")).toHaveCount(1);
  // Above the first section, nothing is marked.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(nav.locator("[aria-current]")).toHaveCount(0);
});
