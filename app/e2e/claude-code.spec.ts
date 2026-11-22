// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("claude code: from the Docs page, the plugin's install commands, and nothing sent", async ({ page }) => {
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" || new URL(r.url()).origin !== "http://localhost:4173") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/docs");
  await page.getByRole("region", { name: "On this site" }).getByRole("link", { name: "Claude Code" }).click();
  await expect(page).toHaveURL(/\/claude-code$/);
  await expect(page.getByRole("heading", { level: 1, name: "Using this repository with Claude Code" })).toBeVisible();
  await expect(page).toHaveTitle("Claude Code · Mesh Doctor");
  await expect(page.getByRole("main").locator("pre").first()).toContainText("/plugin marketplace add Cfd-mesh-doctor/mesh-doctor");
  expect(sent).toEqual([]);
});
