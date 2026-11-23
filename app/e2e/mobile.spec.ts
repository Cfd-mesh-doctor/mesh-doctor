// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";
import { testReport } from "../src/report/testReport";
import { ENGINE, mockEngine, pairingLink } from "./engine";
import { lineBreaks } from "./text";

test.describe("in a browser that hasn't seen the tour", () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // the other tests start with the tour seen

  test("on a phone your app's note offering the tour says it stays in the menu, where the sidebar is", async ({ page }) => {
    await mockEngine(page);
    await page.goto(pairingLink());
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
    const note = page.getByRole("note", { name: "Tour" });
    await expect(note).toContainText("It stays in the menu for later.", { useInnerText: true });
    await expect(note).not.toContainText("sidebar", { useInnerText: true });
  });
});

test("on a phone nothing scrolls sideways, and the menu works", async ({ page }) => {
  test.slow(); // every page at three widths: more than the default 30 s
  // The device's own width (412 px), then a small phone: the Jobs filter once fit the first and not the second.
  // Then the smallest phones (320 px), where the home and pairing pages were once 18-20 px too wide.
  for (const width of [page.viewportSize()?.width ?? 412, 360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of [
      "/", "/connect", "/install", "/report", "/estimate?cells=31.1", "/how-it-works", "/accuracy", "/gallery", "/docs",
      "/troubleshooting", "/limits", "/safety", "/your-own-case", "/claude-code", "/dashboard-tour", "/architecture", "/demo", "/demo/jobs", "/demo/cases", "/demo/settings", "/demo/estimate?cells=31.1",
      "/demo/repairs/ahmed25-medium-fix/report", "/demo/repairs/ahmed35-medium-fix/report",
    ]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} is wider than a ${width} px screen`).toBeLessThanOrEqual(1);
    }
  }
  await page.goto("/demo");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Jobs" }).click();
  await expect(page).toHaveURL(/\/demo\/jobs$/);
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("on a phone your own app before its first case doesn't scroll sideways: the set-up lines scroll in their block", async ({ page }) => {
  const engine = await mockEngine(page, { noJobs: true });
  engine.cases = [];
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  for (const width of [page.viewportSize()?.width ?? 412, 360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    // Getting started and the empty Cases list each give the First run's set-up lines, longer than a phone is wide.
    for (const [path, part] of [["/app", "Getting started"], ["/app/cases", "No cases found"]] as const) {
      await page.goto(path);
      await expect(page.getByRole("main").getByText(part, { exact: true })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} is wider than a ${width} px screen`).toBeLessThanOrEqual(1);
      const block = page.getByRole("main").locator("pre", { hasText: "cp -r $FOAM_TUTORIALS/" });
      expect(await block.evaluate((el) => el.scrollWidth > el.clientWidth), `${path}: the block scrolls`).toBe(true);
    }
  }
});

test("on a phone your own app's top bar fits down to 320 px, whatever the engine says", async ({ page }) => {
  test.slow(); // five states at five widths, and the engine that isn't running is asked three times
  const engine = await mockEngine(page, { noJobs: true });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  const header = page.locator("header").first();
  // Each state, and the short word it says under 400 px; under 360 px the colour theme gives way (it's in Settings
  // too). At 320 px "Connected" once left no room for the theme button, so every screen scrolled sideways.
  const states: [string, string, () => Promise<unknown> | void][] = [
    ["Connected", "Connected", () => {}],
    ["Engine offline", "Offline", () => { engine.down = true; }],
    ["Pair again", "Pair again", () => { engine.down = false; engine.wrongKey = true; }],
    ["Version mismatch", "Mismatch", () => { engine.wrongKey = false; engine.apiVersion = "2.0"; }],
    // The engine's first answer has yet to come.
    ["Connecting…", "Waiting…", () => page.route(`${ENGINE}/api/v1/`, () => {})],
  ];
  for (const [label, short, set] of states) {
    await set();
    await page.setViewportSize({ width: 412, height: 800 });
    await page.goto("/app/settings");
    await expect(header.getByRole("link", { name: label, exact: true })).toBeVisible({ timeout: 10_000 });
    for (const width of [412, 400, 375, 360, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(header.getByRole("link", { name: width < 400 ? short : label, exact: true })).toBeVisible();
      await expect(header.getByRole("button", { name: "Colour theme" })).toBeVisible({ visible: width >= 360 });
      expect((await header.getByText("Mesh Doctor").boundingBox())?.height, `${width} px`).toBeLessThan(24);
      // The last button ends inside the bar's margin, the same as the menu button's on the left.
      const room = await header.evaluate((h) => {
        const ends = [...h.querySelectorAll("a, button")].filter((e) => e.getClientRects().length > 0)
          .map((e) => e.getBoundingClientRect().right);
        return h.getBoundingClientRect().left + h.clientWidth - parseFloat(getComputedStyle(h).paddingRight) - Math.max(...ends);
      });
      expect(room, `${label} at ${width} px runs into the top bar's margin`).toBeGreaterThanOrEqual(-0.5);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${label}: Settings is wider than a ${width} px screen`).toBeLessThanOrEqual(1);
    }
  }
});

test("on the smallest phones your own app's screens don't scroll sideways", async ({ page }) => {
  await mockEngine(page);
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const [path, part] of [
      ["/app", "Getting started"], ["/app/jobs", "wing-fix"], ["/app/cases", "motorBike"],
      ["/app/estimate?cells=31.1", "Size estimator"], ["/app/settings", "Appearance"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("main").getByText(part).first()).toBeVisible();
      await expect(page.getByText("Asking the engine about its computer…")).toHaveCount(0); // the estimator's answer
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} is wider than a ${width} px screen`).toBeLessThanOrEqual(1);
    }
  }
});

