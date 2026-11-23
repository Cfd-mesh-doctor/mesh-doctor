// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test, type Page } from "@playwright/test";
import { mockEngine, pairingLink } from "./engine";

/** Pairs with the pretend engine, then opens a case's repair dialog on the Cases screen. */
async function repairDialog(page: Page, kase: string) {
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await page.goto("/app/cases");
  await page.getByRole("button", { name: `Repair ${kase}` }).click();
  return page.getByRole("dialog", { name: `Repair ${kase}` });
}

test("the sidebar's Repairs opens every repair run, and a run its report", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("complementary").getByRole("link", { name: /^Repairs/ }).click();
  await expect(page).toHaveURL(/\/demo\/repairs$/);
  await expect(page.getByRole("heading", { name: "Repairs", level: 1 })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(7); // its head and the demo's six runs

  await page.getByRole("radiogroup", { name: "Show repair runs" }).getByRole("radio", { name: /^Worse/ }).click();
  await expect(page).toHaveURL(/\/demo\/repairs\?show=worse$/);
  await expect(page.getByRole("row")).toHaveCount(2);

  await page.getByRole("link", { name: "pitzdaily-fix", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/repairs\/pitzdaily-fix\/report$/);
  await expect(page.getByRole("heading", { name: "pitzdaily-fix", level: 1 })).toBeVisible();
});

test("a cancelled repair's run leads to its job's details", async ({ page }) => {
  await page.goto("/demo/repairs?show=unfinished");
  await page.getByRole("link", { name: "ahmed25-fine-strict", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/jobs\?job=20261121-130141-repair-ahmed25-fine-strict-0266$/);
  await expect(page.getByRole("dialog", { name: "ahmed25-fine-strict" })).toBeVisible();
});

test("the Overview's Repair runs card leads to every run", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("link", { name: "All repairs" }).click();
  await expect(page).toHaveURL(/\/demo\/repairs$/);
  await expect(page.getByRole("heading", { name: "Repairs", level: 1 })).toBeVisible();
});

test("a case's Repair button opens the repair dialog, which in the demo gives the command instead of starting it", async ({ page }) => {
  await page.goto("/demo/cases");
  await page.getByRole("button", { name: "Repair pitzDaily" }).click();
  const dialog = page.getByRole("dialog", { name: "Repair pitzDaily" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Case" })).toHaveValue("pitzDaily");
  await expect(dialog.getByRole("textbox", { name: "Name of the new run" })).toHaveValue("pitzDaily-fix");
  await expect(dialog).toContainText("The demo can't start jobs.");
  await dialog.getByRole("radio", { name: "Strict" }).click();
  await expect(dialog.getByText("meshdoctor full pitzDaily pitzDaily-fix --profile strict")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Start repair" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Repair pitzDaily" })).toBeFocused(); // back where it was opened
});

test("New repair on the Repairs screen opens the dialog with a case to pick", async ({ page }) => {
  await page.goto("/demo/repairs");
  await page.getByRole("button", { name: "New repair" }).click();
  const dialog = page.getByRole("dialog", { name: "Start a repair" });
  await dialog.getByRole("combobox", { name: "Case" }).selectOption("ahmed-35-medium");
  await expect(dialog.getByRole("textbox", { name: "Name of the new run" })).toHaveValue("ahmed-35-medium-fix");
  await expect(dialog.getByText("meshdoctor full ahmed-35-medium ahmed-35-medium-fix", { exact: true })).toBeVisible();
});

test("on your own engine, Start repair starts the job and opens its details on the Jobs screen", async ({ page }) => {
  const engine = await mockEngine(page, { noJobs: true });
  const dialog = await repairDialog(page, "wing");
  await expect(dialog.getByRole("textbox", { name: "Name of the new run" })).toHaveValue("wing-fix");
  await dialog.getByRole("button", { name: "Start repair" }).click();
  await expect(page).toHaveURL(/\/app\/jobs\?job=20261123-120000-repair-wing-fix-e2e1$/);
  await expect(page.getByRole("dialog", { name: "wing-fix" })).toBeVisible();
  expect(engine.started).toEqual([{ kind: "repair", params: { source: "wing", name: "wing-fix", profile: "openfoam" } }]);
});

test("when the engine refuses a repair, the dialog says why, with the engine's own numbers", async ({ page }) => {
  await mockEngine(page, {
    noJobs: true,
    refuse: {
      code: "not-enough-memory",
      message: "not enough memory: repair of 2,000,000 cells needs about 3.4 GB; 1.2 GB free. Close other programs "
        + "(ParaView, another solver) or run it on a bigger machine.",
    },
  });
  const dialog = await repairDialog(page, "wing");
  await dialog.getByRole("button", { name: "Start repair" }).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("Not enough free memory");
  await expect(alert).toContainText("It needs about 3.4 GB, and 1.2 GB is free.");
  await expect(page).toHaveURL(/\/app\/cases$/); // nothing started: it stays open where it was
  await expect(dialog.getByRole("button", { name: "Start repair" })).toBeEnabled();
});
