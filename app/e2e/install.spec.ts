// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("install: from the pairing page, the set-up commands and the steps by hand, and nothing is sent", async ({ page }) => {
  const sent: string[] = [];
  const origins = new Set<string>();
  page.on("request", (r) => {
    origins.add(new URL(r.url()).origin);
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/connect");
  await page.getByRole("link", { name: "Install it (Windows or Linux)" }).click();
  await expect(page).toHaveURL(/\/install$/);
  await expect(page.getByRole("heading", { level: 1, name: "Install" })).toBeVisible();
  await expect(page).toHaveTitle("Install · Mesh Doctor");
  await expect(page.getByText("bash tools/setup_linux.sh", { exact: true })).toBeVisible();
  await expect(page.getByText(/^powershell -ExecutionPolicy Bypass -File tools.setup_windows\.ps1$/)).toBeVisible();

  // The Windows steps send you on to the Linux steps, which land just below the header.
  await page.getByRole("main").getByRole("link", { name: "Linux", exact: true }).click();
  await expect(page).toHaveURL(/\/install#linux$/);
  await expect.poll(() => page.locator("#linux").evaluate((e) => Math.round(e.getBoundingClientRect().top))).toBeGreaterThan(56);
  await expect(page.getByRole("heading", { level: 3, name: "Linux (Ubuntu 22.04, or WSL)" })).toBeInViewport();
  expect([...origins]).toEqual(["http://localhost:4173"]);
  expect(sent).toEqual([]);
});
