// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

const PASTED = "--> FOAM FATAL ERROR: Cannot find patchField entry for procBoundary0to1";

test("troubleshooting: from the Docs page, a message pasted from a log finds its fix, a reload keeps it, and nothing is sent", async ({ page }) => {
  const sent: string[] = [];
  const origins = new Set<string>();
  page.on("request", (r) => {
    origins.add(new URL(r.url()).origin);
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/docs");
  await page.getByRole("region", { name: "On this site" }).getByRole("link", { name: "Troubleshooting" }).click();
  await expect(page).toHaveURL(/\/troubleshooting$/);
  await expect(page.getByRole("heading", { level: 1, name: "Troubleshooting" })).toBeVisible();
  await expect(page).toHaveTitle("Troubleshooting · Mesh Doctor");
  const problems = page.getByRole("main").getByRole("listitem");
  await expect(problems).toHaveCount(36);

  await page.getByRole("searchbox", { name: "Search for the message you see" }).fill(PASTED);
  await expect(problems).toHaveCount(1);
  await expect(page.getByRole("main").getByText(/split the fields/)).toBeVisible();
  await expect(page.getByText("1 of 36 problems matches.")).toBeVisible();
  await expect(page).toHaveURL(/\/troubleshooting\?q=/);

  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search for the message you see" })).toHaveValue(PASTED);
  await expect(problems).toHaveCount(1);
  expect([...origins]).toEqual(["http://localhost:4173"]);
  expect(sent).toEqual([]);
});

test("a link to a group of problems opens at that group", async ({ page }) => {
  await page.goto("/troubleshooting#web-app");
  await expect(page.getByRole("heading", { level: 2, name: "Web app" })).toBeInViewport();
});
