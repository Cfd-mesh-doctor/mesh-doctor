// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("on a phone the A/B tests list and a test fit the screen", async ({ page }) => {
  const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.goto("/demo/abtests");
  await expect(page.getByRole("link", { name: "ahmed25-coarse-fix" })).toBeVisible();
  await expect(page.getByText("1.00×").filter({ visible: true })).toHaveCount(1); // under the name, as the column is hidden
  await fits();
  await page.getByRole("link", { name: "ahmed25-coarse-fix" }).tap();
  await expect(page.getByText("About the same on both meshes")).toBeVisible();
  await expect(page.getByRole("img", { name: /Initial residual of p per iteration/ })).toBeVisible();
  await fits();
});
