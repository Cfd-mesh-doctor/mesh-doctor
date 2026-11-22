// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("the size estimator works in the page and keeps the estimate in the address", async ({ page }) => {
  const sent: string[] = [];
  const origins = new Set<string>();
  page.on("request", (r) => {
    origins.add(new URL(r.url()).origin);
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Estimator" }).click();
  await expect(page.getByRole("heading", { name: "Size estimator" })).toBeVisible();
  await expect(page).toHaveTitle("Size estimator · Mesh Doctor");

  // Typing doesn't make the page jump, even when it is scrolled.
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.evaluate(() => window.scrollTo(0, 120));
  const cells = page.getByLabel("Mesh size");
  await cells.fill("31.1");
  await expect(page).toHaveURL(/\/estimate\?cells=31\.1$/);
  expect(await page.evaluate(() => window.scrollY)).toBe(120);
  await expect(page.getByText("too big", { exact: true })).toHaveCount(4);
  await expect(page.getByText("about 19.0 h, $16")).toBeVisible();

  // The link brings the same estimate back.
  await page.reload();
  await expect(page.getByLabel("Mesh size")).toHaveValue("31.1");
  await expect(page.getByText("about 19.0 h, $16")).toBeVisible();
  expect([...origins]).toEqual(["http://localhost:4173"]);
  expect(sent).toEqual([]);
});
