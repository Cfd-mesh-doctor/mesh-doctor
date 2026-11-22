// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("the gallery: from the landing page, every picture loads from the site itself, and nothing is sent", async ({ page }) => {
  const sent: string[] = [];
  const origins = new Set<string>();
  page.on("request", (r) => {
    origins.add(new URL(r.url()).origin);
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/");
  await page.getByRole("link", { name: "The pictures it makes" }).click();
  await expect(page).toHaveURL(/\/gallery$/);
  await expect(page.getByRole("heading", { level: 1, name: "Gallery" })).toBeVisible();
  await expect(page).toHaveTitle("Gallery · Mesh Doctor");

  const pictures = page.getByRole("main").getByRole("img");
  await expect(pictures).toHaveCount(8);
  for (const picture of await pictures.all()) {
    await picture.scrollIntoViewIfNeeded();
    await expect.poll(() => picture.evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0))).toBeGreaterThan(0);
    // Laid out at the picture's own shape (width and height attributes), so nothing jumps while it loads.
    const box = await picture.boundingBox();
    const [w, h] = await picture.evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight]);
    expect(Math.abs((box?.width ?? 0) / (box?.height ?? 1) - (w ?? 1) / (h ?? 1))).toBeLessThan(0.02);
  }
  await expect(page.getByRole("link", { name: "Speed on the centreline" })).toHaveAttribute("target", "_blank");
  expect([...origins]).toEqual(["http://localhost:4173"]);
  expect(sent).toEqual([]);
});
