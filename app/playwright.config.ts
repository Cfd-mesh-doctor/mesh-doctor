// SPDX-License-Identifier: GPL-3.0-or-later
// Browser tests against the built site (vite preview). The engine is mocked per test with page.route,
// so no OpenFOAM is needed. Locally they use the installed Microsoft Edge; CI installs Chromium.
import { defineConfig, devices } from "@playwright/test";
import { TOUR_SEEN } from "./src/components/shared/tourSteps";

const CI = Boolean(process.env.CI);
const channel = process.env.PW_CHANNEL ?? (CI ? undefined : "msedge");
const SITE = "http://localhost:4173";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: SITE,
    trace: "retain-on-failure",
    // Each test starts in a browser that has seen the demo's tour, which opens by itself on a first visit to the demo's
    // front page and would stand over it. The test of that first visit starts without it.
    storageState: { cookies: [], origins: [{ origin: SITE, localStorage: [{ name: TOUR_SEEN, value: "1" }] }] },
  },
  webServer: {
    command: "npx vite build && npx vite preview",
    url: SITE,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel }, testIgnore: /mobile\.spec\.ts/ },
    { name: "phone", use: { ...devices["Pixel 7"], channel }, testMatch: /mobile\.spec\.ts/ },
  ],
});
