// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";
import { testReport } from "../src/report/testReport";

test("on a phone nothing scrolls sideways, and the menu works", async ({ page }) => {
  // The device's own width (412 px), then a small phone: the Jobs filter once fit the first and not the second.
  // Then the smallest phones (320 px), where the home and pairing pages were once 18-20 px too wide.
  for (const width of [page.viewportSize()?.width ?? 412, 360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of [
      "/", "/connect", "/install", "/report", "/estimate?cells=31.1", "/how-it-works", "/accuracy", "/gallery", "/demo",
      "/demo/jobs", "/demo/cases", "/demo/settings", "/demo/repairs/ahmed25-medium-fix/report",
      "/demo/repairs/ahmed35-medium-fix/report",
    ]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} is wider than a ${width} px screen`).toBeLessThanOrEqual(1);
    }
  }
  await page.goto("/demo");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Jobs" }).click();
  await expect(page).toHaveURL(/\/demo\/jobs$/);
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("on a small phone an open report fits the screen", async ({ page }) => {
  // Six A/B fields with long numbers, as a real k-omega run has: the table once widened the page. With a
  // repair map, whose canvas has to fit too.
  const report = testReport({ map: true }) as { documents: { abtest: Record<string, Record<string, unknown>> } };
  const ab = report.documents.abtest;
  for (const f of ["Uy", "Uz", "k", "omega"]) {
    (ab.residualRatioFixedOverBase as Record<string, number>)[f] = 1.0042;
    (ab.base!.residuals as Record<string, unknown>)[f] = { mean: 0.000467123 };
    (ab.fixed!.residuals as Record<string, unknown>)[f] = { mean: 0.000465871 };
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/report");
  await page.getByLabel("Choose a report file").setInputFiles({
    name: "ahmed25-fine-fix.mdreport.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(report)),
  });
  await expect(page.getByRole("heading", { name: "ahmed25-fine-fix" })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Side view of the model's wall faces/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the open report is wider than a 360 px screen").toBeLessThanOrEqual(1);
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

test("on a phone the public pages have a menu", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/report");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Size estimator" }).click();
  await expect(page).toHaveURL(/\/estimate$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Size estimator" })).toBeVisible();
  // A section of the home page, from another page: it opens scrolled to that section.
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/#privacy$/);
  await expect(page.getByRole("heading", { name: "Your meshes never leave your computer" })).toBeInViewport();
});
