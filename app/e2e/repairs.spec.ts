// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("the sidebar's Repairs opens every repair run, and a run its report", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("complementary").getByRole("link", { name: /^Repairs/ }).click();
  await expect(page).toHaveURL(/\/demo\/repairs$/);
  await expect(page.getByRole("heading", { name: "Repairs", level: 1 })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(7); // its head and the demo's six runs

  await page.getByRole("radiogroup", { name: "Show repair runs" }).getByRole("radio", { name: /^Worse/ }).click();
  await expect(page).toHaveURL(/\/demo\/repairs\?show=worse$/);
  await expect(page.getByRole("row")).toHaveCount(2);

  await page.getByRole("link", { name: "pitzdaily-fix", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/repairs\/pitzdaily-fix\/report$/);
  await expect(page.getByRole("heading", { name: "pitzdaily-fix", level: 1 })).toBeVisible();
});

test("a cancelled repair's run leads to its job's details", async ({ page }) => {
  await page.goto("/demo/repairs?show=unfinished");
  await page.getByRole("link", { name: "ahmed25-fine-strict", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/jobs\?job=20261121-130141-repair-ahmed25-fine-strict-0266$/);
  await expect(page.getByRole("dialog", { name: "ahmed25-fine-strict" })).toBeVisible();
});
