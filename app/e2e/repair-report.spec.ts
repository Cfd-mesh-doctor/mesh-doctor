// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("the demo's overview opens a repair's report in the viewer, and nothing is sent", async ({ page }) => {
  const sent: string[] = [];
  const origins = new Set<string>();
  page.on("request", (r) => {
    origins.add(new URL(r.url()).origin);
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/demo");
  await page.getByRole("link", { name: "Report of ahmed35-medium-fix" }).click();
  await expect(page).toHaveURL(/\/demo\/repairs\/ahmed35-medium-fix\/report$/);
  await expect(page.getByRole("heading", { level: 1, name: "ahmed35-medium-fix" })).toBeVisible();
  await expect(page).toHaveTitle("Report of ahmed35-medium-fix · Mesh Doctor");
  await expect(page.getByText(/from the recorded demo/)).toBeVisible();
  await expect(page.getByRole("img", { name: /^Side view of the model's wall faces .* 26 defects found and repaired/ })).toBeVisible();

  await page.getByRole("main").getByRole("link", { name: "Overview" }).click();
  await expect(page).toHaveURL(/\/demo$/);

  // A run the demo has no report of (it never finished) says so, and offers the ones it has.
  await page.goto("/demo/repairs/ahmed25-fine-strict/report");
  await expect(page.getByText("The demo has no recorded report of ahmed25-fine-strict: only its finished repairs have one")).toBeVisible();
  await page.getByRole("link", { name: "25° slant, with an A/B test" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "ahmed25-medium-fix" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Initial residual of p per iteration/ })).toBeVisible();
  expect([...origins]).toEqual(["http://localhost:4173"]);
  expect(sent).toEqual([]);
});
