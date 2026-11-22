// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("the accuracy check: from the footer, its chart reads out each case, and nothing is sent", async ({ page }) => {
  const sent: string[] = [];
  const origins = new Set<string>();
  page.on("request", (r) => {
    origins.add(new URL(r.url()).origin);
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Accuracy check" }).click();
  await expect(page).toHaveURL(/\/accuracy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Accuracy check" })).toBeVisible();
  await expect(page).toHaveTitle("Accuracy check · Mesh Doctor");

  // Each dot sits at its Cd: the 35° run (0.408) far right of the 25° ones (0.280 to 0.299).
  await expect(page.getByRole("img", { name: /^Drag coefficient of each case/ })).toBeVisible();
  const dots = await page.locator("svg[role=img] circle").evaluateAll((cs) => cs.map((c) => Number(c.getAttribute("cx"))));
  expect(dots).toHaveLength(4);
  const [coarse = 0, medium = 0, fine = 0, steep = 0] = dots;
  expect(medium).toBeCloseTo(fine, 5);
  expect(coarse).toBeGreaterThan(medium);
  expect(steep - coarse).toBeGreaterThan(5 * (coarse - medium));

  await page.locator('[data-row="3"]').hover();
  await expect(page.getByText(/Steady RANS keeps the flow on the slant here/)).toBeVisible();
  await page.locator('[data-row="1"]').hover();
  await expect(page.getByText(/Cd 0\.280 against 0\.285 in the wind tunnel, −1\.7 %/)).toBeVisible();
  await expect(page.getByRole("table", { name: "Results of the accuracy check" }).getByRole("row")).toHaveCount(5);
  expect([...origins]).toEqual(["http://localhost:4173"]);
  expect(sent).toEqual([]);
});
