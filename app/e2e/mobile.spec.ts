// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test, type Page } from "@playwright/test";
import { testReport } from "../src/report/testReport";
import { ENGINE, MATCHING, mockEngine, pairingLink, PLAN, run, transientRun } from "./engine";
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
      "/troubleshooting", "/limits", "/safety", "/your-own-case", "/claude-code", "/dashboard-tour", "/architecture", "/demo", "/demo/jobs", "/demo/cases", "/demo/repairs", "/demo/settings", "/demo/estimate?cells=31.1",
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
  test.slow(); // six states at five widths, and the engine that isn't running is asked three times
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
    // Something else answers at the engine's address (its preflight goes on to the pretend engine).
    ["Engine error", "Error", () => {
      engine.apiVersion = "1.0";
      return page.route(`${ENGINE}/api/v1/`, (r) => r.request().method() === "OPTIONS" ? r.fallback() : r.fulfill({
        status: 200, headers: { "Access-Control-Allow-Origin": "http://localhost:4173", "Content-Type": "text/html" },
        body: "<html>another program</html>",
      }));
    }],
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
      ["/app", "Getting started"], ["/app/jobs", "wing-fix"], ["/app/cases", "motorBike"], ["/app/solve", "Ready to solve?"], ["/app/first-run", "Make a coarse Ahmed case"],
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

test("on the smallest phones Verify install's answer fits, on the Solve screen and its run's page, its chart within the card", async ({ page }) => {
  const solved = run("verify-install", { state: "done", step: "done", iteration: 2000, written: 2000, nProcs: 6,
    stretches: [{ from: 0, to: 2000 }], finished: new Date().toISOString() });
  await mockEngine(page, { made: { "verify-install": { template: "ahmed-body" } }, runs: [solved], noJobs: true,
    validations: { "verify-install": MATCHING } });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const [path, title] of [["/app/solve", "Verify install"], ["/app/solve/verify-install", "Against the accuracy check"]] as const) {
      await page.goto(path);
      const card = page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
      const chart = card.getByRole("img", { name: /^Drag coefficient of each case/ });
      await expect(chart).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} is wider than a ${width} px screen`).toBeLessThanOrEqual(1);
      const [c, k] = [await card.boundingBox(), await chart.boundingBox()];
      expect(k!.x + k!.width, `${title}'s chart is wider than its card at ${width} px`).toBeLessThanOrEqual(c!.x + c!.width + 1);
    }
  }
});

test("on the smallest phones a transient run's charts write two times or more on their time axis", async ({ page }) => {
  // its time steps of 20 µs to 0.0005 s, where a step of 0.0005 s left one number on the axis
  const stopped = transientRun("ahmed-coarse-ddes", { state: "stopped", step: "done", iteration: 0.0005, written: 0.0005,
    end: 0.0005, stretches: [{ from: 0, to: 0.0005 }], finished: new Date().toISOString() });
  await mockEngine(page, { made: { "ahmed-coarse": { template: "ahmed-body" }, "ahmed-coarse-ddes": { transientOf: "ahmed-coarse" } },
    runs: [stopped], noJobs: true, kinds: ["repair", "abtest", "abextend", "case", "solve", "tplan"] });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/app/solve/ahmed-coarse-ddes");
    for (const name of ["Initial residual of p per time step, log scale", "Downforce from body over time"]) {
      const chart = page.getByRole("img", { name });
      await expect(chart).toBeVisible();
      // the axis's numbers, centred under their ticks (its name, centred too, is words)
      const centred = await chart.locator('text[text-anchor="middle"]').allTextContents();
      const times = centred.filter((t) => /^[0-9.]+$/.test(t));
      expect(times.length, `${name} at ${width} px: ${centred.join(" | ")}`).toBeGreaterThanOrEqual(2);
    }
  }
});

