// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

/** One page's file from the build. After an update the host has only the new build's files, and for an old one it
 * answers with the site's own page (vercel.json sends every unknown address to index.html). */
const PAGE_FILE = /\/assets\/Troubleshooting-[\w-]+\.js$/;

test("a tab opened before an update says so, and Reload gets the new version", async ({ page }) => {
  await page.route(PAGE_FILE, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Mesh Doctor</title>" }));
  await page.goto("/");
  await page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Troubleshooting" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mesh Doctor has been updated" })).toBeVisible();
  await expect(page).toHaveTitle("Updated · Mesh Doctor");

  await page.unroute(PAGE_FILE);
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Troubleshooting" })).toBeVisible();
  await expect(page).toHaveURL(/\/troubleshooting$/);
});