test("on a phone a card's description runs across the card, under its title and what's beside it", async ({ page }) => {
  await mockEngine(page);
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  await page.setViewportSize({ width: 320, height: 800 });
  // Beside the state badge, Settings' Engine card once had six lines of three words or so.
  for (const [path, title, beside, description] of [
    ["/app/settings", "Engine", "Connected", "Mesh Doctor on this computer."],
    ["/app", "Getting started", "of 3 done", "Three steps to your first repair."],
    ["/app", "Recent jobs", "All jobs", "Repairs and A/B tests, newest first"],
    ["/demo/settings", "Engine", "Demo data", "The demo shows data recorded"],
  ] as const) {
    await page.goto(path);
    const card = page.locator("section", { has: page.getByRole("heading", { name: title, exact: true }) });
    const [head, t, b, d] = await Promise.all([
      card.locator("> div").first().evaluate((h) => {
        const cs = getComputedStyle(h);
        const r = h.getBoundingClientRect();
        return { left: r.left + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.paddingRight) };
      }),
      card.getByRole("heading", { name: title, exact: true }).boundingBox(),
      card.getByText(beside).first().boundingBox(),
      card.getByText(description).boundingBox(),
    ]);
    if (!t || !b || !d) throw new Error(`${title}: a part is missing`);
    expect(Math.abs(b.y + b.height / 2 - (t.y + t.height / 2)), `${title}: "${beside}" is beside the title`).toBeLessThan(4);
    expect(d.y, `${title}: the description is under both`).toBeGreaterThanOrEqual(Math.max(t.y + t.height, b.y + b.height) - 1);
    expect(d.width, `${title}: the description has the card's width`).toBeGreaterThanOrEqual(head.right - head.left - 1);
  }
});

test("on a small phone an open report fits the screen", async ({ page }) => {
  // Six A/B fields with long numbers, as a real k-omega run has: the table once widened the page. With a
  // repair map, whose canvas has to fit too.
  const report = testReport({ map: true }) as { documents: { abtest: Record<string, Record<string, unknown>> } };
  const ab = report.documents.abtest;
  for (const f of ["Uy", "Uz", "k", "omega"]) {
    (ab.residualRatioFixedOverBase as Record<string, number>)[f] = 1.0042;
    (ab.base!.residuals as Record<string, unknown>)[f] = { mean: 0.000467123 };
    (ab.fixed!.residuals as Record<string, unknown>)[f] = { mean: 0.000465871 };
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/report");
  await page.getByLabel("Choose a report file").setInputFiles({
    name: "ahmed25-fine-fix.mdreport.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(report)),
  });
  await expect(page.getByRole("heading", { name: "ahmed25-fine-fix" })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Side view of the model's wall faces/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the open report is wider than a 360 px screen").toBeLessThanOrEqual(1);
});

test("on a small phone, jobs show progress under the name and every filter shows whole", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/demo/jobs");
  const running = page.getByRole("row", { name: /ahmed25-medium-fix A\/B test/ });
  // No Progress column on a phone: the step shows once, under the name.
  await expect(running.getByText("solving fixed").filter({ visible: true })).toHaveCount(1);
  // The filter's five choices need 356 px: on a phone the ones that don't fit go on to a second line, so none is cut
  // at the edge (Cancelled was, at "Canc", with the rest scrolled out of sight), down to the smallest phones.
  const filter = page.getByRole("radiogroup", { name: "Show jobs" });
  for (const width of [412, 360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const cut = await filter.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll<HTMLElement>('[role="radio"]'))
        .filter((r) => r.getBoundingClientRect().right > box.right + 0.5 || r.scrollWidth > r.clientWidth)
        .map((r) => r.innerText);
    });
    expect(cut, `filter choices cut at ${width} px`).toEqual([]);
    expect(await filter.evaluate((el) => el.scrollWidth - el.clientWidth), `the filter scrolls at ${width} px`).toBeLessThanOrEqual(0);
  }
  await page.getByRole("radio", { name: /Cancelled/ }).click();
  await expect(page.getByRole("row", { name: /ahmed25-fine-strict/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /pitzdaily-fix/ })).toHaveCount(0);
  // With room, the choices keep to one line.
  await page.setViewportSize({ width: 768, height: 800 });
  const tops = await filter.evaluate((el) =>
    Array.from(el.querySelectorAll('[role="radio"]')).map((r) => Math.round(r.getBoundingClientRect().top)));
  expect(new Set(tops).size, "the filter's lines at 768 px").toBe(1);
});