test("on the smallest phones a run's transient plan fits, its table scrolling in its own box", async ({ page }) => {
  const solved = run("ahmed-coarse", { state: "done", step: "done", iteration: 300, end: 300, written: 300, nProcs: 6,
    stretches: [{ from: 0, to: 300 }], finished: new Date().toISOString() });
  await mockEngine(page, { made: { "ahmed-coarse": { template: "ahmed-body" } }, runs: [solved], noJobs: true,
    kinds: ["repair", "case", "solve", "tplan"], tplans: { "ahmed-coarse": PLAN } });
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/app/solve/ahmed-coarse");
    const table = page.getByRole("table", { name: "The time step and time of a transient run at each largest Courant number" });
    await expect(table).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `the run's page is wider than a ${width} px screen`).toBeLessThanOrEqual(1);
    const box = await table.locator("xpath=..").boundingBox();
    expect(box!.x + box!.width, `the table's box is wider than a ${width} px screen`).toBeLessThanOrEqual(width + 1);
    expect(await table.locator("xpath=..").evaluate((el) => el.scrollWidth > el.clientWidth), `the table scrolls at ${width} px`)
      .toBe(true);
    const button = await page.getByRole("button", { name: "Plan again" }).boundingBox();
    expect(button!.x + button!.width, `Plan again is cut off at ${width} px`).toBeLessThanOrEqual(width + 1);
  }
});

/** The code on the page (each code element in its main part, but in a block of code) that is plain code in running
 * text, not InlineCode's box, or that one line could hold but is on two, sticks out of its line, or has what's written
 * against it ("(" before it, ")," after it) on another line: what's wrong, and how many it checked. A command split at a
 * line's end ("meshdoctor", then "serve" on the next line) doesn't read as one. */
async function codeOffItsLine(page: Page): Promise<readonly [string[], number]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const range = document.createRange();
    let seen = 0;
    for (const code of document.querySelectorAll("main code")) {
      if (code.closest("pre")) continue; // a block of code
      seen++;
      // Code in running text as InlineCode shows it: a box, with what's written against the code in it. Only code in
      // a part that scrolls sideways on purpose (a table, a command to copy) may be plain.
      const box = code.closest(".code-box");
      if (!box) {
        let scrolls = false;
        for (let up: Element | null = code; up && up !== document.body && !scrolls; up = up.parentElement) {
          scrolls = /auto|scroll/.test(getComputedStyle(up).overflowX);
        }
        if (!scrolls && code.getClientRects().length) out.push(`${code.textContent}: plain code, not InlineCode`);
        continue;
      }
      const parent = box.parentElement!;
      const text = code.firstChild;
      if (!(text instanceof Text) || code.childNodes.length !== 1 || !box.getClientRects().length) continue; // hidden
      // The block its lines are in, and how wide those are.
      let block = parent;
      while (getComputedStyle(block).display.startsWith("inline")) block = block.parentElement!;
      const style = getComputedStyle(block);
      if (/auto|scroll/.test(style.overflowX)) continue; // a block that scrolls sideways on purpose
      const left = block.getBoundingClientRect().left + block.clientLeft + parseFloat(style.paddingLeft);
      const line = block.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      // How wide the box is on one line.
      const probe = box.cloneNode(true) as HTMLElement;
      Object.assign(probe.style, { position: "absolute", visibility: "hidden", whiteSpace: "nowrap", maxWidth: "none" });
      parent.append(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      // The lines it is on: its characters' tops.
      const tops = new Set<number>();
      for (let i = 0; i < text.length; i++) {
        range.setStart(text, i);
        range.setEnd(text, i + 1);
        const r = range.getBoundingClientRect();
        if (r.height) tops.add(Math.round(r.top));
      }
      const name = code.textContent;
      if (width + 1 < line && tops.size > 1) { // a pixel to spare, for rounding
        out.push(`${name}: on ${tops.size} lines, though one line holds it (${Math.round(width)} of ${Math.round(line)} px)`);
      }
      if (box.getBoundingClientRect().right > left + line + 0.5) out.push(`${name}: sticks out of its line`);
      // What's written against it with no space stays on its line: a "(" left at a line's end reads badly.
      const middle = (t: Text, i: number) => {
        range.setStart(t, i);
        range.setEnd(t, i + 1);
        const r = range.getBoundingClientRect();
        return r.top + r.height / 2;
      };
      const prev = box.previousSibling;
      const next = box.nextSibling;
      if (prev instanceof Text && /\S$/.test(prev.data) && Math.abs(middle(prev, prev.length - 1) - middle(text, 0)) > 6) {
        out.push(`${name}: the ${prev.data.slice(-1)} before it is on another line`);
      }
      if (next instanceof Text && /^\S/.test(next.data) && Math.abs(middle(next, 0) - middle(text, text.length - 1)) > 6) {
        out.push(`${name}: the ${next.data[0]} after it is on another line`);
      }
    }
    return [out, seen] as const;
  });
}

