// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";
import { lineBreaks } from "./text";

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

test("an active job's details open on Close: Enter twice opens and closes them, cancelling nothing, and the focus goes back to the job", async ({ page }) => {
  await page.goto("/demo/jobs?show=active");
  const name = page.getByRole("button", { name: "ahmed25-medium-fix", exact: true });
  await name.focus();
  await page.keyboard.press("Enter");
  const details = page.getByRole("dialog", { name: "ahmed25-medium-fix" });
  await expect(details).toBeVisible();
  // The footer's Close comes before the corner's; both are named Close.
  await expect(details.getByRole("button", { name: "Close", exact: true }).first()).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(details).toBeHidden();
  await expect(page).toHaveURL(/\/demo\/jobs\?show=active$/);
  await expect(page.getByRole("dialog")).toHaveCount(0); // and no "Cancel ahmed25-medium-fix?"
  await expect(name).toBeFocused(); // back where it was
});

test("dismissing the cancel confirmation hands the focus back to the row's Cancel button", async ({ page }) => {
  await page.goto("/demo/jobs?show=active");
  const ask = page.getByRole("button", { name: "Cancel", exact: true });
  await ask.focus();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("dialog", { name: "Cancel ahmed25-medium-fix?" });
  await expect(confirm.getByRole("button", { name: "Keep running" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirm).toBeHidden();
  await expect(ask).toBeFocused();
});

test("a job's details wrap a long path at its hyphens or slashes, not inside a word", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/demo/jobs?job=20261121-130610-abtest-ahmed25-medium-fix-13c2"); // the running A/B test
  const details = page.getByRole("dialog", { name: "ahmed25-medium-fix" });
  let wrapped = 0;
  for (const label of [/^Log$/, /^Result$/]) {
    const value = details.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd");
    const breaks = await lineBreaks(value);
    for (const before of breaks) expect(before, `the ${label.source} breaks inside a word`).toMatch(/[-/]$/);
    wrapped += breaks.length;
  }
  expect(wrapped, "neither path wraps, so this tests nothing").toBeGreaterThan(0);
});

test("the Jobs table fits its card at every width, never scrolling its Cancel or Report out of sight", async ({ page }) => {
  await page.goto("/demo/jobs");
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(9); // the head and the demo's eight jobs
  // Each side of each breakpoint, where a column joins (Progress at 640, Duration at 768, Started at 1280) or the
  // sidebar takes its room (1024). At 640 and 1024 px the table was 25 and 37 px wider than its card.
  for (const width of [640, 700, 767, 768, 900, 1023, 1024, 1100, 1279, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const over = await table.evaluate((t) => t.parentElement!.scrollWidth - t.parentElement!.clientWidth);
    expect(over, `the table scrolls sideways in its card at ${width} px`).toBeLessThanOrEqual(0);
  }
});

test("a job's name keeps its line from 768 px up, as Progress takes a third of the table only from 1280", async ({ page }) => {
  await page.goto("/demo/jobs");
  const names = page.getByRole("table").locator("tbody td:first-child > button");
  await expect(names).toHaveCount(8); // the demo's eight jobs
  // At 768 and 1024 px Progress held a third of the table, more than its bar needs, and six names broke at a hyphen
  // ("ahmed25-" / "medium-fix"). (At 640 the longest names still take two lines: the card is too narrow there.)
  for (const width of [768, 900, 1023, 1024, 1100, 1279, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of await names.all()) {
      expect(await lineBreaks(name), `${await name.textContent()} at ${width} px`).toEqual([]);
    }
  }
});

test("the sidebar says how many jobs are active, not a bare number", async ({ page }) => {
  await page.goto("/demo");
  const main = page.getByRole("navigation", { name: "Main" });
  await expect(main.getByRole("link", { name: "Jobs (1 active)", exact: true })).toBeVisible();
});

test("the Overview's recent jobs open their details on the Jobs screen", async ({ page }) => {
  await page.goto("/demo");
  // Exact: the Repair runs card has "Details of ahmed25-fine-strict" too.
  await page.getByRole("link", { name: "ahmed25-fine-strict", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/jobs\?job=[\w-]*ahmed25-fine-strict[\w-]*$/);
  await expect(page.getByRole("dialog", { name: "ahmed25-fine-strict" })).toBeVisible();
});

test("the Overview's active-jobs tile links to the active jobs", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("link", { name: "Show the active job" }).click();
  await expect(page).toHaveURL(/\/demo\/jobs\?show=active$/);
  await expect(page.getByRole("radiogroup", { name: "Show jobs" }).getByRole("radio", { name: /^Active/ })).toBeChecked();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(2); // the head and the demo's running job
});
