// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test, type Page } from "@playwright/test";
import { ENGINE, KEY, mockEngine, pairingLink } from "./engine";

/** Fails the test on any console error or failed page script. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/net::ERR_CONNECTION_REFUSED|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("the home page explains the app and links to the demo", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page).toHaveTitle(/Mesh Doctor/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("bad cells");
  await expect(page.getByRole("heading", { name: "Your meshes never leave your computer" })).toBeVisible();
  await page.getByRole("link", { name: "Explore the demo" }).first().click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByText(/Demo: recorded from a real run/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("the demo shows recorded jobs, and cancelling asks first", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/demo/jobs");
  const running = page.getByRole("row", { name: "ahmed25-medium-fix A/B test" });
  await expect(running).toContainText("Running");
  await expect(running).toContainText("solving fixed");
  await running.getByRole("button", { name: "Cancel" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Cancel ahmed25-medium-fix?");
  await dialog.getByRole("button", { name: "Cancel job" }).click();
  await expect(dialog).toBeHidden();
  await expect(running).toContainText("Cancelled");
  await page.getByRole("radio", { name: /Done/ }).click();
  await expect(page.getByRole("row", { name: /ahmed25-coarse-fix/ }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("the demo's cases show what was done to each", async ({ page }) => {
  await page.goto("/demo/cases");
  await expect(page.getByRole("row", { name: /ahmed-35-medium/ })).toContainText("Improved 4");
  await expect(page.getByRole("row", { name: /pitzDaily/ })).toContainText("2 better, 1 worse");
  await page.getByLabel("Filter cases").fill("ahmed-25");
  await expect(page.getByRole("row", { name: /pitzDaily/ })).toHaveCount(0);
});

test("pairing: the key leaves the address bar, then the app connects", async ({ page }) => {
  const engine = await mockEngine(page);
  await page.goto(pairingLink());
  await expect(page.getByRole("heading", { name: "Connect to your engine" })).toBeVisible();
  await expect(page).toHaveURL(/\/connect$/); // no #key=… left behind
  expect(engine.requests).toHaveLength(0); // nothing is sent before the user presses Connect
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Mesh Doctor v0.1.0 answered")).toBeVisible();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await expect(page.getByText("Source cases")).toBeVisible();
  await expect(page.getByRole("link", { name: /Connected/ })).toBeVisible();
  const apiCalls = engine.requests.filter((r) => r.method() !== "OPTIONS");
  expect(apiCalls.length).toBeGreaterThan(0);
  for (const r of apiCalls) expect(r.headers()["x-md-key"]).toBe(KEY);
});

test("the site talks to nothing but itself and the engine", async ({ page }) => {
  await mockEngine(page);
  const seen = new Set<string>();
  page.on("request", (r) => seen.add(new URL(r.url()).origin));
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await page.getByRole("link", { name: "Jobs" }).first().click();
  await expect(page.getByRole("row", { name: /wing-fix/ })).toBeVisible();
  expect([...seen].sort()).toEqual([ENGINE, "http://localhost:4173"].sort());
});

test("an engine that isn't running gets a plain explanation", async ({ page }) => {
  await mockEngine(page, { down: true });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("The engine isn't answering")).toBeVisible();
  await expect(page.getByText("meshdoctor serve")).toBeVisible();
});

test("a replaced pairing key says to pair again", async ({ page }) => {
  await mockEngine(page, { wrongKey: true });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("This browser needs pairing again")).toBeVisible();
});

test("live jobs can be cancelled on a real (mocked) engine", async ({ page }) => {
  await mockEngine(page);
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await page.goto("/app/jobs");
  const row = page.getByRole("row", { name: /wing-fix/ });
  await expect(row).toContainText("62 %");
  await row.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel job" }).click();
  await expect(row).toContainText("Cancelled");
});

test("the app without a pairing goes to Connect", async ({ page }) => {
  await page.goto("/app/jobs");
  await expect(page).toHaveURL(/\/connect$/);
  await expect(page.getByRole("heading", { name: "Pair this browser with Mesh Doctor" })).toBeVisible();
});

test("every page runs under the site's Content-Security-Policy", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.headers()["content-security-policy"]).toContain("script-src 'self'");
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { cspViolations: string[] }).cspViolations ??= [];
      (window as unknown as { cspViolations: string[] }).cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  for (const path of ["/", "/connect", "/report", "/estimate", "/how-it-works", "/demo", "/demo/cases", "/demo/jobs", "/demo/settings"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const v = await page.evaluate(() => (window as unknown as { cspViolations?: string[] }).cspViolations ?? []);
    expect(v, path).toEqual([]);
  }
});

test("unknown pages say so", async ({ page }) => {
  await page.goto("/nowhere");
  await expect(page.getByText("This page doesn't exist")).toBeVisible();
  await page.goto("/demo/nowhere");
  await expect(page.getByText("This page doesn't exist")).toBeVisible();
});