test("on a small phone a job's details fit the screen, scrolling inside rather than cut off", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 }); // the running A/B test's details were 759 px tall here
  await page.emulateMedia({ reducedMotion: "reduce" }); // no pop-in while measuring
  await page.goto("/demo/jobs?job=20261121-130610-abtest-ahmed25-medium-fix-13c2");
  const details = page.getByRole("dialog", { name: "ahmed25-medium-fix" });
  await expect(details).toBeVisible();
  const box = (await details.boundingBox())!;
  expect(box.y, "the title is above the screen").toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, "the buttons are below the screen").toBeLessThanOrEqual(667);
  await details.getByRole("button", { name: "Close", exact: true }).first().click(); // scrolled to, inside the dialog
  await expect(details).toBeHidden();
});

test("on a small phone a job's result path breaks after its slash, not inside a name", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 }); // it broke as "fix_ab/ab_result." / "json" here
  await page.goto("/demo/jobs?job=20261121-130610-abtest-ahmed25-medium-fix-13c2");
  const details = page.getByRole("dialog", { name: "ahmed25-medium-fix" });
  const result = details.locator("dt", { hasText: /^Result$/ }).locator("xpath=following-sibling::dd");
  await expect(result).toHaveText("ahmed25-medium-fix_ab/ab_result.json"); // the offered breaks add no text
  const breaks = await lineBreaks(result);
  expect(breaks).toContain("ahmed25-medium-fix_ab/");
  for (const before of breaks) expect(before, "the path breaks inside a name").toMatch(/[-/]$/);
});

test("on a small phone, a case's size and its estimate show under the name", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/demo/cases");
  const row = page.getByRole("row", { name: /pitzDaily/ });
  // No Cells column on a phone: the size shows once, under the name, with the link.
  await expect(row.getByText("12 k cells").filter({ visible: true })).toHaveCount(1);
  await row.getByRole("link", { name: "Size estimate for pitzDaily" }).click();
  await expect(page).toHaveURL(/\/demo\/estimate\?cells=0\.012225$/);
  await expect(page.getByLabel("Mesh size")).toHaveValue("0.012225");
});

test("on a small phone the Overview's repair runs show their whole names and cases, the verdict under them", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/demo");
  const runs = page.getByRole("main").getByRole("listitem");
  await expect(runs).toHaveCount(6);
  // Nothing in a run is cut off: no line of it is wider than its box (they were cut with "…").
  const cut = () => runs.evaluateAll((items) =>
    items.flatMap((li) => [...li.querySelectorAll("div")].filter((d) => d.scrollWidth > d.clientWidth + 1).map((d) => d.textContent)));
  expect(await cut()).toEqual([]);
  const run = runs.filter({ has: page.getByRole("link", { name: "Report of ahmed25-medium-fix" }) });
  await expect(run).toContainText(/ahmed-25-medium · \d+ k cells/);
  const box = async () => ({
    name: (await run.getByText("ahmed25-medium-fix", { exact: true }).boundingBox())!,
    report: (await run.getByRole("link", { name: "Report of ahmed25-medium-fix" }).boundingBox())!,
  });
  const phone = await box();
  expect(phone.name.height, "the name has a line of its own").toBeLessThan(26);
  expect(phone.report.y, "the verdict and Report go under the name").toBeGreaterThan(phone.name.y + phone.name.height);
  // From 640 px they sit beside it again.
  await page.setViewportSize({ width: 768, height: 800 });
  const wide = await box();
  expect(wide.report.y, "the Report sits beside the name").toBeLessThan(wide.name.y + wide.name.height);
  // At 1280 px the card is narrowest, beside the recent jobs: still nothing cut off.
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await cut()).toEqual([]);
});

