// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test, type Page } from "@playwright/test";
import { MATCHING, mockEngine, pairingLink, PLAN, run, transientRun } from "./engine";

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
  // its new case, the coarse mesh with its sets, and its solve on 4 processes (API 1.13): 68 + 215 MB
  await expect(dialog).toContainText(
    "Its mesh and its solve need about 283 MB of disk space; the disk the cases are on has 393 GB free.");
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
  // Its run's page, linked beside the comparison, says the same once it has ended.
  await expect(card).toContainText(
    "verify-install solved to iteration 2,000. Its page shows its residuals and forces, and this comparison too.");
  await card.getByRole("link", { name: "verify-install", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/solve\/verify-install$/);
  const there = page.locator("section").filter({ has: page.getByRole("heading", { name: "Against the accuracy check", exact: true }) });
  await expect(there.getByText("Same answer", { exact: true })).toBeVisible();
  await expect(there.getByText(/^Verify install's answer: its drag against the accuracy check's run of the same mesh/)).toBeVisible();
  await expect(there.getByRole("img", { name: /^Drag coefficient of each case/ })).toHaveAttribute("aria-label",
    /Accuracy check, coarse mesh, 0\.299 against 0\.285 \(\+4\.8 %\); Your install, coarse mesh, 0\.299 against 0\.285/);
  await there.locator('[data-row="1"]').hover();
  await expect(there.getByText(/drift over the last 500 iterations −0\.11 %; solved in 15 min with its mesh\./)).toBeVisible();
  await there.getByRole("link", { name: "The whole accuracy check" }).click();
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

/** ahmed-coarse solved to 300 on 6 processes, as the plan's run was. */
const solved300 = () => run("ahmed-coarse", { state: "done", step: "done", iteration: 300, end: 300, written: 300,
  nProcs: 6, stretches: [{ from: 0, to: 300 }], finished: new Date().toISOString() });
const KINDS = ["repair", "abtest", "abextend", "case", "solve", "tplan"];

test("a solved run's page plans a transient run of it as a job, and follows the job", async ({ page }) => {
  const engine = await mockEngine(page, { made, runs: [solved300()], noJobs: true, kinds: KINDS });
  await pair(page);
  await page.goto("/app/solve/ahmed-coarse");
  await expect(page.getByRole("heading", { name: "Plan a transient run" })).toBeVisible();
  await expect(page.getByText("It reads the result and doesn't solve: about 2 s for half a million cells.")).toBeVisible();
  await page.getByRole("button", { name: "Plan a transient run" }).click();
  await expect(page.getByText(/^Waiting to start: OpenFOAM works out each cell's Courant number/)).toBeVisible();
  expect(engine.started).toEqual([{ kind: "tplan", params: { name: "ahmed-coarse" } }]);
  await expect(page.getByRole("progressbar", { name: "Planning a transient run of ahmed-coarse" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan a transient run" })).toBeDisabled();
  await page.getByRole("link", { name: "Its job" }).click();
  await expect(page).toHaveURL(/\/app\/jobs\?job=20261123-120000-tplan-ahmed-coarse-e2e1$/);
});

test("a run's transient plan: the time step at each Courant number, its cost, and the cells that set it", async ({ page }) => {
  await mockEngine(page, { made, runs: [solved300()], noJobs: true, kinds: KINDS, tplans: { "ahmed-coarse": PLAN } });
  await pair(page);
  await page.goto("/app/solve/ahmed-coarse");
  await expect(page.getByText("At a largest Courant number of 1, which DES and LES need, the time step is 18 µs: 11,369 "
    + "steps for 0.21 s of flow (8 body lengths), about 3.8 h on 6 processes.")).toBeVisible();
  const table = page.getByRole("table", { name: "The time step and time of a transient run at each largest Courant number" });
  await expect(table.getByRole("row").nth(1).getByRole("cell")).toHaveText(["1", "18 µs", "11,369", "3.8 h", "40 µs, 1.7 h"]);
  await expect(table.getByRole("row").nth(3).getByRole("cell")).toHaveText(["20", "370 µs", "569", "11 min", "810 µs, 5 min"]);
  await expect(page.getByText(/^62 cells of 478,901 are within 2× of the largest Courant number/)).toBeVisible();
  await expect(page.getByText("38 cells near (−0.0635, 0.18, 0.322) m, about 2.6 mm across and 2.4 mm from the wall "
    + "ahmed, where the flow is up to 55 m/s")).toBeVisible();
  await expect(page.getByText(/^The 100 fastest are saved as the cell set fastestCells in the workspace/)).toHaveText(
    "The 100 fastest are saved as the cell set fastestCells in the workspace (.tplans/ahmed-coarse.sets, laid out as "
    + "the case is: for its whole mesh and for each of its 6 processes): copy its folders into the case to see them in "
    + "paraFoam (Include Sets) or pick them with topoSet.");
  await expect(page.getByText("Planned from iteration 300 of this run, in 2 s.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan again" })).toBeEnabled();
});

test("an engine from before the transient plan says to update it, and plans nothing", async ({ page }) => {
  const engine = await mockEngine(page, { made, runs: [solved300()], noJobs: true });
  await pair(page);
  await page.goto("/app/solve/ahmed-coarse");
  await expect(page.getByText(/^Your engine is older than this page and can't plan a transient run from here yet/))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "Plan a transient run" })).toBeDisabled();
  expect(engine.requests.some((r) => r.url().includes("/tplans/"))).toBe(false);
});

test("a solved run's plan starts a transient run of it, as a new case, and its page follows the job", async ({ page }) => {
  const engine = await mockEngine(page, { made, runs: [solved300()], noJobs: true, kinds: KINDS, tplans: { "ahmed-coarse": PLAN } });
  await pair(page);
  await page.goto("/app/solve/ahmed-coarse");
  await page.getByRole("button", { name: "Start a transient run…" }).click();
  const dialog = page.getByRole("dialog", { name: "Start a transient run of ahmed-coarse" });
  await expect(dialog).toContainText("makes a new case of ahmed-coarse's mesh, settings and latest result (iteration 300)");
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("ahmed-coarse-ddes");
  await expect(dialog.getByRole("radio", { name: "DDES" })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByLabel("Largest Courant number")).toHaveValue("1");
  // This computer has 4 cores: the plan's hours on its 6 processes, and on the 4 it can give.
  await expect(dialog.getByText("At 1 the plan's time step is 18 µs: 11,369 steps to 0.2088 s, about 3.8 h on its 6 "
    + "processes (about 5.7 h on 4 processes, if it splits as evenly).")).toBeVisible();
  await expect(dialog.getByLabel("Solve to (s)")).toHaveValue("0.2088");
  await expect(dialog.getByText("8 flow times over the body (8 L/U: 1.044 m at 40 m/s), which the plan's hours are for."))
    .toBeVisible();
  await expect(dialog.getByLabel("Processes")).toHaveValue("4");
  // The new case, then what its solve writes with its averaged flow, on the disk the cases are on.
  await expect(dialog).toContainText(
    "The transient run and its solve need about 548 MB of disk space; the disk the cases are on has 393 GB free.");
  await dialog.getByLabel("Largest Courant number").fill("3");
  await expect(dialog.getByText("DDES resolves the wake's eddies, which needs about 1: give 2 or less, or pick URANS."))
    .toBeVisible();
  await expect(dialog.getByRole("button", { name: "Start the transient run" })).toBeDisabled();
  // URANS takes the 3 typed, under its own name.
  await dialog.getByRole("radio", { name: "URANS" }).click();
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("ahmed-coarse-urans");
  await expect(dialog.getByLabel("Largest Courant number")).toHaveValue("3");
  await dialog.getByLabel("Solve to (s)").fill("0.1");
  await expect(dialog.getByText(/^At 3 the plan's time step is 55 µs: 1,815 steps to 0\.1 s, about/)).toBeVisible();
  await dialog.getByRole("button", { name: "Start the transient run" }).click();
  await expect(page).toHaveURL(/\/app\/solve\/ahmed-coarse-urans$/);
  expect(engine.started).toEqual([{ kind: "solve", params: {
    name: "ahmed-coarse-urans", steady: "ahmed-coarse", maxCo: 3, model: "URANS", to: 0.1, np: 4 } }]);
  // Its job waits for its turn: the page says what it is a transient run of.
  await expect(page.getByRole("heading", { name: "ahmed-coarse-urans", level: 1 })).toBeVisible();
  await expect(page.getByText("Solve · a transient run of ahmed-coarse")).toBeVisible();
  await expect(page.getByText("Starting", { exact: true })).toBeVisible();
});

test("a transient run's page follows it in seconds with the transient judge, stops it and continues it", async ({ page }) => {
  const engine = await mockEngine(page, {
    made: { ...made, "ahmed-coarse-ddes": { transientOf: "ahmed-coarse" } },
    runs: [solved300(), transientRun("ahmed-coarse-ddes")], noJobs: true, kinds: KINDS,
  });
  await pair(page);
  await page.goto("/app/solve");
  const runs = page.getByRole("list", { name: "Runs" });
  await expect(runs.getByRole("listitem").filter({ hasText: "ahmed-coarse-ddes" }))
    .toContainText("0.0005 s of 0.001 s (a transient run of ahmed-coarse)");
  // The steady run's page lists the transient runs made of it.
  await runs.getByRole("link", { name: "ahmed-coarse", exact: true }).click();
  await expect(page.getByText(/^Transient run of it:/)).toBeVisible();
  await page.getByRole("link", { name: "ahmed-coarse-ddes" }).click();
  await expect(page).toHaveURL(/\/app\/solve\/ahmed-coarse-ddes$/);

  await expect(page.getByText("Solve · a transient run of ahmed-coarse · to 0.001 s")).toBeVisible();
  await expect(page.getByText(/0\.0005 s of 0\.001 s · time step 20 µs · 1\.40 s per time step · about 35 s left/)).toBeVisible();
  await expect(page.getByText("Written to 0.00025 s, on 4 processes.")).toBeVisible();
  await expect(page.getByText("A transient run of ahmed-coarse: DDES at a largest Courant number of 1, from "
    + "ahmed-coarse's iteration 300.")).toBeVisible();
  await expect(page.getByText("It averages its flow once its forces have settled: they haven't yet.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Initial residual of p per time step, log scale" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Downforce from body over time" })).toBeVisible();
  await expect(page.getByText("Judged over the last 12 time steps, flow along +x, z up")).toBeVisible();
  await expect(page.getByText("still developing (force means still drifting; average later)")).toBeVisible();
  await expect(page.getByText("Its forces haven't settled yet: the means are over the last two windows.")).toBeVisible();
  // Its time step and Courant number at each time step
  await expect(page.getByRole("img", { name: "Time step over time, in µs" })).toBeVisible();
  await page.getByRole("radiogroup", { name: "Show" }).getByRole("radio", { name: "Courant number" }).click();
  await expect(page.getByRole("img", { name: "Largest and mean Courant number over time" })).toBeVisible();

  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("heading", { name: "Stopped at 0.0005 s" })).toBeVisible();
  await expect(page.getByText("Its flow isn't averaged: it ended before averaging began, which waits for its forces "
    + "to settle. Continue it, and it averages once they have.")).toBeVisible();
  // Once it has ended, still the transient judge, in time steps: not GET /judge's, over 200 iterations.
  await expect(page.getByText("The judge on the whole run")).toBeVisible();
  await expect(page.getByText("converged (statistically stationary, every time step converged)")).toBeVisible();
  await expect(page.getByText("The means are from 0.0001 s on, when its forces settled.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Downforce from body over time" }).getByText("averaged")).toBeVisible();
  expect(engine.requests.some((r) => r.url().includes("/judge?case=ahmed-coarse-ddes"))).toBe(false);
  await expect(page.getByRole("heading", { name: "Plan a transient run" })).toHaveCount(0);

  await page.getByRole("button", { name: "Continue…" }).click();
  const dialog = page.getByRole("dialog", { name: "Continue ahmed-coarse-ddes" });
  await expect(dialog).toContainText("The transient run continues from 0.0005 s, the latest time written, on the run's 4 "
    + "processes, to the time you give");
  await expect(dialog.getByLabel("Solve to (s)")).toHaveValue("0.001");
  await dialog.getByLabel("Solve to (s)").fill("0.0004");
  await expect(dialog.getByText("Give one past 0.0005 s, the latest time written: the run continues from there.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  await dialog.getByLabel("Solve to (s)").fill("0.002");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => engine.started).toEqual([{ kind: "solve", params: { name: "ahmed-coarse-ddes", to: 0.002 } }]);
});

test("at API 1.10 a transient run writes the times asked for each stretch, keeps each one, and says which", async ({ page }) => {
  const kept = transientRun("ahmed-coarse-ddes", { state: "stopped", step: "done", iteration: 0.0004, written: 0.0004,
    stretches: [{ from: 0, to: 0.0004 }], finished: new Date().toISOString(),
    transient: { steady: "ahmed-coarse", at: "300", maxCo: 1, model: "DDES", writes: 4 },
    times: [0.0001, 0.0002, 0.0003, 0.0004], joined: [0.0004] });
  const engine = await mockEngine(page, {
    made: { ...made, "ahmed-coarse-ddes": { transientOf: "ahmed-coarse" } },
    runs: [solved300(), kept], noJobs: true, kinds: KINDS, tplans: { "ahmed-coarse": PLAN },
  });
  engine.apiVersion = "1.10";
  await pair(page);
  const each = "each kept: the flow at that time, with its mean once it averages it, for pictures of the flow over time.";
  // A new transient run of the steady run: 16 times a stretch, which the disk guard counts
  await page.goto("/app/solve/ahmed-coarse");
  await page.getByRole("button", { name: "Start a transient run…" }).click();
  const start = page.getByRole("dialog", { name: "Start a transient run of ahmed-coarse" });
  await expect(start).toContainText("It writes the times you ask for on the way, and keeps each one;");
  await expect(start.getByLabel("Times written")).toHaveValue("4");
  await expect(start.getByText(`Every 0.0522 s, ${each}`)).toBeVisible();
  await expect(start).toContainText("The transient run and its solve need about 548 MB of disk space");
  await start.getByLabel("Times written").fill("16");
  await expect(start.getByText(`Every 0.01305 s, ${each}`)).toBeVisible();
  await expect(start).toContainText("The transient run and its solve need about 1.5 GB of disk space; the disk the cases "
    + "are on has 393 GB free.");
  await start.getByLabel("Times written").fill("0");
  await expect(start.getByText("Give a whole number from 1 to 200.")).toBeVisible();
  await expect(start.getByRole("button", { name: "Start the transient run" })).toBeDisabled();
  await start.getByRole("button", { name: "Cancel" }).click();

  // The transient run's page: the times it keeps, one of them joined
  await page.goto("/app/solve/ahmed-coarse-ddes");
  await expect(page.getByText("It keeps 4 written times, from 0.0001 s to 0.0004 s; it writes 4 times a stretch. 1 of "
    + "them is joined, the others split on its processes: paraFoam opens them all as a Decomposed Case.")).toBeVisible();
  // Continued with 12 a stretch, from then on
  await page.getByRole("button", { name: "Continue…" }).click();
  const dialog = page.getByRole("dialog", { name: "Continue ahmed-coarse-ddes" });
  await expect(dialog).toContainText("writing the times you ask for on the way, each kept.");
  await expect(dialog.getByLabel("Times written")).toHaveValue("4");                        // its own
  await expect(dialog.getByText(`Every 0.00015 s, ${each}`)).toBeVisible();
  await expect(dialog).toContainText("The continuation needs about 39 MB of disk space");
  await dialog.getByLabel("Times written").fill("12");
  await expect(dialog.getByText(`Every 0.00005 s, ${each}`)).toBeVisible();
  await expect(dialog).toContainText("The continuation needs about 199 MB of disk space");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => engine.started).toEqual([{ kind: "solve", params: { name: "ahmed-coarse-ddes", to: 0.001,
    writes: 12 } }]);
  expect(engine.requests.some((r) => r.url().includes("/disk?case=ahmed-coarse-ddes&writes=12"))).toBe(true);
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
  // What the copy and its solve take on the disk, and the free space there.
  await expect(dialog).toContainText(
    "The copy and its solve need about 277 MB of disk space; the disk the cases are on has 393 GB free.");
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

test("the Cases screen plans a transient run of a case you made that has a result", async ({ page }) => {
  await mockEngine(page, { results: { motorBike: "300", wing: null }, noJobs: true,
    kinds: ["repair", "case", "solve", "tplan"], tplans: { motorBike: { ...PLAN, case: "motorBike" } } });
  await pair(page);
  await page.goto("/app/cases");
  await page.getByRole("button", { name: "Plan a transient run of motorBike" }).click();
  const dialog = page.getByRole("dialog", { name: "Plan a transient run of motorBike" });
  await expect(dialog.getByText(/^From its result at time 300: the time step a transient run would need/)).toBeVisible();
  await expect(dialog.getByRole("table", { name: /^The time step and time of a transient run/ })).toBeVisible();
  await expect(dialog.getByText(/^Planned from its result at time 300/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Plan again" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  // A case with no result yet has none to plan from.
  await expect(page.getByRole("button", { name: "Plan a transient run of wing" })).toHaveCount(0);
});
