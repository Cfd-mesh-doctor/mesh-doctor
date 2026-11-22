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
  expect(sent).toEqual([]);
});
