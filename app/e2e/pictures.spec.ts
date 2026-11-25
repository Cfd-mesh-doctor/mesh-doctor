// SPDX-License-Identifier: GPL-3.0-or-later
// The Pictures screen in a real browser: the demo's set, its pictures shown through blob: URLs, one open large and
// saved as a PNG, and the set deleted for the visit only; with your own engine, a set's pictures fetched with the
// pairing key, Make pictures… from a run's page, a time still split onto its processes pictured, joined first, and a
// cut over time made and played through.
import { expect, test, type Page } from "@playwright/test";
import { KEY, mockEngine, pairingLink, run, transientRun, type PictureSetDoc } from "./engine";

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

test("a cut over time: Make pictures… asks for one, and its set's page steps and plays through its times", async ({ page }) => {
  const times = ["0.0002", "0.0004", "0.0006"];
  const set: PictureSetDoc = {
    case: "ahmed-t", set: "0.0006", time: "0.0006", mean: false, kinds: ["cuts", "times"],
    made: new Date(Date.now() - 600_000).toISOString(), notes: [],
    pictures: [{ file: "cuts/c1_side_U.png", kind: "cuts", title: "Side cut: speed" }, ...times.map((t) => ({
      file: `times/c1_side_U_at_${t}.png`, kind: "times", time: t, title: `Side cut: speed, written time ${t}`,
    }))],
  };
  const t = transientRun("ahmed-t", {
    state: "done", step: "done", iteration: 0.0006, end: 0.0006, written: 0.0006, stretches: [{ from: 0, to: 0.0006 }],
    finished: new Date(Date.now() - 900_000).toISOString(), times: [0.0002, 0.0004, 0.0006], joined: [0.0006],
  });
  const engine = await mockEngine(page, { made: { "ahmed-t": { template: "ahmed-body" } }, runs: [t], noJobs: true, pictures: [set] });
  engine.apiVersion = "1.20";
  await pair(page);
  await page.goto("/app/pictures/ahmed-t/0.0006");
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Over time" }) });
  await expect(card.getByText("Written time 0.0002 · 1 of 3")).toBeVisible();
  await card.getByRole("button", { name: "Later time" }).click();
  await expect(card.getByText("Written time 0.0004 · 2 of 3")).toBeVisible();
  await card.getByRole("button", { name: "Play" }).click();
  await expect(card.getByText("Written time 0.0006 · 3 of 3")).toBeVisible();
  await expect(card.getByRole("button", { name: "Play" })).toBeVisible();
  const shown = card.getByRole("button", { name: "Side cut: speed, written time 0.0006" });
  await expect.poll(() => shown.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);

  await page.goto("/app/solve/ahmed-t");
  const pictures = page.locator("section").filter({ has: page.getByRole("heading", { name: "Pictures of its flow" }) });
  await pictures.getByRole("button", { name: "Make pictures…" }).click();
  const dialog = page.getByRole("dialog", { name: "Make pictures of ahmed-t" });
  await dialog.getByRole("checkbox", { name: /^A cut over time/ }).check();
  await expect(dialog).toContainText("The first cut's speed at each of its 3 written times from 0.0002 to 0.0006");
  await dialog.getByRole("button", { name: "Make pictures", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/jobs\?job=/);
  expect(engine.started).toEqual([
    { kind: "pictures", params: { name: "ahmed-t", time: "", kinds: "cuts,vortices,spots,times", mean: false } },
  ]);
});

test("Make pictures… pictures a time still split onto a run's processes, on an engine that joins it first", async ({ page }) => {
  const solved = run("ahmed-coarse", {
    state: "done", step: "done", iteration: 2000, written: 2000, stretches: [{ from: 0, to: 2000 }],
    finished: new Date(Date.now() - 900_000).toISOString(), times: [1000, 2000], joined: [2000],
  });
  const engine = await mockEngine(page, {
    made: { "ahmed-coarse": { template: "ahmed-body" } }, runs: [solved], noJobs: true, pictures: [],
  });
  engine.apiVersion = "1.19";
  await pair(page);
  await page.goto("/app/solve/ahmed-coarse");
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Pictures of its flow" }) });
  await card.getByRole("button", { name: "Make pictures…" }).click();
  const dialog = page.getByRole("dialog", { name: "Make pictures of ahmed-coarse" });
  const time = dialog.getByLabel("Written time");
  await expect(time.locator("option")).toHaveText(["The latest (2000)", "1000 (split)"]);
  await time.selectOption("1000");
  await expect(dialog).toContainText("It is split onto its 4 processes: the job joins it first, into the run's own folder");
  await expect(dialog).toContainText("Joining written time 1000 from its 4 processes into the run's folder and the set "
    + "of pictures need about 48 MB of disk space");
  await dialog.getByRole("button", { name: "Make pictures", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/jobs\?job=/);
  expect(engine.started).toEqual([
    { kind: "pictures", params: { name: "ahmed-coarse", time: "1000", kinds: "cuts,vortices,spots", mean: false } },
  ]);
});
