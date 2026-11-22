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
  // The doc's tables are tables, not lines of "|" text.
  await expect(page.getByRole("region", { name: "Skills", exact: true }).getByRole("row")).toHaveCount(7);
  await expect(page.getByRole("region", { name: "Slash commands" })
    .getByRole("cell", { name: "/cfd-toolkit:testrun [quick|full] [ranks]" })).toBeVisible();
  // "Start here" is two numbered steps, not one paragraph with the numbers in it.
  const steps = page.getByRole("region", { name: "Start here" }).locator("ol > li");
  await expect(steps).toHaveCount(2);
  await expect(steps.first()).toHaveText(/^\/testrun checks what is installed/);
  expect(sent).toEqual([]);
});

test("claude code: the plugin's two install commands copy together from their block's button", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/claude-code");
  const block = page.getByRole("main").locator("pre").first();
  await expect(block).toContainText("/plugin install");
  const button = page.getByRole("button", { name: /^Copy the 2 lines starting “\/plugin marketplace add/ });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.replace(/\r\n/g, "\n")).toBe(await block.textContent()); // Windows' clipboard gives lines back with \r\n
});
