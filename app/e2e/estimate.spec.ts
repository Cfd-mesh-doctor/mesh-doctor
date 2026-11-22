// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("the size estimator works in the page and keeps the estimate in the address", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const sent: string[] = [];
  const origins = new Set<string>();
  page.on("request", (r) => {
    origins.add(new URL(r.url()).origin);
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Estimator" }).click();
  await expect(page.getByRole("heading", { name: "Size estimator" })).toBeVisible();
  await expect(page).toHaveTitle("Size estimator · Mesh Doctor");

  // Typing doesn't make the page jump, even when it is scrolled.
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.evaluate(() => window.scrollTo(0, 120));
  const cells = page.getByLabel("Mesh size");
  await cells.fill("31.1");
  await expect(page).toHaveURL(/\/estimate\?cells=31\.1$/);
  // Still where it was, not back at the top (a pixel either way is the layout settling as the results change).
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - 120)).toBeLessThanOrEqual(2);
  await expect(page.getByText("too big", { exact: true })).toHaveCount(4);
  await expect(page.getByText("about 19.0 h, $16")).toBeVisible();

  // The link brings the same estimate back, and Copy link copies it.
  await page.reload();
  await expect(page.getByLabel("Mesh size")).toHaveValue("31.1");
  await expect(page.getByText("about 19.0 h, $16")).toBeVisible();
  const copy = page.getByRole("button", { name: /^(Copy link|Copied)$/ });
  await expect(copy).toHaveAccessibleName("Copy link");
  await copy.click();
  await expect(copy).toHaveAccessibleName("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("http://localhost:4173/estimate?cells=31.1");
  // A screen reader is told, whether or not it reads the button's new name.
  await expect(page.locator("body > [aria-live='polite']")).toHaveText("Copied to the clipboard");
  expect([...origins]).toEqual(["http://localhost:4173"]);
  expect(sent).toEqual([]);
});

test("at 1024 px the number tiles' notes wrap rather than being cut off", async ({ page }) => {
  // Beside the sidebar (and the estimator's inputs) a tile is about 180 px wide: "8 ranks; does not fit in memory"
  // lost its end, and so did a report's "inside the mesh; the CAD is untouched".
  await page.setViewportSize({ width: 1024, height: 900 });
  for (const [path, notes] of [
    ["/demo/estimate?cells=31.1", [/; too big for \d+ GB$/, /ranks; does not fit in memory$/, /^about .+ an hour$/, /^above its limit of about/]],
    ["/demo/repairs/ahmed25-medium-fix/report", [/^inside the mesh; the CAD is untouched$/]],
  ] as const) {
    await page.goto(path);
    for (const note of notes) {
      const el = page.getByText(note);
      await expect(el).toBeVisible();
      expect(await el.evaluate((e) => e.scrollWidth - e.clientWidth), `${path}: ${note.source} is cut off`).toBeLessThanOrEqual(0);
    }
  }
});