test("on a small phone your own long repair-run name wraps at its hyphens, rather than being cut off", async ({ page }) => {
  const name = "wing-endplate-v3-with-whiskers-strict-limits-fix"; // wider than a 360 px phone's card
  await mockEngine(page, {
    repairs: [{ name, finished: "2026-11-21 12:05:00", nCells: 1_250_000, profile: "medium", source: "wing-endplate-v3", status: {}, verdict: null }],
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  const text = page.getByRole("main").getByText(name, { exact: true });
  await expect(text).toBeVisible();
  expect(await text.evaluate((d) => d.scrollWidth - d.clientWidth), "the name is cut off").toBeLessThanOrEqual(1);
  const breaks = await lineBreaks(text);
  expect(breaks.length, "the name doesn't wrap").toBeGreaterThan(0);
  for (const before of breaks) expect(before, "the name breaks inside a word").toMatch(/-$/);
  await expect(page.getByRole("main").getByText("No verdict", { exact: true })).toBeVisible(); // not a bare dash
});

test("on a phone the top bar and the case names each stay on one line", async ({ page }) => {
  // Under 400 px the demo's pill says just "Demo", so "Mesh Doctor" keeps its line down to 320 px.
  for (const [width, pill] of [[412, "Demo data"], [360, "Demo"], [320, "Demo"]] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/demo/cases");
    const header = page.locator("header").first();
    await expect(header.getByRole("link", { name: pill, exact: true })).toBeVisible();
    expect((await header.getByText("Mesh Doctor").boundingBox())?.height, `${width} px`).toBeLessThan(24);
    // The Report link sits under the verdict, so the names keep their room. (At 320 px the widest verdict,
    // "2 better, 1 worse", leaves too little and a long name breaks at a hyphen, as it always has there.)
    const row = page.getByRole("row", { name: /ahmed-25-medium/ });
    if (width >= 360) {
      expect((await row.getByText("ahmed-25-medium", { exact: true }).boundingBox())?.height, `${width} px`).toBeLessThan(26);
    }
    await expect(row.getByRole("link", { name: "Report of ahmed25-medium-fix" })).toBeVisible();
  }
});

test("on a phone the public pages have a menu", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/report");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Size estimator" }).click();
  await expect(page).toHaveURL(/\/estimate$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Size estimator" })).toBeVisible();
  // A section of the home page, from another page: it opens scrolled to that section.
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/#privacy$/);
  await expect(page.getByRole("heading", { name: "Your meshes never leave your computer" })).toBeInViewport();
});

test("on a phone the doc headings' copy-link buttons always show, as a touch screen can't point at a heading", async ({ page }) => {
  await page.goto("/architecture");
  const button = page.getByRole("button", { name: "Copy a link to “Jobs”" });
  await button.scrollIntoViewIfNeeded();
  await expect.poll(() => button.evaluate((b) => getComputedStyle(b).opacity)).toBe("1");
});

test("on a phone the menu's Take the tour closes the menu and opens the tour", async ({ page }) => {
  await page.goto("/demo/cases");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog", { name: "Navigation" }).getByRole("button", { name: "Take the tour" }).click();
  await expect(page.getByRole("dialog", { name: "Welcome to Mesh Doctor" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1); // the menu has gone
});

test("on a phone the tour brings the part it means into view, clear of the top bar and above the tour", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Take the tour" }).click();
  for (let i = 1; i < 5; i++) await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Reports: did the repair help?" })).toBeVisible();
  // A report's verdict is far down a phone's screen, below its five number tiles.
  const verdict = page.locator('[data-tour="verdict"]');
  await expect(verdict).toHaveAttribute("data-tour-spot", "");
  await expect(async () => {
    const part = await verdict.boundingBox();
    const tour = await page.getByRole("dialog").boundingBox();
    expect(part && tour && part.y >= 56 && part.y < tour.y).toBe(true);
  }).toPass({ timeout: 5000 });
});
