// SPDX-License-Identifier: GPL-3.0-or-later
// Browser tests against the built site (vite preview). The engine is mocked per test with page.route,
// so no OpenFOAM is needed. Locally they use the installed Microsoft Edge; CI installs Chromium.
import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env.CI);
const channel = process.env.PW_CHANNEL ?? (CI ? undefined : "msedge");

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
  webServer: {
    command: "npx vite build && npx vite preview",
    url: "http://localhost:4173",
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel }, testIgnore: /mobile\.spec\.ts/ },
    { name: "phone", use: { ...devices["Pixel 7"], channel }, testMatch: /mobile\.spec\.ts/ },
  ],
});
