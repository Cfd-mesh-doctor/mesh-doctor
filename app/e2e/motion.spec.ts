// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("with less motion asked for, nothing keeps moving: not the live dot, nor the running job's spinner", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demo/jobs");
  await expect(page.getByText("Live · every 3 s")).toBeVisible(); // a job runs: the dot pulses and the badge spins
  // Each animation is over at once rather than repeating every millisecond, which flickers at the screen's rate.
  const running = () => page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
  await expect.poll(running).toBe(0);
});

test("with motion allowed, the live dot and the spinner do move", async ({ page }) => {
  await page.goto("/demo/jobs");
  await expect(page.getByText("Live · every 3 s")).toBeVisible();
  const running = () => page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
  await expect.poll(running).toBeGreaterThanOrEqual(2);
});
