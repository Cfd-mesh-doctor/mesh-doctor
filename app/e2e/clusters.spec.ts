// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

const FACE = /^(Face \d+ of cells? \d+( and \d+)?: badness [\d.]+, so it .+|A boundary face on the patch ahmed\.)$/;

test("the demo's 35° report shows a cluster in 3D: a click names a face, Next shows the next one", async ({ page }) => {
  await page.goto("/demo/repairs/ahmed35-medium-fix/report");
  await expect(page.getByRole("list", { name: "Clusters before the repair" }).getByRole("listitem")).toHaveCount(20);
  const opener = page.getByRole("button", { name: "View cluster 1 in 3D" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Cluster #1, before the repair" });
  const view = dialog.getByRole("img", { name: /^3D view of cluster #1: 24 faces of the cells around it \(3 failing\) and 69 boundary faces nearby\./ });
  await expect(view.locator("canvas")).toBeVisible();
  await expect(dialog.getByText("Click or tap a face for its numbers.")).toBeVisible();
  // The view starts on the cluster's middle, where its failing faces are: a click there lands on a face.
  const box = await view.boundingBox();
  if (!box) throw new Error("no 3D view");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(dialog.getByText(FACE)).toBeVisible();
  await dialog.getByRole("button", { name: "Zoom in" }).click();
  await dialog.getByRole("button", { name: "Back to the first view" }).click();

  await dialog.getByRole("button", { name: "Next" }).click();
  const next = page.getByRole("dialog", { name: "Cluster #2, before the repair" });
  await expect(next.getByRole("img", { name: /24 faces of the cells around it \(3 failing\) and 68 boundary faces/ }).locator("canvas")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("the demo says which clusters it recorded when one has no shapes", async ({ page }) => {
  await page.goto("/demo/repairs/ahmed35-medium-fix/report");
  await page.getByRole("button", { name: "View cluster 4 in 3D" }).click();
  await expect(page.getByRole("dialog", { name: "Cluster #4, before the repair" }))
    .toContainText("The demo recorded the shapes of three clusters only: #1 to #3 of ahmed35-medium-fix");
});

test("a report file lists its clusters without a 3D view: the shapes stay with the engine", async ({ page }) => {
  await page.goto("/report?sample=ahmed35-medium-fix");
  await expect(page.getByRole("list", { name: "Clusters before the repair" }).getByRole("listitem")).toHaveCount(20);
  await expect(page.getByRole("button", { name: /in 3D/ })).toHaveCount(0);
  await expect(page.getByText(/A report file holds this list but not the clusters' shapes/)).toBeVisible();
  await page.getByRole("button", { name: "Show 6 more of 26" }).click();
  await expect(page.getByRole("list", { name: "Clusters before the repair" }).getByRole("listitem")).toHaveCount(26);
});