test("on a phone a command or file name in running text stays whole on a line whenever the line can hold it, with what's written against it", async ({ page }) => {
  test.slow(); // every page at three widths
  // Split at a line's end ("meshdoctor", then "serve --port 8766" on the next line), a command doesn't read as one.
  const wrong: string[] = [];
  let checked = 0;
  for (const path of [
    "/", "/connect", "/install", "/report", "/estimate?cells=31.1", "/how-it-works", "/accuracy", "/gallery", "/docs",
    "/troubleshooting", "/limits", "/safety", "/your-own-case", "/claude-code", "/dashboard-tour", "/architecture", "/demo", "/demo/jobs", "/demo/cases", "/demo/repairs", "/demo/settings", "/demo/estimate?cells=31.1",
    "/demo/repairs/ahmed25-medium-fix/report",
  ]) {
    await page.setViewportSize({ width: 412, height: 800 });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    for (const width of [412, 360, 320]) {
      await page.setViewportSize({ width, height: 800 });
      const [found, boxes] = await codeOffItsLine(page);
      checked += boxes;
      wrong.push(...found.map((what) => `${path} at ${width} px: ${what}`));
    }
  }
  expect(wrong).toEqual([]);
  expect(checked, "code checked").toBeGreaterThan(300);
});

// Your own app's pages, where a case's name is in running text: Getting started before anything has run (its first
// case's repair, never the case itself), and the First run's case and the repair of a copy of it. What the command's
// blanks stand for ("<case>,", "<name>).") is on the demo's Overview, which the check above opens.
const firstRunRepair = { name: "ahmed-coarse-fix", source: "ahmed-coarse", finished: "2026-11-24 10:00:00",
  nCells: 480_000, profile: "medium", status: {}, verdict: { improved: ["maxNonOrth"], regressions: [], summary: "" } };
const appPages: [string, string, Parameters<typeof mockEngine>[1], string[]][] = [
  ["Getting started", "/app", { noJobs: true }, ["wing"]],
  ["the First run", "/app/first-run", { noJobs: true, made: { "ahmed-coarse": { template: "ahmed-body" } },
    repairs: [firstRunRepair], runs: [run("ahmed-coarse", { state: "done", step: "done", iteration: 1000, end: 1000,
      written: 1000, stretches: [{ from: 0, to: 1000 }], finished: "2026-11-24T09:00:00Z" })] },
  ["ahmed-coarse", "ahmed-coarse-fix"]],
];
for (const [label, path, opts, codes] of appPages) {
  test(`on a phone a case's name in ${label}'s running text stays whole on a line, with what's written against it`, async ({ page }) => {
    await mockEngine(page, opts);
    await page.goto(pairingLink());
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
    await page.goto(path);
    const main = page.getByRole("main");
    for (const code of codes) await expect(main.locator(".code-box code", { hasText: code }).first()).toBeVisible();
    const wrong: string[] = [];
    for (const width of [412, 360, 320]) {
      await page.setViewportSize({ width, height: 800 });
      const [found, boxes] = await codeOffItsLine(page);
      expect(boxes, `${path} at ${width} px: code checked`).toBeGreaterThanOrEqual(codes.length);
      wrong.push(...found.map((what) => `${path} at ${width} px: ${what}`));
    }
    expect(wrong).toEqual([]);
  });
}

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
    ["/app/first-run", "Steps", "of 6 done", "Each starts here, and ticks itself off"],
    ["/app", "Recent jobs", "All jobs", "Jobs of every kind, newest first"],
    ["/app", "Repair runs", "All repairs", "Newest first. The verdict compares"],
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

