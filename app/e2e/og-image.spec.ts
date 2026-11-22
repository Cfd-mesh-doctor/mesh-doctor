// SPDX-License-Identifier: GPL-3.0-or-later
// Makes docs/images/og-home.png, the picture a chat app or social site shows for a shared link to the site (the build
// publishes it as /og.png): the top of the home page at 1200 x 630 in the light theme. It runs only when asked; remake
// the picture after the home page changes:
//   MAKE_OG_IMAGE=1 npx playwright test e2e/og-image.spec.ts --project=desktop
// (in PowerShell, set $env:MAKE_OG_IMAGE = "1" first).
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";

test.skip(!process.env.MAKE_OG_IMAGE, "makes the link preview's picture only when asked (MAKE_OG_IMAGE=1)");

test("the link preview picture", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: fileURLToPath(new URL("../../docs/images/og-home.png", import.meta.url)) });
});
