// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("the Jobs screen keeps its filter in the address: a reload keeps it", async ({ page }) => {
  await page.goto("/demo/jobs");
  const filter = page.getByRole("radiogroup", { name: "Show jobs" });
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows).toHaveCount(9); // the head and the demo's eight jobs
  await filter.getByRole("radio", { name: /^Cancelled/ }).click();
  await expect(page).toHaveURL(/\/demo\/jobs\?show=cancelled$/);
  await expect(rows).toHaveCount(2);

  await page.reload();
  await expect(filter.getByRole("radio", { name: /^Cancelled/ })).toBeChecked();
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole("button", { name: "ahmed25-fine-strict" })).toBeVisible();
});

test("the Overview's running-jobs tile links to the running jobs", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("link", { name: "Show the running job" }).click();
  await expect(page).toHaveURL(/\/demo\/jobs\?show=active$/);
  await expect(page.getByRole("radiogroup", { name: "Show jobs" }).getByRole("radio", { name: /^Active/ })).toBeChecked();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2); // the head and the demo's running job
});
