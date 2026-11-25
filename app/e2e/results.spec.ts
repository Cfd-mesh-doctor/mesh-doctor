// SPDX-License-Identifier: GPL-3.0-or-later
// The Results screen in a real browser: the demo's recorded case from the sidebar, its headline numbers, its force
// charts and its own page, which says the demo can't average over another window; with your own engine, the cases'
// results asked for with the pairing key, newest first, and another window averaged, kept in the address and undone
// with Back, and one asked for from the charts, by a key and by dragging an edge of the window.
import { expect, test, type Page } from "@playwright/test";
import { KEY, mockEngine, pairingLink, resultsDoc } from "./engine";

/** Pairs with the pretend engine. */
async function pair(page: Page) {
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
}

test("the demo's results: the sidebar opens them, its case's page has its numbers, and no other window", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("complementary").getByRole("link", { name: "Results" }).click();
  await expect(page).toHaveURL(/\/demo\/results$/);
  await expect(page.getByRole("heading", { level: 1, name: "Results" })).toBeVisible();
  const row = page.getByRole("row", { name: /ahmed-25-coarse/ });
  await expect(row).toContainText("Steady · iterations 0 to 2,000 · 479 k cells");
  await expect(row).toContainText("16.12");
  await expect(row).toContainText("not converged (plateau/oscillation)");

  await row.getByRole("link", { name: "ahmed-25-coarse", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/results\/ahmed-25-coarse$/);
  await expect(page.getByRole("heading", { level: 1, name: "ahmed-25-coarse" })).toBeVisible();
  await expect(page.getByText("Averaged over the judge's window: after iteration 1,600, up to 2,000 (400 values)")).toBeVisible();
  await expect(page.getByRole("note")).toContainText("symmetry plane");
  await expect(page.getByText("16.12 N")).toBeVisible();
  await expect(page.getByRole("img", { name: "Drag of forceCoeffs over the run, in N" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Lift of forceCoeffs over the run, in N" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Start of the averaged part" }).first()).toHaveAttribute("aria-valuenow", "1600");

  await page.getByLabel("From (iteration)").fill("1000");
  await page.getByRole("button", { name: "Average" }).click();
  await expect(page).toHaveURL(/\/demo\/results\/ahmed-25-coarse\?from=1000$/);
  await expect(page.getByText("Not in the demo")).toBeVisible();
  await page.getByRole("button", { name: "The judge's window" }).click();
  await expect(page).toHaveURL(/\/demo\/results\/ahmed-25-coarse$/);
  await expect(page.getByText("16.12 N")).toBeVisible();
});

test("with your own engine, the results come with the key, and another window is averaged and undone with Back", async ({ page }) => {
  const older = new Date(Date.now() - 7_200_000).toISOString();
  const engine = await mockEngine(page, { caseResults: [resultsDoc("wing"), resultsDoc("motorBike", { updated: older })] });
  await pair(page);
  await page.getByRole("complementary").getByRole("link", { name: "Results" }).click();
  const rows = page.getByRole("row");
  await expect(rows.nth(1)).toContainText("wing");
  await expect(rows.nth(2)).toContainText("motorBike");
  await expect(rows.nth(1)).toContainText("converged (steady)");

  await page.getByRole("link", { name: "wing", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/results\/wing$/);
  await page.getByLabel("From (iteration)").fill("1000");
  await page.getByLabel("From (iteration)").press("Enter");
  await expect(page).toHaveURL(/\/app\/results\/wing\?from=1000$/);
  await expect(page.getByText("Averaged over the window asked for: after iteration 1,000, up to 2,000 (1,000 values)")).toBeVisible();
  await expect(page.getByText("20 N", { exact: true })).toBeVisible();
  const asked = engine.requests.filter((r) => new URL(r.url()).pathname.startsWith("/api/v1/results") && r.method() === "GET");
  expect(asked.map((r) => new URL(r.url()).search)).toContain("?from=1000");
  expect(asked.every((r) => r.headers()["x-md-key"] === KEY)).toBe(true);

  await page.goBack();
  await expect(page).toHaveURL(/\/app\/results\/wing$/);
  await expect(page.getByText("Averaged over the judge's window: after iteration 1,600, up to 2,000 (400 values)")).toBeVisible();
  await expect(page.getByLabel("From (iteration)")).toHaveValue("");

  // from the charts: Shift and an arrow move the window's start a tenth of the run earlier, letting go asks for it
  const start = page.getByRole("slider", { name: "Start of the averaged part" }).first();
  await expect(start).toHaveAttribute("aria-valuenow", "1600");
  await start.focus();
  await start.press("Shift+ArrowLeft");
  await expect(page).toHaveURL(/\/app\/results\/wing\?from=1400$/);
  await expect(page.getByText("Averaged over the window asked for: after iteration 1,400, up to 2,000 (600 values)")).toBeVisible();
  // and its end dragged left, to an iteration of the history's, every 10th
  const end = page.getByRole("slider", { name: "End of the averaged part" }).first();
  await end.scrollIntoViewIfNeeded();
  const box = (await end.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page).toHaveURL(/\/app\/results\/wing\?from=1400&to=1\d\d0$/);
  await expect(page.getByText(/Averaged over the window asked for: after iteration 1,400, up to 1,\d\d0/)).toBeVisible();
  await expect(page.getByLabel("To (iteration)")).toHaveValue(/^1\d\d0$/);
});
