// SPDX-License-Identifier: GPL-3.0-or-later
// The Pictures screen in a real browser: the demo's set, its pictures shown through blob: URLs, one open large and
// saved as a PNG, and the set deleted for the visit only; with your own engine, a set's pictures fetched with the
// pairing key, and Make pictures… from a run's page.
import { expect, test, type Page } from "@playwright/test";
import { KEY, mockEngine, pairingLink, run, type PictureSetDoc } from "./engine";

/** Pairs with the pretend engine. */
async function pair(page: Page) {
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
}

const SPEED = "Side cut on the centreline, seen from the side (+y), nose to the left: speed";

test("the demo's set: its pictures show, one opens large and saves as a PNG named after its set", async ({ page }) => {
  await page.goto("/demo/pictures");
  const row = page.getByRole("row", { name: /ahmed-25-medium/ });
  await expect(row).toContainText("Written time 2000 · cuts and vortices");
  await expect(row).toContainText("Made");
  await row.getByRole("link", { name: "ahmed-25-medium", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/pictures\/ahmed-25-medium\/2000$/);
  await expect(page.getByRole("heading", { name: "Cuts" })).toBeVisible();
  const picture = page.getByRole("button", { name: SPEED });
  // the gallery's picture, decoded from its blob: URL
  await expect.poll(() => picture.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1280);
  expect(await picture.locator("img").getAttribute("src")).toMatch(/^blob:/);

  await picture.click();
  const dialog = page.getByRole("dialog", { name: SPEED });
  await expect(dialog).toContainText("Cuts · picture 2 of 5 · ahmed-25-medium, written time 2000");
  await expect.poll(() => dialog.getByRole("img", { name: SPEED })
    .evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1280);
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Download" }).click()]);
  expect(download.suggestedFilename()).toBe("ahmed-25-medium_2000_cuts_c1_side_centre_U.png");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog")).toContainText("picture 3 of 5");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: /^Cross cut 0\.2 m behind the base/ })).toBeFocused();
});

test("deleting the demo's set lasts for the visit only", async ({ page }) => {
  await page.goto("/demo/pictures/ahmed-25-medium/2000");
  await page.getByRole("button", { name: "Delete…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete the pictures of ahmed-25-medium, written time 2000?" });
  await expect(dialog).toContainText("In the demo this only changes the recorded data in this tab.");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/pictures$/);
  await expect(page.getByRole("heading", { name: "No pictures yet" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "ahmed-25-medium", exact: true })).toBeVisible();
});

test("with your own engine, a set's pictures come with the key, and a run's page makes more", async ({ page }) => {
  const set: PictureSetDoc = {
    case: "ahmed-coarse", set: "2000", time: "2000", mean: false, kinds: ["cuts"], made: new Date(Date.now() - 600_000).toISOString(),
    notes: [], pictures: [{ file: "cuts/c1_side_U.png", kind: "cuts", title: "Side cut: speed" }],
  };
  const solved = run("ahmed-coarse", {
    state: "done", step: "done", iteration: 2000, written: 2000, stretches: [{ from: 0, to: 2000 }],
    finished: new Date(Date.now() - 900_000).toISOString(), times: [1000, 2000], joined: [1000, 2000],
  });
  const engine = await mockEngine(page, {
    made: { "ahmed-coarse": { template: "ahmed-body" } }, runs: [solved], noJobs: true, pictures: [set],
  });
  await pair(page);
  await page.goto("/app/pictures/ahmed-coarse/2000");
  const picture = page.getByRole("button", { name: "Side cut: speed" });
  await expect.poll(() => picture.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  const fetched = engine.requests.find((r) => r.url().endsWith("/api/v1/pictures/ahmed-coarse/2000/cuts/c1_side_U.png"));
  expect(fetched?.headers()["x-md-key"]).toBe(KEY);

  await page.goto("/app/solve/ahmed-coarse");
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Pictures of its flow" }) });
  await expect(card.getByRole("link", { name: "Written time 2000" })).toHaveAttribute("href", "/app/pictures/ahmed-coarse/2000");
  await card.getByRole("button", { name: "Make pictures…" }).click();
  const dialog = page.getByRole("dialog", { name: "Make pictures of ahmed-coarse" });
  await dialog.getByLabel("Written time").selectOption("1000");
  await expect(dialog).toContainText("The set of pictures needs about 7 MB of disk space");
  await dialog.getByRole("button", { name: "Make pictures", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/jobs\?job=/);
  expect(engine.started).toEqual([
    { kind: "pictures", params: { name: "ahmed-coarse", time: "1000", kinds: "cuts,vortices,spots", mean: false } },
  ]);
});
