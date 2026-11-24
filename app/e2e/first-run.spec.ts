// SPDX-License-Identifier: GPL-3.0-or-later
// Try it on the Ahmed body, against a pretend engine: Getting started leads to it, and each step is started there
// with the screens' own dialogs, set for the guide.
import { expect, test, type Page } from "@playwright/test";
import { mockEngine, pairingLink, run } from "./engine";

async function pair(page: Page) {
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
}

const step = (page: Page, title: string) =>
  page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, level: 3 }) });

test("Getting started leads to the guided first run, which starts with a coarse Ahmed case", async ({ page }) => {
  const engine = await mockEngine(page, { noJobs: true, runs: [] });
  await pair(page);
  await page.getByRole("link", { name: "try it on the Ahmed body" }).click();
  await expect(page).toHaveURL(/\/app\/first-run$/);
  await expect(page.getByRole("heading", { name: "Try it on the Ahmed body", level: 1 })).toBeVisible();
  await expect(page.getByText("1 of 6 done")).toBeVisible();
  await expect(step(page, "Check the engine's computer")).toContainText("Done");
  await step(page, "Make a coarse Ahmed case").getByRole("button", { name: "New case…" }).click();
  const dialog = page.getByRole("dialog", { name: "New case" });
  await expect(dialog.getByRole("combobox", { name: "Template" })).toHaveValue("ahmed-body");
  await expect(dialog.getByRole("radio", { name: "Coarse" })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByRole("textbox", { name: "Name of the new case" })).toHaveValue("ahmed-coarse");
  await dialog.getByRole("button", { name: "Make case" }).click();
  await expect.poll(() => engine.started).toEqual([
    { kind: "case", params: { template: "ahmed-body", size: "coarse", name: "ahmed-coarse", replace: false } },
  ]);
});

test("a solved Ahmed case is judged, then a copy of it repaired", async ({ page }) => {
  const solved = run("ahmed-coarse", {
    state: "done", step: "done", iteration: 1000, end: 1000, written: 1000, stretches: [{ from: 0, to: 1000 }],
    finished: new Date(Date.now() - 60_000).toISOString(),
  });
  await mockEngine(page, { made: { "ahmed-coarse": { template: "ahmed-body" } }, runs: [solved], noJobs: true });
  await pair(page);
  await page.goto("/app/first-run");
  await expect(page.getByText("4 of 6 done")).toBeVisible();
  await expect(step(page, "Read the judge's verdict")).toContainText("The judge says converged.");
  await step(page, "Repair a copy of it").getByRole("button", { name: "Repair a copy…" }).click();
  await expect(page.getByRole("dialog").getByLabel("Case")).toHaveValue("ahmed-coarse");
});
