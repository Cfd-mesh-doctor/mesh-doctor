// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("the demo's A/B tests: the sidebar opens the list, a finished test has its outcome, chart and judges", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("complementary").getByRole("link", { name: "A/B tests" }).click();
  await expect(page).toHaveURL(/\/demo\/abtests$/);
  await expect(page.getByRole("heading", { level: 1, name: "A/B tests" })).toBeVisible();
  const rows = page.getByRole("row");
  await expect(rows.nth(1)).toContainText("ahmed25-medium-fix");
  await expect(rows.nth(1)).toContainText("Running");
  await expect(rows.nth(2)).toContainText("1.00× about the same");

  await page.getByRole("link", { name: "Open the A/B test of ahmed25-coarse-fix" }).click();
  await expect(page).toHaveURL(/\/demo\/abtests\/ahmed25-coarse-fix$/);
  await expect(page.getByText("About the same on both meshes")).toBeVisible();
  await expect(page.getByRole("row", { name: /^p 0\.0127 0\.0127 1\.00×/ })).toBeVisible();
  const chart = page.getByRole("img", { name: /Initial residual of p per iteration/ });
  await expect(chart).toBeVisible();
  await page.getByRole("radio", { name: "omega" }).click();
  await expect(page.getByRole("img", { name: /Initial residual of omega per iteration/ })).toBeVisible();
  await expect(page.getByText("Is the original-mesh run converged?")).toBeVisible();
  await expect(page.getByText("Is the repaired-mesh run converged?")).toBeVisible();

  // Its repair's report, and back to this test from there.
  await page.getByRole("link", { name: "Repair report" }).click();
  await expect(page).toHaveURL(/\/demo\/repairs\/ahmed25-coarse-fix\/report$/);
  await page.getByRole("link", { name: "A/B test", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/abtests\/ahmed25-coarse-fix$/);
});

test("the demo's running A/B test shows its step, its progress and its first run, and says it has no live data", async ({ page }) => {
  await page.goto("/demo/abtests");
  await page.getByRole("link", { name: "Follow the A/B test of ahmed25-medium-fix" }).click();
  await expect(page.getByText("Solving on the repaired mesh")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await expect(page.getByText(/The demo recorded no live solver data/)).toBeVisible();
  await expect(page.getByRole("img", { name: /Initial residual of p per iteration/ })).toBeVisible();
  await expect(page.getByText("Did it help the solver?")).toHaveCount(0);
  // Cancelling its job on the Jobs screen shows here as cancelled (in the same visit: the demo forgets it on a reload).
  await page.getByRole("link", { name: "Job details" }).click();
  await expect(page).toHaveURL(/\/demo\/jobs\?job=/);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel job" }).click();
  await page.getByRole("dialog", { name: "Cancel ahmed25-medium-fix?" }).getByRole("button", { name: "Cancel job" }).click();
  await expect(page.getByRole("dialog", { name: "Cancel ahmed25-medium-fix?" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("complementary").getByRole("link", { name: "A/B tests" }).click();
  await page.getByRole("link", { name: "Open the A/B test of ahmed25-medium-fix" }).click();
  await expect(page.getByRole("heading", { name: "Cancelled" })).toBeVisible();
  await expect(page.getByText(/Stopped by request/)).toBeVisible();
});
