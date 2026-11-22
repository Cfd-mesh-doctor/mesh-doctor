// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";
import { testReport } from "../src/report/testReport";
import { mockEngine, pairingLink } from "./engine";
import { lineBreaks } from "./text";

test.describe("in a browser that hasn't seen the tour", () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // the other tests start with the tour seen

  test("on a phone your app's note offering the tour says it stays in the menu, where the sidebar is", async ({ page }) => {
    await mockEngine(page);
    await page.goto(pairingLink());
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
    const note = page.getByRole("note", { name: "Tour" });
    await expect(note).toContainText("It stays in the menu for later.", { useInnerText: true });
    await expect(note).not.toContainText("sidebar", { useInnerText: true });
  });
});

test("on a phone nothing scrolls sideways, and the menu works", async ({ page }) => {
  test.slow(); // every page at three widths: more than the default 30 s
  // The device's own width (412 px), then a small phone: the Jobs filter once fit the first and not the second.
  // Then the smallest phones (320 px), where the home and pairing pages were once 18-20 px too wide.
  for (const width of [page.viewportSize()?.width ?? 412, 360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of [
      "/", "/connect", "/install", "/report", "/estimate?cells=31.1", "/how-it-works", "/accuracy", "/gallery", "/docs",
      "/troubleshooting", "/limits", "/safety", "/your-own-case", "/claude-code", "/dashboard-tour", "/architecture", "/demo", "/demo/jobs", "/demo/cases", "/demo/settings", "/demo/estimate?cells=31.1",
      "/demo/repairs/ahmed25-medium-fix/report", "/demo/repairs/ahmed35-medium-fix/report",
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

test("on a small phone a job's details fit the screen, scrolling inside rather than cut off", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 }); // the running A/B test's details were 759 px tall here
  await page.emulateMedia({ reducedMotion: "reduce" }); // no pop-in while measuring
  await page.goto("/demo/jobs?job=20261121-130610-abtest-ahmed25-medium-fix-13c2");
  const details = page.getByRole("dialog", { name: "ahmed25-medium-fix" });
  await expect(details).toBeVisible();
  const box = (await details.boundingBox())!;
  expect(box.y, "the title is above the screen").toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, "the buttons are below the screen").toBeLessThanOrEqual(667);
  await details.getByRole("button", { name: "Close", exact: true }).first().click(); // scrolled to, inside the dialog
  await expect(details).toBeHidden();
});

test("on a small phone a job's result path breaks after its slash, not inside a name", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 }); // it broke as "fix_ab/ab_result." / "json" here
  await page.goto("/demo/jobs?job=20261121-130610-abtest-ahmed25-medium-fix-13c2");
  const details = page.getByRole("dialog", { name: "ahmed25-medium-fix" });
  const result = details.locator("dt", { hasText: /^Result$/ }).locator("xpath=following-sibling::dd");
  await expect(result).toHaveText("ahmed25-medium-fix_ab/ab_result.json"); // the offered breaks add no text
  const breaks = await lineBreaks(result);
  expect(breaks).toContain("ahmed25-medium-fix_ab/");
  for (const before of breaks) expect(before, "the path breaks inside a name").toMatch(/[-/]$/);
});

test("on a small phone, a case's size and its estimate show under the name", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/demo/cases");
  const row = page.getByRole("row", { name: /pitzDaily/ });
  // No Cells column on a phone: the size shows once, under the name, with the link.
  await expect(row.getByText("12 k cells").filter({ visible: true })).toHaveCount(1);
  await row.getByRole("link", { name: "Size estimate for pitzDaily" }).click();
  await expect(page).toHaveURL(/\/demo\/estimate\?cells=0\.012225$/);
  await expect(page.getByLabel("Mesh size")).toHaveValue("0.012225");
});

test("on a phone the top bar and the case names each stay on one line", async ({ page }) => {
  // Under 400 px the demo's pill says just "Demo", so "Mesh Doctor" keeps its line down to 320 px.
  for (const [width, pill] of [[412, "Demo data"], [360, "Demo"], [320, "Demo"]] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/demo/cases");
    const header = page.locator("header").first();
    await expect(header.getByRole("link", { name: pill, exact: true })).toBeVisible();
    expect((await header.getByText("Mesh Doctor").boundingBox())?.height, `${width} px`).toBeLessThan(24);
    // The Report link sits under the verdict, so the names keep their room. (At 320 px the widest verdict,
    // "2 better, 1 worse", leaves too little and a long name breaks at a hyphen, as it always has there.)
    const row = page.getByRole("row", { name: /ahmed-25-medium/ });
    if (width >= 360) {
      expect((await row.getByText("ahmed-25-medium", { exact: true }).boundingBox())?.height, `${width} px`).toBeLessThan(26);
    }
    await expect(row.getByRole("link", { name: "Report of ahmed25-medium-fix" })).toBeVisible();
  }
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

test("on a phone the doc headings' copy-link buttons always show, as a touch screen can't point at a heading", async ({ page }) => {
  await page.goto("/architecture");
  const button = page.getByRole("button", { name: "Copy a link to “Jobs”" });
  await button.scrollIntoViewIfNeeded();
  await expect.poll(() => button.evaluate((b) => getComputedStyle(b).opacity)).toBe("1");
});

test("on a phone the menu's Take the tour closes the menu and opens the tour", async ({ page }) => {
  await page.goto("/demo/cases");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog", { name: "Navigation" }).getByRole("button", { name: "Take the tour" }).click();
  await expect(page.getByRole("dialog", { name: "Welcome to Mesh Doctor" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1); // the menu has gone
});

test("on a phone the tour brings the part it means into view, clear of the top bar and above the tour", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Take the tour" }).click();
  for (let i = 1; i < 5; i++) await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Reports: did the repair help?" })).toBeVisible();
  // A report's verdict is far down a phone's screen, below its five number tiles.
  const verdict = page.locator('[data-tour="verdict"]');
  await expect(verdict).toHaveAttribute("data-tour-spot", "");
  await expect(async () => {
    const part = await verdict.boundingBox();
    const tour = await page.getByRole("dialog").boundingBox();
    expect(part && tour && part.y >= 56 && part.y < tour.y).toBe(true);
  }).toPass({ timeout: 5000 });
});
