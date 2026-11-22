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

test("the repair map is redrawn in the light colours for printing, also from the dark theme", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/report?sample=ahmed35-medium-fix");
  const map = page.getByRole("img", { name: /view of the model.s wall faces/ }).first(); // the repair map
  await expect(map).toBeVisible();
  await expect.poll(() => map.evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(300); // drawn at its width
  const picture = () => map.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const light = await picture();

  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(picture).not.toBe(light); // the screen's dark colours
  await page.emulateMedia({ media: "print", colorScheme: "dark" });
  await expect.poll(picture).toBe(light);
  await page.emulateMedia({ media: "screen", colorScheme: "dark" });
  await expect.poll(picture).not.toBe(light);

  // Printing for real, the browser fires "beforeprint" while the screen's colours still apply and takes its picture of
  // the page right after, so the map has to be redrawn by the time the event returns.
  const printed = await map.evaluate((c: HTMLCanvasElement) => {
    window.dispatchEvent(new Event("beforeprint"));
    return c.toDataURL();
  });
  expect(printed).toBe(light);
  await map.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect.poll(picture).not.toBe(light); // back to the screen's colours
});

test("on paper the repair map shrinks to fit the page, keeping its proportions", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/report?sample=ahmed35-medium-fix");
  const map = page.getByRole("img", { name: /view of the model.s wall faces/ }).first(); // the repair map
  await expect.poll(() => map.evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(500);
  // A printed page is laid out at the paper's width and nothing measures the map again: narrow its box and read its
  // size at once, before the page's resize observer could redraw it, then put the box back.
  const squeezed = () =>
    map.evaluate((c: HTMLCanvasElement) => {
      const box = c.parentElement!;
      box.style.width = "500px";
      const r = c.getBoundingClientRect();
      box.style.width = "";
      return { width: r.width, shape: r.width / r.height, drawn: c.width / c.height };
    });
  expect((await squeezed()).width).toBeGreaterThan(500); // on the screen it keeps the width it was drawn at

  await page.emulateMedia({ media: "print" });
  const printed = await squeezed();
  expect(printed.width).toBeLessThanOrEqual(500);
  expect(printed.shape).toBeCloseTo(printed.drawn, 1);
});
