// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("the safety model: from the footer, its six sections, and links between it and Limits stay on the site", async ({ page }) => {
  const sent: string[] = [];
  const origins = new Set<string>();
  page.on("request", (r) => {
    origins.add(new URL(r.url()).origin);
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Safety model" }).click();
  await expect(page).toHaveURL(/\/safety$/);
  await expect(page.getByRole("heading", { level: 1, name: "Safety model" })).toBeVisible();
  await expect(page).toHaveTitle("Safety model · Mesh Doctor");
  await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveCount(6);

  await page.getByRole("main").getByRole("link", { name: "limits", exact: true }).click();
  await expect(page).toHaveURL(/\/limits$/);
  await page.getByRole("region", { name: "The dashboard" }).getByRole("link", { name: "safety" }).click();
  await expect(page).toHaveURL(/\/safety$/);
  expect([...origins]).toEqual(["http://localhost:4173"]);
  expect(sent).toEqual([]);
});

test("the pairing page's safety link opens the safety model in a new tab", async ({ page }) => {
  await page.goto("/connect");
  const [tab] = await Promise.all([page.waitForEvent("popup"), page.getByRole("link", { name: "The full safety model" }).click()]);
  await expect(tab).toHaveURL(/\/safety$/);
  await expect(tab.getByRole("heading", { level: 1, name: "Safety model" })).toBeVisible();
  await expect(page).toHaveURL(/\/connect$/);
});
