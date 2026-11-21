// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("on a phone nothing scrolls sideways, and the menu works", async ({ page }) => {
  // The device's own width (412 px), then a small phone: the Jobs filter once fit the first and not the second.
  for (const width of [page.viewportSize()?.width ?? 412, 360]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ["/", "/connect", "/demo", "/demo/jobs", "/demo/cases", "/demo/settings"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} is wider than a ${width} px screen`).toBeLessThanOrEqual(1);
    }
  }
  await page.goto("/demo");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Jobs" }).click();
  await expect(page).toHaveURL(/\/demo\/jobs$/);
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("on a small phone, jobs show progress under the name and every filter can be reached", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/demo/jobs");
  const running = page.getByRole("row", { name: /ahmed25-medium-fix A\/B test/ });
  // No Progress column on a phone: the step shows once, under the name.
  await expect(running.getByText("solving fixed").filter({ visible: true })).toHaveCount(1);
  await page.getByRole("radio", { name: /Cancelled/ }).click(); // scrolled off to the right at first
  await expect(page.getByRole("row", { name: /ahmed25-fine-strict/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /pitzdaily-fix/ })).toHaveCount(0);
});
