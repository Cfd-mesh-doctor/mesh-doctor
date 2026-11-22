// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("dashboard tour: from the Docs page, the doc's sections, lists and five pictures, and nothing sent", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" || new URL(r.url()).origin !== "http://localhost:4173") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/docs");
  await page.getByRole("region", { name: "On this site" }).getByRole("link", { name: "Dashboard tour" }).click();
  await expect(page).toHaveURL(/\/dashboard-tour$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard tour" })).toBeVisible();
  await expect(page).toHaveTitle("Dashboard tour · Mesh Doctor");
  await expect(page.getByRole("heading", { level: 2, name: "Mesh Doctor: /meshdoctor" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Solver A/B test (same page, below the result)" })).toBeVisible();
  const tables = page.getByRole("listitem").filter({ hasText: /^When it finishes, the tables compare:/ });
  await expect(tables.getByRole("listitem")).toHaveCount(3);
  const pictures = page.getByRole("main").getByRole("img");
  await expect(pictures).toHaveCount(5);
  for (const img of await pictures.all()) {
    await img.scrollIntoViewIfNeeded();
    const width = Number(await img.getAttribute("width"));
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(width);
  }
  expect(sent).toEqual([]);
});

test("the gallery and How it works link to the site's dashboard tour", async ({ page }) => {
  await page.goto("/gallery");
  await page.getByRole("link", { name: "dashboard tour" }).click();
  await expect(page).toHaveURL(/\/dashboard-tour$/);
  await page.goto("/how-it-works");
  await page.getByRole("link", { name: "dashboard tour" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard tour" })).toBeVisible();
});
