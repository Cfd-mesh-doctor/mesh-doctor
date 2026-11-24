// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";
import { mockEngine, pairingLink } from "./engine";

test("the demo's A/B tests: the sidebar opens the list, a finished test has its outcome, chart and judges", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("complementary").getByRole("link", { name: "A/B tests" }).click();
  await expect(page).toHaveURL(/\/demo\/abtests$/);
  await expect(page.getByRole("heading", { level: 1, name: "A/B tests" })).toBeVisible();
  const rows = page.getByRole("row");
  await expect(rows.nth(1)).toContainText("ahmed25-medium-fix");
  await expect(rows.nth(1)).toContainText("Running");
  await expect(rows.nth(2)).toContainText("1.00× about the same");

  await page.getByRole("link", { name: "Open the A/B test of ahmed25-coarse-fix" }).click();
  await expect(page).toHaveURL(/\/demo\/abtests\/ahmed25-coarse-fix$/);
  await expect(page.getByText("About the same on both meshes")).toBeVisible();
  await expect(page.getByRole("row", { name: /^p 0\.0127 0\.0127 1\.00×/ })).toBeVisible();
  const chart = page.getByRole("img", { name: /Initial residual of p per iteration/ });
  await expect(chart).toBeVisible();
  await page.getByRole("radio", { name: "omega" }).click();
  await expect(page.getByRole("img", { name: /Initial residual of omega per iteration/ })).toBeVisible();
  await expect(page.getByText("Is the original-mesh run converged?")).toBeVisible();
  await expect(page.getByText("Is the repaired-mesh run converged?")).toBeVisible();

  // Its repair's report, and back to this test from there.
  await page.getByRole("link", { name: "Repair report" }).click();
  await expect(page).toHaveURL(/\/demo\/repairs\/ahmed25-coarse-fix\/report$/);
  await page.getByRole("link", { name: "A/B test", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/abtests\/ahmed25-coarse-fix$/);
});

