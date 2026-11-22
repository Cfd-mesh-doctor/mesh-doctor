// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("limits: from the footer, the doc's seven sections and its link to the safety model, and nothing is sent", async ({ page }) => {
  const sent: string[] = [];
  const origins = new Set<string>();
  page.on("request", (r) => {
    origins.add(new URL(r.url()).origin);
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Limits" }).click();
  await expect(page).toHaveURL(/\/limits$/);
  await expect(page.getByRole("heading", { level: 1, name: "Limits" })).toBeVisible();
  await expect(page).toHaveTitle("Limits · Mesh Doctor");
  await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveCount(7);
  await expect(page.getByRole("region", { name: "The dashboard" }).getByRole("link", { name: "safety" }))
    .toHaveAttribute("href", /safety/);
  expect([...origins]).toEqual(["http://localhost:4173"]);
  expect(sent).toEqual([]);
});

test("How it works links the Limits page", async ({ page }) => {
  await page.goto("/how-it-works");
  await page.getByRole("main").getByRole("link", { name: "limits", exact: true }).click();
  await expect(page).toHaveURL(/\/limits$/);
  await expect(page.getByRole("heading", { level: 1, name: "Limits" })).toBeVisible();
});
