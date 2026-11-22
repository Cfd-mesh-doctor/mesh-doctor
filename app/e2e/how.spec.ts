// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("how it works: reached from the header, its contents scroll to each step, and nothing is sent", async ({ page }) => {
  const sent: string[] = [];
  const origins = new Set<string>();
  page.on("request", (r) => {
    origins.add(new URL(r.url()).origin);
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/report");
  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/\/how-it-works$/);
  await expect(page.getByRole("heading", { level: 1, name: "How Mesh Doctor works" })).toBeVisible();
  await expect(page).toHaveTitle("How it works · Mesh Doctor");
  await expect(page.getByRole("table", { name: "The targets of each profile" }).getByRole("row")).toHaveCount(3);

  // A contents link scrolls its step to just below the sticky header.
  await page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "The convergence judge" }).click();
  await expect(page).toHaveURL(/\/how-it-works#judge$/);
  const judge = page.getByRole("heading", { level: 2, name: "The convergence judge" });
  await expect(judge).toBeInViewport();
  expect((await judge.boundingBox())?.y).toBeGreaterThan(64);

  // A link to a step, opened from elsewhere, lands on that step.
  await page.goto("/");
  await page.goto("/how-it-works#hotspots");
  await expect(page.getByRole("heading", { level: 2, name: "Hotspots and the map" })).toBeInViewport();

  // "See one" opens the sample itself.
  await page.getByRole("link", { name: "the 35° sample" }).click();
  await expect(page).toHaveURL(/\/report\?sample=ahmed35-medium-fix$/);
  await expect(page.getByRole("heading", { level: 1, name: "ahmed35-medium-fix" })).toBeVisible();

  // The home page's summary leads here too.
  await page.goto("/");
  await page.getByRole("link", { name: "How each step works, and the command behind it" }).click();
  await expect(page).toHaveURL(/\/how-it-works$/);
  expect([...origins]).toEqual(["http://localhost:4173"]);
  expect(sent).toEqual([]);
});