test("the demo's running A/B test shows its step, its progress and its first run, and says it has no live data", async ({ page }) => {
  await page.goto("/demo/abtests");
  await page.getByRole("link", { name: "Follow the A/B test of ahmed25-medium-fix" }).click();
  await expect(page.getByText("Solving on the repaired mesh")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await expect(page.getByText(/The demo recorded no live solver data/)).toBeVisible();
  await expect(page.getByRole("img", { name: /Initial residual of p per iteration/ })).toBeVisible();
  await expect(page.getByText("Did it help the solver?")).toHaveCount(0);
  // Cancelling its job on the Jobs screen shows here as cancelled (in the same visit: the demo forgets it on a reload).
  await page.getByRole("link", { name: "Job details" }).click();
  await expect(page).toHaveURL(/\/demo\/jobs\?job=/);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel job" }).click();
  await page.getByRole("dialog", { name: "Cancel ahmed25-medium-fix?" }).getByRole("button", { name: "Cancel job" }).click();
  await expect(page.getByRole("dialog", { name: "Cancel ahmed25-medium-fix?" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("complementary").getByRole("link", { name: "A/B tests" }).click();
  await page.getByRole("link", { name: "Open the A/B test of ahmed25-medium-fix" }).click();
  await expect(page.getByRole("heading", { name: "Cancelled" })).toBeVisible();
  await expect(page.getByText(/Stopped by request/)).toBeVisible();
});

test("Start an A/B test opens its dialog, which in the demo gives the command instead of starting it", async ({ page }) => {
  await page.goto("/demo/abtests");
  const opener = page.getByRole("button", { name: "Start an A/B test" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Start an A/B test" });
  await expect(dialog.getByRole("combobox", { name: "Repair run" })).toHaveValue("ahmed25-fine-fix"); // the first with no test
  await expect(dialog).toContainText("The demo can't start jobs.");
  await expect(dialog).toContainText("About 17 min in all on 6 solver ranks.");
  await expect(dialog.getByText("meshdoctor ab ahmed-25-fine ahmed25-fine-fix", { exact: true })).toBeVisible();
  await dialog.getByRole("textbox", { name: "Iterations" }).fill("500");
  await dialog.getByRole("combobox", { name: "Second run" }).selectOption("lts");
  await expect(dialog).toContainText("The test is called ahmed-25-fine_lts.");
  await expect(dialog.getByText("meshdoctor ab ahmed-25-fine - --iters 500 --variant lts", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Start A/B test" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused(); // back where it was opened
});

test("a finished test's Run longer continues its second run: in the demo, with the command", async ({ page }) => {
  await page.goto("/demo/abtests/ahmed25-coarse-fix");
  await page.getByRole("button", { name: "Run longer" }).click();
  const dialog = page.getByRole("dialog", { name: "Run ahmed25-coarse-fix longer" });
  const target = dialog.getByRole("textbox", { name: "Continue to iteration" });
  await expect(target).toHaveValue("400");
  await expect(dialog.getByText("meshdoctor ab extend ahmed25-coarse-fix 400", { exact: true })).toBeVisible();
  await target.fill("1000");
  await expect(dialog).toContainText("Solves 800 more iterations on the second run's copy, about 5 min");
  await expect(dialog.getByText("meshdoctor ab extend ahmed25-coarse-fix 1000", { exact: true })).toBeVisible();
});

/** A finished A/B test of solver settings on case wing, 200 iterations a run: the original mesh with the case's
 * settings, then with lts'. Its residuals are made up: they fall, the second run's faster. */
function settingsTest() {
  const rows = (rate: number) => Array.from({ length: 200 }, (_, i) => {
    const r = (f: number) => Number((f * Math.exp(-rate * i) * (1 + 0.2 * Math.sin(i / 4)) + 1e-5).toPrecision(4));
    return [i + 1, r(0.6), r(0.3)];
  });
  return {
    status: { step: "done", time: "2026-11-23 12:00:00" },
    result: {
      schemaVersion: "1.0", source: "cases/wing", fixedName: null, variant: "lts", label: "wing_lts", iters: 200, nProcs: 4,
      init: "0", window: 50, started: "2026-11-23 11:00:00", finished: "2026-11-23 12:00:00",
      base: { residuals: { p: { mean: 0.004, median: 0.004 }, Ux: { mean: 0.002, median: 0.002 } }, secondsPerIteration: 0.42 },
      fixed: { residuals: { p: { mean: 0.0011, median: 0.0011 }, Ux: { mean: 0.0008, median: 0.0008 } }, secondsPerIteration: 0.47 },
      residualRatioFixedOverBase: { p: 0.28, Ux: 0.4 },
    },
    live: { base: { cols: ["Time", "p", "Ux"], rows: rows(0.02) }, fixed: { cols: ["Time", "p", "Ux"], rows: rows(0.03) } },
    modes: [],
  };
}

test("on your own engine, a test of solver settings reads as the case's settings against the variant's", async ({ page }) => {
  await mockEngine(page, { noJobs: true, abtests: { wing_lts: settingsTest() } });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await page.getByRole("complementary").getByRole("link", { name: "A/B tests" }).click();
  const row = page.getByRole("row", { name: /wing_lts/ });
  await expect(row).toContainText("wing · lts settings");
  await expect(page.getByRole("columnheader", { name: "Second run ÷ first" })).toBeVisible();
  await row.getByRole("link", { name: "wing_lts", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/abtests\/wing_lts$/);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "The lts settings helped the solver" })).toBeVisible();
  await expect(main.getByText(/^With lts settings the residuals end at 0\.33× those with the case's settings/)).toBeVisible();
  await expect(main.getByRole("columnheader", { name: "lts ÷ case's" })).toBeVisible();
  await expect(main.getByText("Is the run with lts settings converged?", { exact: true })).toBeVisible();
  await expect(main.getByText(/repaired/i)).toHaveCount(0);
});

test("on your own engine, Start A/B test starts the job, whose test's page and Jobs follow it", async ({ page }) => {
  const engine = await mockEngine(page, {
    noJobs: true,
    repairs: [{
      name: "wing-fix", finished: "2026-11-23 10:00:00", nCells: 2_000_000, profile: "openfoam", source: "cases/wing", status: {},
      verdict: { improved: ["maxNonOrtho"], regressions: [], unchanged: [] },
    }],
  });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await page.getByRole("complementary").getByRole("link", { name: "A/B tests" }).click();
  await expect(page.getByRole("heading", { name: "No A/B tests yet" })).toBeVisible();
  await page.getByRole("button", { name: "Start an A/B test" }).click();
  const dialog = page.getByRole("dialog", { name: "Start an A/B test" });
  await expect(dialog.getByRole("combobox", { name: "Repair run" })).toHaveValue("wing-fix");
  // 2 M cells, 200 iterations a run on the laptop's 4 cores.
  await expect(dialog).toContainText("Solves wing twice, 200 iterations each: on the original mesh, then on the repaired mesh of "
    + "wing-fix. About 32 min in all on 4 solver ranks.");
  await expect(dialog).toContainText("Needs about 3.5 GB of memory; your engine's computer has 15.6 GB.");
  await expect(dialog).toContainText(
    "The test needs about 484 MB of disk space; the disk the engine's workspace is on has 393 GB free.");
  await dialog.getByRole("button", { name: "Start A/B test" }).click();
  await expect(page).toHaveURL(/\/app\/abtests\/wing-fix$/);
  expect(engine.started).toEqual([{ kind: "abtest", params: { name: "wing-fix", iters: 200, init: "auto", variant: "", replace: false } }]);
  // The job hasn't made the test's folder: the pretend engine never does, so the page waits for it.
  await expect(page.getByText("Starting", { exact: true })).toBeVisible();
  await expect(page.getByText("Its job is waiting to start")).toBeVisible();
  await page.getByRole("link", { name: "Job details" }).click();
  await expect(page).toHaveURL(/\/app\/jobs\?job=20261123-120000-abtest-wing-fix-e2e1$/);
  const details = page.getByRole("dialog", { name: "wing-fix" });
  await details.getByRole("link", { name: "Open A/B test" }).click();
  await expect(page).toHaveURL(/\/app\/abtests\/wing-fix$/);
});
