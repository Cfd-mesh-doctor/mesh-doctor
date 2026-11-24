// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test, type Page } from "@playwright/test";
import { mockEngine, pairingLink, run } from "./engine";

/** Pairs with the pretend engine. */
async function pair(page: Page) {
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
}

const made = { "ahmed-coarse": "ahmed-body", "wheel-wing": "wheel-wing" };

test("the Solve screen lists the cases Mesh Doctor made with their solves, and solves one", async ({ page }) => {
  const solved = run("ahmed-coarse", {
    state: "done", step: "done", iteration: 2000, written: 2000, stretches: [{ from: 0, to: 2000 }],
    finished: new Date(Date.now() - 120_000).toISOString(),
  });
  const engine = await mockEngine(page, { made, runs: [solved], noJobs: true });
  await pair(page);
  await page.goto("/app/solve");
  const runs = page.getByRole("list", { name: "Runs" });
  await expect(runs.getByRole("listitem")).toHaveCount(2);
  // The one solved comes first, a link to its page; the other has Solve….
  await expect(runs.getByRole("listitem").first()).toContainText("Solved to iteration 2,000");
  await expect(runs.getByRole("link", { name: "ahmed-coarse" })).toHaveAttribute("href", "/app/solve/ahmed-coarse");
  await expect(runs.getByRole("listitem").last()).toContainText("Made from the wheel-wing template");

  await runs.getByRole("button", { name: "Solve wheel-wing" }).click();
  const dialog = page.getByRole("dialog", { name: "Solve wheel-wing" });
  await expect(dialog.getByLabel("Solve to iteration")).toHaveValue("2000");
  await expect(dialog.getByLabel("Processes")).toHaveValue("4");
  await dialog.getByLabel("Solve to iteration").fill("1500");
  await dialog.getByRole("button", { name: "Solve", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/solve\/wheel-wing$/);
  expect(engine.started).toEqual([{ kind: "solve", params: { name: "wheel-wing", to: 1500, np: 4 } }]);
  // Its job waits for its turn, and has written no run yet.
  await expect(page.getByRole("heading", { name: "wheel-wing", level: 1 })).toBeVisible();
  await expect(page.getByText("Starting", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Job details" })).toBeVisible();
});

test("a run's page follows its solve, stops it and continues it", async ({ page }) => {
  const engine = await mockEngine(page, { made, runs: [run("ahmed-coarse")], noJobs: true });
  await pair(page);
  await page.goto("/app/solve");
  await expect(page.getByRole("list", { name: "Runs" }).getByRole("progressbar", { name: "Progress of the solve of ahmed-coarse" }))
    .toHaveAttribute("aria-valuenow", "60");
  await page.getByRole("link", { name: "ahmed-coarse" }).click();
  await expect(page).toHaveURL(/\/app\/solve\/ahmed-coarse$/);

  await expect(page.getByText("Solving (foamRun)")).toBeVisible();
  await expect(page.getByText(/iteration 1,200 of 2,000 · 0\.42 s per iteration · about 5 min 36 s left/)).toBeVisible();
  await expect(page.getByRole("img", { name: "Initial residual of p per iteration, log scale" })).toBeVisible();
  await page.getByRole("radiogroup", { name: "Field" }).getByRole("radio", { name: "Ux" }).click();
  await expect(page.getByRole("img", { name: "Initial residual of Ux per iteration, log scale" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Downforce from body per iteration" })).toBeVisible();
  await page.getByRole("radiogroup", { name: "Force" }).getByRole("radio", { name: "Drag" }).click();
  await expect(page.getByRole("img", { name: "Drag from body per iteration" })).toBeVisible();
  await expect(page.getByText("not converged yet: the forces still drift")).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("Stopped at iteration 1,200")).toBeVisible();
  expect(engine.requests.some((r) => r.method() === "POST" && r.url().endsWith("/runs/ahmed-coarse/stop"))).toBe(true);
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  // Once it has ended, the engine's judge on the whole run.
  await expect(page.getByText("The judge on the whole run")).toBeVisible();
  await expect(page.getByText("converged", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Continue…" }).click();
  const dialog = page.getByRole("dialog", { name: "Continue ahmed-coarse" });
  await expect(dialog).toContainText("continues from iteration 1,200, the latest written, on the run's 4 processes");
  await expect(dialog.getByLabel("Solve to iteration")).toHaveValue("2200");
  await expect(dialog.getByLabel("Processes")).toHaveCount(0);
  await dialog.getByLabel("Solve to iteration").fill("1100");
  await expect(dialog.getByText(/Give one past 1,200/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
});

test("the demo has no solves, and says so", async ({ page }) => {
  await page.goto("/demo/solve");
  await expect(page.getByText("No case made with New case yet")).toBeVisible();
  await page.goto("/demo/solve/ahmed25-medium");
  await expect(page.getByText("The engine has no solve of this case.")).toBeVisible();
});
