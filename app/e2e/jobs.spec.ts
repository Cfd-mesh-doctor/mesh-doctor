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

test("a job's details stay open through a reload, and closing them keeps the filter", async ({ page }) => {
  await page.goto("/demo/jobs?show=cancelled");
  await page.getByRole("button", { name: "ahmed25-fine-strict" }).click();
  const details = page.getByRole("dialog", { name: "ahmed25-fine-strict" });
  await expect(details).toBeVisible();
  await expect(page).toHaveURL(/\/demo\/jobs\?show=cancelled&job=[\w-]*ahmed25-fine-strict[\w-]*$/);

  await page.reload();
  await expect(details).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await expect(page).toHaveURL(/\/demo\/jobs\?show=cancelled$/);
});

test("a job's details show its whole log and result paths, wrapping rather than cutting them off", async ({ page }) => {
  await page.goto("/demo/jobs");
  await page.getByRole("button", { name: "ahmed25-fine-strict" }).click();
  const details = page.getByRole("dialog", { name: "ahmed25-fine-strict" });
  for (const label of [/^Log$/, /^Result$/]) {
    const value = details.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd");
    await expect(value).toHaveText(/^ahmed25-fine-strict\S+$/);
    expect(await value.evaluate((dd) => dd.scrollWidth <= dd.clientWidth), `the ${label.source} is cut off`).toBe(true);
  }
});

test("the sidebar says how many jobs run, not a bare number", async ({ page }) => {
  await page.goto("/demo");
  const main = page.getByRole("navigation", { name: "Main" });
  await expect(main.getByRole("link", { name: "Jobs (1 running)", exact: true })).toBeVisible();
});

test("the Overview's recent jobs open their details on the Jobs screen", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("link", { name: "ahmed25-fine-strict" }).click();
  await expect(page).toHaveURL(/\/demo\/jobs\?job=[\w-]*ahmed25-fine-strict[\w-]*$/);
  await expect(page.getByRole("dialog", { name: "ahmed25-fine-strict" })).toBeVisible();
});

test("the Overview's running-jobs tile links to the running jobs", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("link", { name: "Show the running job" }).click();
  await expect(page).toHaveURL(/\/demo\/jobs\?show=active$/);
  await expect(page.getByRole("radiogroup", { name: "Show jobs" }).getByRole("radio", { name: /^Active/ })).toBeChecked();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2); // the head and the demo's running job
});
