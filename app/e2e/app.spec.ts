// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ENGINE, KEY, mockEngine, pairingLink, readiness } from "./engine";

/** Fails the test on any console error or failed page script. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/net::ERR_CONNECTION_REFUSED|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("a command longer than its box fades where it is cut off, until it is scrolled to that end", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/#start");
  const steps = page.locator("#start ol > li");
  const short = steps.nth(1).locator("code", { hasText: "meshdoctor serve" }); // fits its box
  const long = steps.nth(2).locator("code", { hasText: "meshdoctor full" }); // doesn't, on a phone this narrow
  const cut = (code: Locator) => code.evaluate((el) => el.scrollWidth > el.clientWidth);
  const fades = (code: Locator) => code.evaluate((el) =>
    ["--fade-start", "--fade-end"].map((p) => getComputedStyle(el).getPropertyValue(p)));
  expect(await cut(long)).toBe(true);
  expect(await cut(short)).toBe(false);
  await expect.poll(() => fades(long)).toEqual(["0px", "24px"]); // more to the right: a fade there
  expect(await fades(short)).toEqual(["0px", "0px"]); // all of it shows: none
  await long.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await expect.poll(() => fades(long)).toEqual(["24px", "0px"]); // scrolled to its end: the fade moves to the start
});

test("the home page explains the app and links to the demo", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page).toHaveTitle(/Mesh Doctor/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("bad cells");
  await expect(page.getByRole("heading", { name: "Your meshes never leave your computer" })).toBeVisible();
  await page.getByRole("link", { name: "Explore the demo" }).first().click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByText(/Demo: recorded from a real run/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a newcomer's main button leads to the three steps, which say how often each is done and link onward", async ({ page }) => {
  await page.goto("/");
  // Not "Connect your engine": pairing first would need an engine that is already installed and running.
  await page.getByRole("main").getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL(/\/#start$/);
  await expect(page.getByRole("heading", { name: "Running in three steps" })).toBeInViewport();
  const steps = page.locator("#start ol > li");
  await expect(steps).toHaveCount(3);
  for (const [i, when] of ["once", "each time you work", "for each case"].entries()) {
    await expect(steps.nth(i)).toContainText(`Step ${i + 1} · ${when}`);
  }
  await expect(steps.nth(0).getByRole("link", { name: "The full install guide" })).toHaveAttribute("href", "/install");
  // Step 1 gives both set-ups, each named by where it runs: PowerShell can't run the Linux one, which installs no WSL.
  await expect(steps.nth(0)).toContainText("Windows, in PowerShell");
  await expect(steps.nth(0).getByRole("button", { name: "Copy “powershell -ExecutionPolicy Bypass -File tools\\setup_windows.ps1”" }))
    .toBeVisible();
  await expect(steps.nth(0)).toContainText("Linux or WSL, in a terminal");
  await expect(steps.nth(0).getByRole("button", { name: "Copy “bash tools/setup_linux.sh”" })).toBeVisible();
  await expect(steps.nth(0)).toContainText("On Windows it sets up WSL first, then installs them inside it.");
  await expect(steps.nth(2).getByRole("link", { name: "See a finished report in the demo" }))
    .toHaveAttribute("href", "/demo/repairs/ahmed35-medium-fix/report");
  // Step 3 gives both commands, the repair and the A/B test (full only repairs), and says what goes in their blanks.
  await expect(steps.nth(2).getByRole("button", { name: "Copy “meshdoctor full <case> <name>”" })).toBeVisible();
  await expect(steps.nth(2).getByRole("button", { name: "Copy “meshdoctor ab <case> <name>”" })).toBeVisible();
  await expect(steps.nth(2)).toContainText(
    "putting a case's name in place of <case> and a name for the repaired copy in place of <name>, the same in both.");
  await steps.nth(1).getByRole("link", { name: "Pair this browser" }).click();
  await expect(page).toHaveURL(/\/connect$/);
});

test("the demo's tour walks through the app's screens in seven steps from the keyboard, then hands the focus back", async ({ page }) => {
  await page.goto("/demo/jobs");
  const open = page.getByRole("complementary").getByRole("button", { name: "Take the tour" }); // in the sidebar
  await open.click();
  const tour = page.getByRole("dialog", { name: "Welcome to Mesh Doctor" });
  await expect(tour).toContainText("Step 1 of 7");
  await expect(tour.getByRole("button", { name: "Next" })).toBeFocused();
  // Each step opens the screen it describes and rings the part it means, lifted above the shade; and the tour stands
  // aside: the Overview's tiles show whole.
  const screens = [/\/demo$/, /\/demo\/cases$/, /\/demo\/repairs$/, /\/demo\/abtests$/, /\/demo\/jobs$/,
    /\/demo\/repairs\/ahmed35-medium-fix\/report$/];
  const spots = ["tiles", "cases", "repairs", "abtests", "jobs", "verdict"];
  for (let i = 2; i <= 7; i++) {
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toContainText(`Step ${i} of 7`);
    await expect(page).toHaveURL(screens[i - 2]!);
    const spot = page.locator("[data-tour-spot]");
    await expect(spot).toHaveAttribute("data-tour", spots[i - 2]!);
    await expect(spot).toHaveCount(1);
    await expect(spot).toHaveCSS("z-index", "51");
    if (i === 2) {
      const tiles = await page.getByText("Source cases", { exact: true })
        .locator("xpath=ancestor::div[contains(@class, 'grid')][1]").boundingBox();
      const box = await page.getByRole("dialog").boundingBox();
      expect(tiles && box && (box.y >= tiles.y + tiles.height || box.x >= tiles.x + tiles.width)).toBe(true);
    }
  }
  await expect(page.getByRole("dialog", { name: "Reports: did the repair help?" })).toBeVisible();
  // ...the report of a repair that worked: one where nothing changed would show a newcomer nothing.
  await expect(page.getByText("checkMesh numbers improved", { exact: true }).locator("xpath=../following-sibling::div[1]"))
    .toHaveText(/^[1-9]\d*$/);
  await expect(page.getByRole("button", { name: "Done" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("[data-tour-spot]")).toHaveCount(0);
  await expect(open).toBeFocused();
  // The demo's banner opens it too, from the start.
  await page.getByText(/^Demo: recorded from/).locator("..").getByRole("button", { name: "Take the tour" }).click();
  await expect(page.getByRole("dialog", { name: "Welcome to Mesh Doctor" })).toBeVisible();
});

test.describe("in a browser that hasn't seen the tour", () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // the other tests start with the tour seen

  test("your own app's front page offers the tour with a note after pairing; No thanks puts it away for good", async ({ page }) => {
    await mockEngine(page);
    await page.goto(pairingLink());
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
    const note = page.getByRole("note", { name: "Tour" });
    await expect(note).toContainText("New to Mesh Doctor?");
    await expect(note).toContainText("It stays in the sidebar for later.", { useInnerText: true }); // the menu on a phone
    await expect(page.getByRole("dialog")).toHaveCount(0); // a note, not the tour itself
    await note.getByRole("button", { name: "No thanks" }).click();
    await expect(note).toHaveCount(0);
    await expect(page.locator("main")).toBeFocused();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(note).toHaveCount(0);
  });

  test("the demo's front page opens the tour by itself, once; a link straight to a report opens the report alone", async ({ page }) => {
    await page.goto("/demo/repairs/ahmed35-medium-fix/report");
    await expect(page.locator("h1")).toHaveText("ahmed35-medium-fix"); // by tag: an open tour hides the page from roles
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto("/");
    await page.getByRole("link", { name: "Explore the demo" }).first().click();
    await expect(page).toHaveURL(/\/demo$/);
    const tour = page.getByRole("dialog", { name: "Welcome to Mesh Doctor" });
    await expect(tour).toContainText("Step 1 of 7");
    await expect(tour.getByRole("button", { name: "Next" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(tour).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test("your own app has the tour too: its own welcome, and it ends on your latest finished repair's report", async ({ page }) => {
  await mockEngine(page, {
    repairs: [{ name: "old-fix", finished: "2026-11-21 12:05:00", nCells: 1000, profile: "medium", source: "wing", status: {}, verdict: null }],
  });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  const open = page.getByRole("complementary").getByRole("button", { name: "Take the tour" });
  await open.click();
  await expect(page.getByRole("dialog", { name: "Welcome to Mesh Doctor" }))
    .toContainText("This browser is paired with the Mesh Doctor engine on your computer");
  const screens = [/\/app$/, /\/app\/cases$/, /\/app\/repairs$/, /\/app\/abtests$/, /\/app\/jobs$/,
    /\/app\/repairs\/old-fix\/report$/];
  for (let i = 2; i <= 7; i++) {
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toContainText(`Step ${i} of 7`);
    await expect(page).toHaveURL(screens[i - 2]!);
  }
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(open).toBeFocused();
});

test("before your first repair, your own app's tour rings Getting started on the Overview", async ({ page }) => {
  await mockEngine(page, { noJobs: true });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await expect(page.getByRole("region", { name: "Getting started" })).toBeVisible();
  await page.getByRole("complementary").getByRole("button", { name: "Take the tour" }).click();
  await expect(page.getByRole("dialog", { name: "Welcome to Mesh Doctor" })).toBeVisible();
  await page.keyboard.press("Enter");
  const step = page.getByRole("dialog", { name: "Overview: where to start" });
  await expect(step).toContainText("Step 2 of 7");
  await expect(page).toHaveURL(/\/app$/);
  const spot = page.locator("[data-tour-spot]");
  await expect(spot).toHaveCount(1);
  await expect(spot).toHaveAttribute("data-tour", "start");
  // (Not its name: with the tour open, the page around the tour is hidden from screen readers.)
  await expect(spot.getByRole("heading", { name: "Getting started", includeHidden: true })).toHaveCount(1);
  await expect(spot).toContainText("2 of 3 done");
});

test("on a laptop's screen, the tour's box stands clear of Getting started's command", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockEngine(page, { noJobs: true });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await expect(page.getByRole("region", { name: "Getting started" })).toContainText("2 of 3 done");
  await page.getByRole("complementary").getByRole("button", { name: "Take the tour" }).click();
  await expect(page.getByRole("dialog", { name: "Welcome to Mesh Doctor" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Overview: where to start" })).toBeVisible();
  // The step's copy button (by CSS: with the tour open, the page around it is hidden from screen readers; not its
  // Start a repair), above the tour's box or beside it, once the ringed part has been scrolled up.
  const copy = page.locator("[data-tour-spot] button", { hasNotText: "Start a repair" });
  await expect(copy).toHaveCount(1);
  await expect(async () => {
    const c = await copy.boundingBox();
    const box = await page.locator("[data-tour-box]").boundingBox();
    expect(c && box && (c.y + c.height <= box.y || c.x + c.width <= box.x)).toBe(true);
    expect(c && c.y >= 56).toBe(true); // and not under the header
  }).toPass({ timeout: 4000 });
});

test("the body font starts loading with the page, and is fetched once", async ({ page, request }) => {
  const html = await (await request.get("/")).text();
  const link = html.match(/<link [^>]*rel="preload"[^>]*>/)?.[0] ?? "";
  expect(link).toMatch(/ as="font"/);
  expect(link).toMatch(/ type="font\/woff2"/);
  expect(link).toMatch(/ crossorigin/); // fonts are fetched that way, so without it the browser fetches twice
  const href = link.match(/ href="(\/assets\/inter-latin-wght-normal-[\w-]+\.woff2)"/)?.[1];
  expect(href).toBeDefined();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px "Inter Variable"'))).toBe(true);
  const fetched = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => new URL(e.name).pathname));
  expect(fetched.filter((p) => p === href)).toHaveLength(1);
});

test("the demo shows recorded jobs, and cancelling asks first", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/demo/jobs");
  const running = page.getByRole("row", { name: "ahmed25-medium-fix A/B test" });
  await expect(running).toContainText("Running");
  await expect(running).toContainText("Solving on the repaired mesh"); // the step in words, as on the test's page
  await running.getByRole("button", { name: "Cancel" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Cancel ahmed25-medium-fix?");
  await dialog.getByRole("button", { name: "Cancel job" }).click();
  await expect(dialog).toBeHidden();
  await expect(running).toContainText("Cancelled");
  await page.getByRole("radio", { name: /Done/ }).click();
  await expect(page.getByRole("row", { name: /ahmed25-coarse-fix/ }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("the demo's cases show what was done to each", async ({ page }) => {
  await page.goto("/demo/cases");
  await expect(page.getByRole("row", { name: /ahmed-35-medium/ })).toContainText("Improved 4");
  await expect(page.getByRole("row", { name: /pitzDaily/ })).toContainText("2 better, 1 worse");
  await page.getByLabel("Filter cases").fill("ahmed-25");
  await expect(page.getByRole("row", { name: /pitzDaily/ })).toHaveCount(0);
  // What's typed is kept in the address, so a reload keeps it.
  await expect(page).toHaveURL(/\/demo\/cases\?q=ahmed-25$/);
  await page.reload();
  await expect(page.getByLabel("Filter cases")).toHaveValue("ahmed-25");
  await expect(page.getByText("3 of 5 cases")).toBeVisible();
  await expect(page.getByRole("row", { name: /pitzDaily/ })).toHaveCount(0);
});

test("pairing: the key leaves the address bar, then the app connects", async ({ page }) => {
  const engine = await mockEngine(page);
  await page.goto(pairingLink());
  await expect(page.getByRole("heading", { name: "Connect to your engine" })).toBeVisible();
  await expect(page).toHaveURL(/\/connect$/); // no #key=… left behind
  expect(engine.requests).toHaveLength(0); // nothing is sent before the user presses Connect
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Mesh Doctor v0.1.0 answered")).toBeVisible();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await expect(page.getByText("Source cases")).toBeVisible();
  await expect(page.getByText("API 1.0 · 1 job kind", { exact: true })).toBeVisible(); // one kind of job: not "1 job kinds"
  await expect(page.getByRole("link", { name: /Connected/ })).toBeVisible();
  const apiCalls = engine.requests.filter((r) => r.method() !== "OPTIONS");
  expect(apiCalls.length).toBeGreaterThan(0);
  for (const r of apiCalls) expect(r.headers()["x-md-key"]).toBe(KEY);
});

test("before anything has run, the Overview and Jobs say how to start: the engine's dashboard, and the command to copy", async ({ page }) => {
  const engine = await mockEngine(page, { noJobs: true });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "No repair runs yet" })).toBeVisible();
  await expect(main.getByText("None yet", { exact: true })).toBeVisible(); // the tile: not "0 improved, none worse"
  // and not "0 jobs on record"
  await expect(main.locator("section", { hasText: "Active jobs" }).getByText("No jobs yet", { exact: true })).toBeVisible();
  // Getting started: the engine answers and has cases, so the step to do next is the first case's repair, filled in.
  const start = main.getByRole("region", { name: "Getting started" });
  await expect(start).toContainText("2 of 3 done");
  await expect(main.getByRole("button", { name: /^Copy “meshdoctor full/ })).toHaveCount(1); // the others give way to it
  await expect(start.getByRole("button", { name: "Copy “meshdoctor full wing wing-fix”" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Start a repair" })).toHaveCount(0);
  const dashboard = main.getByRole("link", { name: "Open the engine's dashboard" });
  await expect(dashboard).toHaveAttribute("href", `${ENGINE}/meshdoctor`);
  await expect(dashboard).toHaveAttribute("target", "_blank");
  await start.getByRole("link", { name: "3 cases" }).click();
  await expect(page).toHaveURL(/\/app\/cases$/);
  await page.getByRole("complementary").getByRole("link", { name: "Jobs", exact: true }).click();
  await expect(main.getByRole("heading", { name: "No jobs yet" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Open the engine's dashboard" })).toHaveAttribute("href", `${ENGINE}/meshdoctor`);
  // Only the engine's lists were asked for: a link to its dashboard sends nothing until it's opened.
  expect(engine.requests.some((r) => new URL(r.url()).pathname === "/meshdoctor")).toBe(false);
  // A repair run in a terminal, as Getting started says to, isn't a job: the empty list links the Overview, where it
  // shows (the description above links it too).
  const noJobs = main.locator("div", { has: page.getByRole("heading", { name: "No jobs yet" }) }).last();
  await expect(noJobs).toContainText("A repair run in a terminal isn't a job: it shows under Repair runs on the Overview");
  await noJobs.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(start).toBeVisible();
});

test("once something has run, the Overview's Start a repair card (pointing to each case's own command) and the Jobs screen keep the engine's dashboard linked", async ({ page }) => {
  await mockEngine(page, {
    repairs: [{ name: "old-fix", finished: "2026-11-21 12:05:00", nCells: 1000, profile: "medium", source: "wing", status: {}, verdict: null }],
  });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  const main = page.getByRole("main");
  await expect(main.getByText("No verdict", { exact: true })).toBeVisible(); // the run is listed
  await expect(main.getByRole("heading", { name: "No jobs yet" })).toHaveCount(0); // its own link has gone with it
  await expect(main.getByRole("heading", { name: "Start a repair" })).toBeVisible();
  const dashboard = main.getByRole("link", { name: "the engine's dashboard" });
  await expect(dashboard).toHaveAttribute("href", `${ENGINE}/meshdoctor`);
  await expect(dashboard).toHaveAttribute("target", "_blank");
  await expect(main.getByRole("button", { name: "Copy “meshdoctor full <case> <name>”" })).toBeVisible();
  // ...after the app's own New repair, which opens the repair dialog.
  await main.getByRole("button", { name: "New repair" }).click();
  await expect(page.getByRole("dialog", { name: "Start a repair" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Easier than filling in the command's blanks: each case's own command, with the names filled in, on the Cases screen.
  await main.getByRole("link", { name: "Cases screen" }).click();
  await expect(page).toHaveURL(/\/app\/cases$/);
  await expect(main.getByRole("button", { name: "Copy repair command: meshdoctor full wing wing-fix" })).toBeVisible();
  // The Jobs screen, with its two jobs, says where they start. (One is running: the sidebar says "Jobs (1 active)".)
  await page.getByRole("complementary").getByRole("link", { name: /^Jobs\b/ }).click();
  await expect(page).toHaveURL(/\/app\/jobs$/);
  await expect(main.getByRole("button", { name: "old-fix", exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "the engine's dashboard" })).toHaveAttribute("href", `${ENGINE}/meshdoctor`);
});

test("the Cases screen gives each case its own repair command to copy, naming the copy with a name no run has", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockEngine(page, {
    repairs: [{ name: "wing-fix", finished: "2026-11-21 12:05:00", nCells: 1000, profile: "openfoam", source: "wing", status: {}, verdict: null }],
  });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await page.getByRole("complementary").getByRole("link", { name: "Cases", exact: true }).click();
  const main = page.getByRole("main");
  // Wait for the Cases screen itself (it loads on demand), or the Overview's own links could answer for it. Each case
  // starts its repair from its Repair button now, rather than from the engine's dashboard.
  await expect(main.getByRole("heading", { name: "Cases", level: 1 })).toBeVisible();
  await expect(main.getByRole("button", { name: "Repair wing" })).toBeVisible();
  await expect(main.getByRole("link", { name: "the engine's dashboard" })).toHaveCount(0);
  // wing-fix is taken: a repair named so would replace it.
  const wing = main.getByRole("button", { name: "Copy repair command: meshdoctor full wing wing-fix-2" });
  await expect(main.getByRole("button", { name: "Copy repair command: meshdoctor full motorBike motorBike-fix" })).toBeVisible();
  // wing's run has no verdict: it says so, in words (motorBike, never repaired, keeps its dash).
  await expect(main.getByRole("row", { name: /^wing/ }).getByText("No verdict", { exact: true })).toBeVisible();
  await expect(main.getByRole("row", { name: /^motorBike/ }).getByText("No verdict", { exact: true })).toHaveCount(0);
  // Pointing at it shows the command; clicking copies it.
  await wing.hover();
  await expect(page.getByRole("tooltip")).toHaveText("meshdoctor full wing wing-fix-2");
  await wing.click();
  await expect(main.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("meshdoctor full wing wing-fix-2");
});

test("the Solve screen says whether the engine's computer is ready, gives a problem's fix to copy, and checks again", async ({ page }) => {
  const engine = await mockEngine(page, {
    check: readiness({
      foamCourantCells: {
        state: "fail", found: "not built", fix: "run ./Allwmake in the repository, with OpenFOAM 14 loaded", command: "./Allwmake",
      },
    }),
  });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await page.getByRole("complementary").getByRole("link", { name: "Solve", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/solve$/);
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Ready to solve?" }) });
  await expect(card.getByText("1 problem to fix")).toBeVisible();
  await expect(card.getByText("Run ./Allwmake in the repository, with OpenFOAM 14 loaded")).toBeVisible();
  await expect(card.getByRole("button", { name: "Copy “./Allwmake”" })).toBeVisible();
  await expect(card.getByText("7 of 8 found")).toBeVisible();
  await expect(card.getByText(/repair a mesh of up to about 8\.3 M cells, or to solve one of up to about 9\.3 M/)).toBeVisible();
  const asked = () => engine.requests.filter((r) => new URL(r.url()).pathname === "/api/v1/check").length;
  const before = asked();
  await card.getByRole("button", { name: "Check again" }).click();
  await expect.poll(asked).toBeGreaterThan(before);
  await expect(card.getByRole("button", { name: "Check again" })).toBeEnabled();
});

test("an engine older than the readiness check is told to update, with the same checks to run in a terminal", async ({ page }) => {
  await mockEngine(page, { check: null });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await page.goto("/app/solve");
  await expect(page.getByText("Not checked")).toBeVisible();
  await expect(page.getByText(/Your engine is older than this page and can't check its computer/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy “meshdoctor check”" })).toBeVisible();
  // Older than the solve job too (no GET /runs): the Runs card says so as well.
  await expect(page.getByText(/Your engine is older than this page and can't solve cases from here yet/)).toBeVisible();
});

test("Solve's New case makes a case from a template: a free name, the memory it needs, then its job on Jobs", async ({ page }) => {
  const engine = await mockEngine(page, { noJobs: true });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await page.goto("/app/solve");
  await page.getByRole("button", { name: "New case", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New case" });
  await expect(dialog.getByRole("combobox", { name: "Template" })).toHaveValue("ahmed-body");
  const name = dialog.getByRole("textbox", { name: "Name of the new case" });
  await expect(name).toHaveValue("ahmed-medium");
  await dialog.getByRole("radio", { name: "Coarse" }).click();
  await expect(name).toHaveValue("ahmed-coarse");
  await expect(dialog.getByText("About 480,000 cells: for a quick look.")).toBeVisible();
  await expect(dialog.getByText(/^Its mesh needs about 1\.0 GB of memory; your engine's computer has 15\.6 GB\.$/)).toBeVisible();
  await name.fill("wing");                                                       // a case's name
  await expect(dialog.getByText("A case with this name exists already. Pick another name.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Make case" })).toBeDisabled();
  await name.fill("ahmed-coarse");
  await dialog.getByRole("button", { name: "Make case" }).click();
  await expect(page).toHaveURL(/\/app\/jobs\?job=20261123-120000-case-ahmed-coarse-e2e1$/);
  const details = page.getByRole("dialog", { name: "ahmed-coarse" });
  await expect(details.getByText("New case", { exact: true })).toBeVisible();
  expect(engine.started).toEqual([{ kind: "case", params: { template: "ahmed-body", size: "coarse", name: "ahmed-coarse", replace: false } }]);
});

test("an engine older than templates is told to update when New case opens", async ({ page }) => {
  await mockEngine(page, { templates: null, noJobs: true });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await page.goto("/app/solve");
  await page.getByRole("button", { name: "New case", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New case" });
  await expect(dialog.getByText(/^Your engine is older than this page and can't make cases from templates yet/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Make case" })).toHaveCount(0);
});

test("a list the engine fails to give says it didn't load, with the reason above it, on the Overview and on Cases", async ({ page }) => {
  await mockEngine(page, { broken: ["/cases"] });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  const main = page.getByRole("main");
  await expect(main.getByRole("alert")).toContainText("The engine hit an error"); // the engine itself answered
  await expect(main.getByRole("row", { name: /wing-fix/ })).toBeVisible(); // and the lists that loaded show
  await page.getByRole("complementary").getByRole("link", { name: "Cases", exact: true }).click();
  await expect(main.getByRole("heading", { name: "The cases didn't load" })).toBeVisible();
  await expect(main.getByRole("alert")).toContainText("The engine hit an error");
  await expect(main.getByRole("heading", { name: "No cases found" })).toHaveCount(0);
});

test("when the repair runs don't load, the Cases screen says so, rather than that no case was repaired", async ({ page }) => {
  await mockEngine(page, { broken: ["/repairs"] });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await page.getByRole("complementary").getByRole("link", { name: "Cases", exact: true }).click();
  const main = page.getByRole("main");
  await expect(main.getByRole("alert")).toContainText("The engine hit an error");
  await expect(main.getByText("· repair runs didn't load")).toBeVisible();
  await expect(main.getByRole("row", { name: /^motorBike/ })).toBeVisible(); // the cases themselves are listed
  await expect(main.getByText("none", { exact: true })).toHaveCount(0);
  await expect(main.getByText("Not repaired yet", { exact: true })).toHaveCount(0);
});

test("the site talks to nothing but itself and the engine", async ({ page }) => {
  await mockEngine(page);
  const seen = new Set<string>();
  page.on("request", (r) => seen.add(new URL(r.url()).origin));
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await page.getByRole("link", { name: "Jobs" }).first().click();
  await expect(page.getByRole("row", { name: /wing-fix/ })).toBeVisible();
  expect([...seen].sort()).toEqual([ENGINE, "http://localhost:4173"].sort());
});

test("an engine that isn't running gets a plain explanation, and a link to that one problem in Troubleshooting", async ({ page }) => {
  await mockEngine(page, { down: true });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("The engine isn't answering")).toBeVisible();
  // The panel gives the command to start it (the page names it too, for a browser paired before).
  await expect(page.getByRole("alert").getByText("meshdoctor serve")).toBeVisible();
  const [tab] = await Promise.all([page.waitForEvent("popup"), page.getByRole("link", { name: "How to fix this" }).click()]);
  await expect(tab).toHaveURL(/\/troubleshooting\?q=The\+engine\+isn%27t\+answering$/);
  await expect(tab.getByRole("searchbox", { name: "Search for the message you see" })).toHaveValue("The engine isn't answering");
  await expect(tab.getByRole("main").getByRole("region").getByRole("listitem")).toHaveCount(1); // the problems, not the page list
  await expect(tab.getByRole("main").getByText(/app_origins/).first()).toBeVisible();
  await expect(page).toHaveURL(/\/connect$/); // the pairing page stays, with its error, for Try again
  await expect(page.getByText("The engine isn't answering")).toBeVisible();
});

test("a replaced pairing key says to pair again", async ({ page }) => {
  await mockEngine(page, { wrongKey: true });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("This browser needs pairing again")).toBeVisible();
  // A key made while the engine runs works only once it restarts: the panel says so, before the command.
  const panel = page.getByRole("alert").filter({ hasText: "This browser needs pairing again" });
  await expect(panel.getByText(/Restart it first \(Ctrl\+C in its window, then meshdoctor serve\)/)).toBeVisible();
  await expect(panel.getByText("meshdoctor pair --open", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "How to fix this" }))
    .toHaveAttribute("href", "/troubleshooting?q=This+browser+needs+pairing+again");
});

test("live jobs can be cancelled on a real (mocked) engine", async ({ page }) => {
  await mockEngine(page);
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await page.goto("/app/jobs");
  const row = page.getByRole("row", { name: /wing-fix/ });
  await expect(row).toContainText("62 %");
  await row.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel job" }).click();
  await expect(row).toContainText("Cancelled");
  // The row's Cancel button has gone with the cancel: the focus is on the job's name, not lost to the page.
  await expect(row.getByRole("button", { name: "wing-fix", exact: true })).toBeFocused();
});

test("Settings: keeping the engine hands the focus back to Forget this engine", async ({ page }) => {
  await mockEngine(page);
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await page.goto("/app/settings");
  const forget = page.getByRole("button", { name: "Forget this engine" });
  await forget.focus();
  await page.keyboard.press("Enter");
  const ask = page.getByRole("dialog", { name: "Forget this engine?" });
  await expect(ask.getByRole("button", { name: "Keep it" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(ask).toBeHidden();
  await expect(forget).toBeFocused();
  await expect(page).toHaveURL(/\/app\/settings$/); // still paired
});

test("the app without a pairing goes to Connect", async ({ page }) => {
  await page.goto("/app/jobs");
  await expect(page).toHaveURL(/\/connect$/);
  await expect(page.getByRole("heading", { name: "Pair this browser with Mesh Doctor" })).toBeVisible();
});

test("every page runs under the site's Content-Security-Policy", async ({ page }) => {
  // 23 pages, each waited on until it goes quiet: about 15 s alone, and up to 30 s, the default limit, beside the
  // other tests on a busy PC.
  test.slow();
  const res = await page.goto("/");
  expect(res?.headers()["content-security-policy"]).toContain("script-src 'self'");
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { cspViolations: string[] }).cspViolations ??= [];
      (window as unknown as { cspViolations: string[] }).cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  for (const path of [
    "/", "/connect", "/install", "/report", "/estimate", "/how-it-works", "/accuracy", "/gallery", "/docs", "/troubleshooting",
    "/limits", "/safety", "/your-own-case", "/claude-code", "/dashboard-tour", "/architecture", "/demo", "/demo/cases", "/demo/solve", "/demo/repairs", "/demo/jobs", "/demo/settings", "/demo/estimate", "/demo/repairs/ahmed35-medium-fix/report",
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const v = await page.evaluate(() => (window as unknown as { cspViolations?: string[] }).cspViolations ?? []);
    expect(v, path).toEqual([]);
  }
});

test("unknown pages say so, and link the page a near address meant", async ({ page }) => {
  await page.goto("/nowhere");
  await expect(page.getByText("This page doesn't exist")).toBeVisible();
  await page.goto("/demo/nowhere");
  await expect(page.getByText("This page doesn't exist")).toBeVisible();
  await page.goto("/docs/validation"); // the Accuracy check's doc
  await expect(page.getByText("This page doesn't exist")).toBeVisible();
  await page.getByRole("link", { name: "Accuracy check" }).click();
  await expect(page).toHaveURL(/\/accuracy$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
