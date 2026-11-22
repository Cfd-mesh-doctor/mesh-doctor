// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("the docs page: from the header, each of the site's pages opens, the rest are on GitHub, and nothing is sent", async ({ page }) => {
  const sent: string[] = [];
  const origins = new Set<string>();
  page.on("request", (r) => {
    origins.add(new URL(r.url()).origin);
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Docs" }).click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
  await expect(page).toHaveTitle("Docs · Mesh Doctor");
  await expect(page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");

  const github = page.getByRole("region", { name: "On GitHub" });
  const troubleshooting = github.getByRole("link", { name: "Troubleshooting" });
  await expect(troubleshooting).toHaveAttribute("href", "https://github.com/Cfd-mesh-doctor/mesh-doctor/blob/main/docs/troubleshooting.md");
  await expect(troubleshooting).toHaveAttribute("target", "_blank");

  for (const [name, heading] of [
    ["How it works", "How Mesh Doctor works"], ["Accuracy check", "Accuracy check"], ["Gallery", "Gallery"],
    ["Install", "Install"], ["Report viewer", "Report viewer"], ["Size estimator", "Size estimator"],
  ] as const) {
    await page.getByRole("region", { name: "On this site" }).getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
  }
  expect([...origins]).toEqual(["http://localhost:4173"]);
  expect(sent).toEqual([]);
});

test("the app's Documentation link opens the Docs page in a new tab, leaving the app as it is", async ({ page }) => {
  await page.goto("/demo/jobs");
  const [docs] = await Promise.all([page.waitForEvent("popup"), page.getByRole("link", { name: "Documentation" }).click()]);
  await expect(docs).toHaveURL(/\/docs$/);
  await expect(docs.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
  await expect(page).toHaveURL(/\/demo\/jobs$/);
});
