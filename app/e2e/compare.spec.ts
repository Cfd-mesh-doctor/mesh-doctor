// SPDX-License-Identifier: GPL-3.0-or-later
// The Compare screen in a real browser: in the demo, Compare… on a case's results page, the medium mesh picked as a
// mesh study, its table and both runs' forces on one chart, and its finished A/B test's two runs from the test's own
// page; with your own engine, two cases picked from the Results screen and compared with the pairing key, another
// window asked for from the charts and kept in the address, and an engine too old to compare told so.
import { expect, test, type Page } from "@playwright/test";
import { KEY, mockEngine, pairingLink, resultsDoc } from "./engine";

/** Pairs with the pretend engine. */
async function pair(page: Page) {
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
}

test("the demo's mesh study: Compare… on a case's results, the finer mesh picked, its table and both runs' forces", async ({ page }) => {
  await page.goto("/demo/results/ahmed-25-coarse");
  await page.getByRole("link", { name: "Compare…" }).click();
  await expect(page).toHaveURL(/\/demo\/compare\?a=ahmed-25-coarse$/);
  await expect(page.getByRole("heading", { name: "Pick a case to compare with ahmed-25-coarse" })).toBeVisible();
  await expect(page.getByLabel("Case a")).toHaveValue("ahmed-25-coarse");
  await page.getByLabel("Case b").selectOption("ahmed-25-medium");
  await page.getByLabel(/A mesh study/).check();
  await page.getByRole("button", { name: "Compare", exact: true }).click();

  await expect(page).toHaveURL(/\/demo\/compare\?a=ahmed-25-coarse&b=ahmed-25-medium&mesh=true$/);
  await expect(page.getByRole("heading", { level: 1, name: "ahmed-25-coarse against ahmed-25-medium" })).toBeVisible();
  await expect(page.getByText("A mesh study: one design at two mesh sizes · recorded demo")).toBeVisible();
  // the total group's drag 6.2 % lower on the finer mesh: real, and more than it swings, so not mesh-independent yet
  const drag = page.getByRole("row").nth(1);
  await expect(drag).toContainText("−6.2 %");
  await expect(drag).toContainText("Real");
  await expect(drag).toContainText("Moves more than it swings");
  await expect(page.getByRole("row").nth(2)).toContainText("Inside the noise");
  // both runs' forces on one chart each, their judges' window shaded
  await expect(page.getByRole("img", { name: "Drag of forceCoeffs in both runs, in N" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Lift of forceCoeffs in both runs, in N" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Start of the averaged part" }).first()).toHaveAttribute("aria-valuenow", "1600");
  // each run a link to its own results
  await page.getByRole("link", { name: "ahmed-25-medium", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/results\/ahmed-25-medium$/);
  await expect(page.getByText("15.13 N")).toBeVisible();
});

test("the demo's finished A/B test: Compare forces on its page compares its two runs", async ({ page }) => {
  await page.goto("/demo/abtests/ahmed25-coarse-fix");
  await page.getByRole("link", { name: "Compare forces" }).click();
  await expect(page).toHaveURL(/\/demo\/compare\?abtest=ahmed25-coarse-fix$/);
  await expect(page.getByRole("heading", {
    level: 1, name: "ahmed25-coarse-fix (original mesh) against ahmed25-coarse-fix (repaired mesh)",
  })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("still drifting over the window");
  await expect(page.getByRole("row").nth(1)).toContainText("Inside the noise");
  await page.getByRole("link", { name: "A/B test", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/abtests\/ahmed25-coarse-fix$/);
});

test("with your own engine, two cases from the Results screen are compared with the key, over a window from the charts", async ({ page }) => {
  const lower = resultsDoc("wing-v2");
  lower.groups[0]!.drag.mean = 15.5;
  const engine = await mockEngine(page, { caseResults: [resultsDoc("wing"), lower], compare: true });
  await pair(page);
  await page.getByRole("complementary").getByRole("link", { name: "Results" }).click();
  await page.getByRole("link", { name: "Compare two cases" }).click();
  await expect(page).toHaveURL(/\/app\/compare$/);
  await expect(page.getByRole("heading", { name: "Pick two cases to compare" })).toBeVisible();
  await page.getByLabel("Case a").selectOption("wing");
  await page.getByLabel("Case b").selectOption("wing-v2");
  await page.getByRole("button", { name: "Compare", exact: true }).click();

  await expect(page).toHaveURL(/\/app\/compare\?a=wing&b=wing-v2$/);
  await expect(page.getByRole("heading", { level: 1, name: "wing against wing-v2" })).toBeVisible();
  await expect(page.getByText("Two designs", { exact: true })).toBeVisible();
  const drag = page.getByRole("row").nth(1);
  await expect(drag).toContainText("−0.62");
  await expect(drag).toContainText("Real");
  await expect(page.getByRole("row").nth(2)).toContainText("Inside the noise");
  await expect(page.getByRole("img", { name: "Drag of forceCoeffs in both runs, in N" })).toBeVisible();
  const asked = () => engine.requests.filter((r) => new URL(r.url()).pathname === "/api/v1/compare");
  expect(asked().map((r) => new URL(r.url()).search)).toContain("?a=wing&b=wing-v2");

  // Shift and an arrow move the window's start a tenth of the run earlier; letting go asks for it
  const start = page.getByRole("slider", { name: "Start of the averaged part" }).first();
  await start.focus();
  await start.press("Shift+ArrowLeft");
  await expect(page).toHaveURL(/\/app\/compare\?a=wing&b=wing-v2&from=1400$/);
  await expect(page.getByText("Both averaged after iteration 1,400, up to 2,000: the window asked for.")).toBeVisible();
  expect(asked().map((r) => new URL(r.url()).search)).toContain("?a=wing&b=wing-v2&from=1400");
  expect(asked().every((r) => r.headers()["x-md-key"] === KEY)).toBe(true);
});

test("an engine too old to compare is told to update", async ({ page }) => {
  await mockEngine(page, { caseResults: [resultsDoc("wing"), resultsDoc("motorBike")] });
  await pair(page);
  await page.goto("/app/compare?a=wing&b=motorBike");
  await expect(page.getByText("Your engine can't compare runs yet")).toBeVisible();
  await expect(page.getByText(/speaks API 1\.24 or older/)).toBeVisible();
});
