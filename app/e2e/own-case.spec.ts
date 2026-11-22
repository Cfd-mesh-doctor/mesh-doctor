// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("your own case: from the Docs page, the copy command, six sections with the wheel's settings, and nothing sent", async ({ page }) => {
  const sent: string[] = [];
  const origins = new Set<string>();
  page.on("request", (r) => {
    origins.add(new URL(r.url()).origin);
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/docs");
  await page.getByRole("region", { name: "On this site" }).getByRole("link", { name: "Your own case" }).click();
  await expect(page).toHaveURL(/\/your-own-case$/);
  await expect(page.getByRole("heading", { level: 1, name: "Starting your own case from the Ahmed example" })).toBeVisible();
  await expect(page).toHaveTitle("Your own case · Mesh Doctor");
  await expect(page.getByRole("main").getByText("cp -r examples/ahmed-body", { exact: false })).toBeVisible();
  await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveCount(6);
  await expect(page.getByRole("main").locator("pre")).toContainText("rotatingWallVelocity");
  expect([...origins]).toEqual(["http://localhost:4173"]);
  expect(sent).toEqual([]);
});
