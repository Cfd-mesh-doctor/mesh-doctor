// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test, type Page } from "@playwright/test";

/** How dark a text colour is: 0 for black, 1 for white (the mean of its red, green and blue). */
async function lightness(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const c = document.createElement("canvas").getContext("2d")!;
    c.fillStyle = getComputedStyle(el).color;
    c.fillRect(0, 0, 1, 1);
    const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
    return ((r ?? 0) + (g ?? 0) + (b ?? 0)) / 765;
  });
}

test("a report prints without the site's header, footer and buttons, in dark ink even from the dark theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/report?sample=ahmed35-medium-fix");
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toBeVisible();
  expect(await lightness(page, "h1")).toBeGreaterThan(0.8); // light text on the dark screen

  await page.emulateMedia({ media: "print", colorScheme: "dark" });
  await expect(page.locator("header").first()).toBeHidden();
  await expect(page.locator("footer")).toBeHidden();
  await expect(page.getByRole("link", { name: "Open another report" })).toBeHidden();
  await expect(title).toBeVisible();
  await expect(page.getByText("Mesh Doctor report")).toBeVisible();
  expect(await lightness(page, "h1")).toBeLessThan(0.3); // dark text on the white page
});

test("the app's report prints without its sidebar, top bar and buttons", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/demo/repairs/ahmed35-medium-fix/report");
  await expect(page.getByRole("button", { name: "Save report" })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("aside").first()).toBeHidden();
  await expect(page.getByRole("button", { name: "Save report" })).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
