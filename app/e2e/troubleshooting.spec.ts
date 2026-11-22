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
  // The items of each group's list (the "On this page" list is a list too).
  const problems = page.getByRole("main").getByRole("region").getByRole("listitem");
  await expect(problems).toHaveCount(36);

  await page.getByRole("searchbox", { name: "Search for the message you see" }).fill(PASTED);
  await expect(problems).toHaveCount(1);
  await expect(page.getByRole("main").getByText(/split the fields/)).toBeVisible();
  await expect(page.getByText("1 of 36 problems matches. Enter goes to it.")).toBeVisible();
  await expect(page).toHaveURL(/\/troubleshooting\?q=/);
  // The page's list now holds only that problem's group, and following it keeps the search.
  const contents = page.getByRole("navigation", { name: "On this page" });
  await expect(contents.getByRole("link")).toHaveCount(1);
  await contents.getByRole("link").click();
  await expect(page).toHaveURL(/\/troubleshooting\?q=.+#[a-z-]+$/);
  await expect(problems).toHaveCount(1);

  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search for the message you see" })).toHaveValue(PASTED);
  await expect(problems).toHaveCount(1);
  expect([...origins]).toEqual(["http://localhost:4173"]);
  expect(sent).toEqual([]);
});

test("troubleshooting from the keyboard: “/”, a word and Enter go to the first problem that matches", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/troubleshooting");
  await page.locator("h1").first().waitFor();
  await page.keyboard.press("/");
  await page.keyboard.type("decomposePar");
  await expect(page.getByText(/ Enter goes to (it|the first)\.$/)).toBeVisible();
  await page.keyboard.press("Enter");
  const group = page.getByRole("main").getByRole("region").first();
  const first = group.getByRole("listitem").first();
  await expect(first).toBeFocused();
  await expect(first).toBeInViewport();
  // Its group's heading shows too, below the page's header, not under it.
  const heading = group.getByRole("heading", { level: 2 });
  await expect(heading).toBeInViewport();
  const header = await page.locator("header").first().boundingBox();
  const top = await heading.boundingBox();
  expect(top!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  // Tab goes on from there, and never stops on the problem again.
  await page.keyboard.press("Tab");
  await expect(first).not.toBeFocused();
  await expect(first).not.toHaveAttribute("tabindex");
});

test("a link to a group of problems opens at that group", async ({ page }) => {
  await page.goto("/troubleshooting#web-app");
  await expect(page.getByRole("heading", { level: 2, name: "Web app" })).toBeInViewport();
});