test("on a phone Settings' buttons line up on the left when they wrap; on a wider screen Forget this engine is apart", async ({ page }) => {
  await mockEngine(page);
  await page.goto(pairingLink());
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 5000 });
  for (const width of [320, 412, 800]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/app/settings");
    const footer = page.getByRole("button", { name: "Forget this engine" }).locator("..");
    const { left, right, buttons } = await footer.evaluate((f) => {
      const cs = getComputedStyle(f);
      const r = f.getBoundingClientRect();
      return {
        left: r.left + parseFloat(cs.paddingLeft),
        right: r.right - parseFloat(cs.paddingRight),
        buttons: [...f.children].map((b) => {
          const box = b.getBoundingClientRect();
          return { name: (b.textContent ?? "").trim(), left: box.left, right: box.right, middle: (box.top + box.bottom) / 2 };
        }),
      };
    });
    expect(buttons.map((b) => b.name)).toEqual(["Test connection", "Pair again", "Forget this engine"]);
    const lines = new Set(buttons.map((b) => Math.round(b.middle)));
    if (width < 640) {
      expect(lines.size, `${width} px: the buttons wrap`).toBeGreaterThan(1);
      // Each line starts at the left: one that starts further in is a button left on its own at the right.
      for (const [i, b] of buttons.entries()) {
        const before = buttons[i - 1];
        if (!before || Math.abs(before.middle - b.middle) > 4) {
          expect(b.left, `${width} px: ${b.name} starts its line at the left`).toBeLessThan(left + 1);
        }
      }
    } else {
      expect(lines.size, `${width} px: the buttons share a line`).toBe(1);
      expect(buttons[2]!.right, `${width} px: Forget this engine is at the right`).toBeGreaterThan(right - 1);
    }
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
  await expect(running.getByText("Solving on the repaired mesh").filter({ visible: true })).toHaveCount(1);
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

test("on a small phone the New case dialog fits the screen, with its command in a block of its own", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.emulateMedia({ reducedMotion: "reduce" }); // no pop-in while measuring
  await page.goto("/demo/solve");
  await page.getByRole("button", { name: "New case", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New case" });
  await expect(dialog.getByRole("textbox", { name: "Name of the new case" })).toHaveValue("ahmed-medium");
  const box = (await dialog.boundingBox())!;
  expect(box.x, "the dialog starts off the screen").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "the dialog ends off the screen").toBeLessThanOrEqual(360);
  const mesh = (await dialog.getByRole("radiogroup", { name: "Mesh" }).boundingBox())!;
  expect(mesh.x + mesh.width, "the mesh sizes are cut off").toBeLessThanOrEqual(box.x + box.width);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page is wider than a 360 px screen").toBeLessThanOrEqual(1);
  await expect(dialog.getByRole("button", { name: "Copy “meshdoctor new ahmed-body ahmed-medium”" })).toBeVisible();
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
  for (let i = 1; i < 10; i++) await page.keyboard.press("Enter");
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

test("on a phone the tour's Results step brings the list up, so its first case shows above the tour, not just its head", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Take the tour" }).click();
  for (let i = 1; i < 8; i++) await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Results: each solved case's forces" })).toBeVisible();
  // It stood under the page's words, with only its head above the tour's box: the page ended at the screen's foot, so
  // it couldn't go up until the page had room below it while the tour is open.
  const part = page.locator('[data-tour="results"]');
  await expect(part).toHaveAttribute("data-tour-spot", "");
  await expect(async () => {
    const list = await part.boundingBox();
    const first = await part.locator("tbody tr").first().boundingBox();
    const tour = await page.getByRole("dialog").boundingBox();
    expect(list && first && tour && list.y >= 56 && first.y + first.height <= tour.y).toBe(true);
  }).toPass({ timeout: 5000 });
});

test("on a phone the tour's Solve step keeps New case in view, above the tour, as the cards above it fill in", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Take the tour" }).click();
  for (let i = 1; i < 4; i++) await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Solve: run a case in OpenFOAM" })).toBeVisible();
  // The readiness card above it fills in once the engine answers, after the step has opened, which pushes it down.
  const part = page.locator('[data-tour="new-case"]');
  await expect(part).toHaveAttribute("data-tour-spot", "");
  await expect(async () => { // where it comes to rest
    const was = await part.boundingBox();
    await page.waitForTimeout(250);
    const now = await part.boundingBox();
    const tour = await page.getByRole("dialog").boundingBox();
    expect(was && now && tour && was.y === now.y && now.y >= 56 && now.y < tour.y).toBe(true);
  }).toPass({ timeout: 5000 });
});
