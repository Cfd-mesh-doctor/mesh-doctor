// SPDX-License-Identifier: GPL-3.0-or-later
import { readFile } from "node:fs/promises";
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

test("a repair's report saves as the file meshdoctor report makes, and the viewer opens that file", async ({ page }) => {
  const sent: string[] = [];
  const origins = new Set<string>();
  page.on("request", (r) => {
    origins.add(new URL(r.url()).origin);
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/demo/repairs/ahmed35-medium-fix/report");
  await expect(page.getByRole("heading", { level: 1, name: "ahmed35-medium-fix" })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save report" }).click()]);
  expect(download.suggestedFilename()).toBe("ahmed35-medium-fix.mdreport.json");
  const buffer = await readFile(await download.path());
  expect(buffer.toString("latin1")).toMatch(/^[ -~]+$/); // only printable ASCII, as the engine writes it
  expect(JSON.parse(buffer.toString("utf8"))).toMatchObject({ kind: "meshdoctor-report", name: "ahmed35-medium-fix" });

  await page.goto("/report");
  await page.getByLabel("Choose a report file").setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer });
  await expect(page.getByRole("heading", { level: 1, name: "ahmed35-medium-fix" })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Side view of the model's wall faces .* 26 defects found and repaired/ })).toBeVisible();
  expect([...origins]).toEqual(["http://localhost:4173"]);
  expect(sent).toEqual([]);
});

test("the demo's Jobs page opens a finished run's report, from its row or from its details", async ({ page }) => {
  await page.goto("/demo/jobs");
  // The cancelled repair has no report, so its row has no link.
  await expect(page.getByRole("row", { name: /ahmed25-fine-strict/ }).getByRole("link")).toHaveCount(0);
  await page.getByRole("row", { name: /pitzdaily-fix/ }).getByRole("link", { name: "Report of pitzdaily-fix" }).click();
  await expect(page).toHaveURL(/\/demo\/repairs\/pitzdaily-fix\/report$/);
  await expect(page.getByRole("heading", { level: 1, name: "pitzdaily-fix" })).toBeVisible();

  await page.goBack();
  await page.getByRole("button", { name: "ahmed35-medium-fix" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Open report" }).click();
  await expect(page).toHaveURL(/\/demo\/repairs\/ahmed35-medium-fix\/report$/);
  await expect(page.getByRole("heading", { level: 1, name: "ahmed35-medium-fix" })).toBeVisible();
});

test("the demo's Cases page opens a case's latest report", async ({ page }) => {
  await page.goto("/demo/cases");
  await page.getByRole("row", { name: /pitzDaily/ }).getByRole("link", { name: "Report of pitzdaily-fix" }).click();
  await expect(page).toHaveURL(/\/demo\/repairs\/pitzdaily-fix\/report$/);
  await expect(page.getByRole("heading", { level: 1, name: "pitzdaily-fix" })).toBeVisible();
});
