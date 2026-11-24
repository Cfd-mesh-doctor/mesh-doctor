// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test, type Page } from "@playwright/test";
import { MATCHING, mockEngine, pairingLink, run } from "./engine";

/** Pairs with the pretend engine. */
async function pair(page: Page) {
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
}

const made = { "ahmed-coarse": { template: "ahmed-body" }, "wheel-wing": { template: "wheel-wing" } };

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

test("Verify install solves the coarse Ahmed body as the accuracy check did, and the screen follows it", async ({ page }) => {
  const engine = await mockEngine(page, { made: {}, runs: [], noJobs: true });
  await pair(page);
  await page.goto("/app/solve");
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Verify install", exact: true }) });
  await expect(card.getByText("meshdoctor solve verify-install --template ahmed-body --size coarse --to 2000 --np 6"))
    .toBeVisible();
  await card.getByRole("button", { name: "Verify install…" }).click();
  const dialog = page.getByRole("dialog", { name: "Verify install" });
  await expect(dialog.getByLabel("Name")).toHaveValue("verify-install");
  await expect(dialog.getByLabel("Processes")).toHaveValue("4");            // the 4 cores the engine's computer has
  await dialog.getByRole("button", { name: "Verify install", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/app\/solve$/);
  expect(engine.started).toEqual([{ kind: "solve", params: { name: "verify-install", template: "ahmed-body", size: "coarse",
    to: 2000, np: 4 } }]);
  await expect(card.getByText("Waiting to start")).toBeVisible();
  await expect(card.getByRole("link", { name: "verify-install" })).toHaveAttribute("href", "/app/solve/verify-install");
});

test("a Verify install solved to 2,000 gives the accuracy check's answer, drawn beside that check's run", async ({ page }) => {
  const solved = run("verify-install", {
    state: "done", step: "done", iteration: 2000, written: 2000, nProcs: 6, stretches: [{ from: 0, to: 2000 }],
    started: new Date(Date.now() - 900_000).toISOString(), finished: new Date(Date.now() - 30_000).toISOString(),
  });
  await mockEngine(page, { made: { "verify-install": { template: "ahmed-body" } }, runs: [solved], noJobs: true,
    validations: { "verify-install": MATCHING } });
  await pair(page);
  await page.goto("/app/solve");
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Verify install", exact: true }) });
  await expect(card.getByText("Same answer", { exact: true })).toBeVisible();
  await expect(card.getByText(/^Its drag is within 2 % of the accuracy check's run of the same mesh/)).toBeVisible();
  await expect(card.getByRole("img", { name: /^Drag coefficient of each case/ })).toHaveAttribute("aria-label",
    /Accuracy check, coarse mesh, 0\.299 against 0\.285 \(\+4\.8 %\); Your install, coarse mesh, 0\.299 against 0\.285/);
  await card.locator('[data-row="1"]').hover();
  await expect(card.getByText(/Cd 0\.299 against 0\.285 in the wind tunnel, \+4\.8 %\. Lift Cl 0\.298; drift over the last 500 iterations −0\.11 %; solved in 15 min with its mesh\./))
    .toBeVisible();
  await card.getByRole("link", { name: "The whole accuracy check" }).click();
  await expect(page).toHaveURL(/\/accuracy$/);
  await expect(page.getByRole("heading", { name: "Verify your install" })).toBeVisible();
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

test("a case you made is solved through a copy: the case, the copy's name, then its run's page", async ({ page }) => {
  const engine = await mockEngine(page, { made: { "wing-run": { copyOf: "wing" } }, runs: [], noJobs: true });
  await pair(page);
  await page.goto("/app/solve");
  const runs = page.getByRole("list", { name: "Runs" });
  await expect(runs.getByRole("listitem")).toContainText("A copy of wing");
  await page.getByRole("button", { name: "Solve a case you made…" }).click();
  const dialog = page.getByRole("dialog", { name: "Solve a copy of a case you made" });
  // Yours only, not the copy Mesh Doctor made; the name suggested is free.
  await expect(dialog.getByLabel("Case").getByRole("option")).toHaveText(["wing", "ahmed-25-coarse", "motorBike"]);
  await expect(dialog.getByLabel("Name of the copy")).toHaveValue("wing-run-2");
  await dialog.getByLabel("Case").selectOption("motorBike");
  await expect(dialog.getByLabel("Name of the copy")).toHaveValue("motorBike-run");
  await dialog.getByLabel("Name of the copy").fill("wing");
  await expect(dialog.getByText("A case with this name is in the cases folder already. Pick another name.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Solve a copy" })).toBeDisabled();
  await dialog.getByLabel("Name of the copy").fill("mb-run");
  await dialog.getByLabel("Processes").selectOption("2");
  await dialog.getByRole("button", { name: "Solve a copy" }).click();
  await expect(page).toHaveURL(/\/app\/solve\/mb-run$/);
  expect(engine.started).toEqual([{ kind: "solve", params: { name: "mb-run", source: "motorBike", to: 2000, np: 2 } }]);
  // Its job waits for its turn: the page says what it copies.
  await expect(page.getByRole("heading", { name: "mb-run", level: 1 })).toBeVisible();
  await expect(page.getByText("Solve · a copy of motorBike")).toBeVisible();
  await expect(page.getByText("Starting", { exact: true })).toBeVisible();
});

test("the demo has no solves, and says so", async ({ page }) => {
  await page.goto("/demo/solve");
  await expect(page.getByText("Nothing to solve here yet")).toBeVisible();
  await page.goto("/demo/solve/ahmed25-medium");
  await expect(page.getByText("The engine has no solve of this case.")).toBeVisible();
});
