// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("on a phone a cluster's 3D view fits the screen, and a tap names a face", async ({ page }) => {
  await page.goto("/demo/repairs/ahmed35-medium-fix/report");
  await page.getByRole("button", { name: "View cluster 1 in 3D" }).click();
  const dialog = page.getByRole("dialog", { name: "Cluster #1, before the repair" });
  const view = dialog.getByRole("img", { name: /^3D view of cluster #1/ });
  await expect(view.locator("canvas")).toBeVisible();
  const width = page.viewportSize()?.width ?? 0;
  const box = await view.boundingBox();
  if (!box) throw new Error("no 3D view");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await view.tap({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(dialog.getByText(/^(Face \d+ of cells? |A boundary face on the patch ahmed\.)/)).toBeVisible();
});
