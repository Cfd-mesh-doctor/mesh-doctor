// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("the app's size estimator fills in the engine's computer, and nothing is sent", async ({ page }) => {
  const sent: string[] = [];
  const origins = new Set<string>();
  page.on("request", (r) => {
    origins.add(new URL(r.url()).origin);
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/demo");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Size estimator" }).click();
  await expect(page).toHaveURL(/\/demo\/estimate$/);
  await expect(page).toHaveTitle("Size estimator · Mesh Doctor");
  await expect(page.getByText(/From the demo engine's computer: 25 GB of memory and 8 cores/)).toBeVisible();
  await expect(page.getByLabel("Memory for OpenFOAM")).toHaveValue("25");
  await expect(page.getByLabel("Solver ranks on this computer")).toHaveValue("8");

  // The full car: too big for this computer, and the address keeps it.
  await page.getByLabel("Mesh size").fill("31.1");
  await expect(page).toHaveURL(/\/demo\/estimate\?cells=31\.1$/);
  await expect(page.getByText("too big", { exact: true })).toHaveCount(4);
  await page.reload();
  await expect(page.getByLabel("Mesh size")).toHaveValue("31.1");
  await expect(page.getByLabel("Memory for OpenFOAM")).toHaveValue("25");
  expect([...origins]).toEqual(["http://localhost:4173"]);
  expect(sent).toEqual([]);
});

test("a case on the demo's Cases page opens the estimate for its mesh", async ({ page }) => {
  await page.goto("/demo/cases");
  const row = page.getByRole("row", { name: /ahmed-25-fine/ });
  await expect(row.getByText("1.57 M", { exact: true })).toBeVisible();
  await row.getByRole("link", { name: "Size estimate for ahmed-25-fine" }).click();
  await expect(page).toHaveURL(/\/demo\/estimate\?cells=1\.565115$/);
  await expect(page.getByLabel("Mesh size")).toHaveValue("1.565115");
  await expect(page.getByText(/^For 1,565,115 cells\./)).toBeVisible();
  // the rest is still the engine's computer
  await expect(page.getByLabel("Memory for OpenFOAM")).toHaveValue("25");
  await expect(page.getByLabel("Solver ranks on this computer")).toHaveValue("8");
});
