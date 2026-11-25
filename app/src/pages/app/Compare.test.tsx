// SPDX-License-Identifier: GPL-3.0-or-later
// The Compare screen (GET /compare, API 1.25): the demo's recorded mesh study of the coarse and medium Ahmed bodies,
// with its table, both runs and their forces on one chart, and no other window; the same two as designs, with its
// cells warning first; two cases picked, with your own engine; an A/B test's two runs, their forces read from the test
// (GET /abtests/{name}/forces, API 1.26; an engine of API 1.25 told it can't chart them); refusals and an engine too old
// to compare; the same picture of each, side by side (ComparePictures.tsx); and the screen's words and numbers
// (compareView.ts).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "@/demo/compare.json";
import { DEMO_COMPARE_NOTE } from "@/demo/results";
import { demoTransport } from "@/demo/transport";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import type { Compared, Comparison, ForceHistory, PictureSet, PictureSetBrief } from "@/engine/types";
import { catchDownloads } from "@/test/downloads";
import { renderScreen } from "@/test/render";
import { ComparePage } from "./Compare";
import {
  askOf, comparePagePath, compareWindowText, firstSets, madeSets, meshCheck, pictureChoices, shownPicture, sideText,
  sideWindowText, signed, signedPercent, verdictOf,
} from "./compareView";

const MESH = recorded.mesh as unknown as Comparison;
const DESIGN = recorded.design as unknown as Comparison;
/** Your own engine's A/B test wing-fix: the mesh study's numbers, as its two runs. */
const AB: Comparison = {
  ...MESH, kind: "abtest",
  a: { ...MESH.a, case: "wing-fix (original mesh)", made: null }, b: { ...MESH.b, case: "wing-fix (repaired mesh)", made: null },
  groups: MESH.groups.map((g) => ({ ...g, drag: g.drag && { ...g.drag, meshOk: null }, vertical: g.vertical && { ...g.vertical, meshOk: null } })),
};

/** A force history named `name` whose groups' drag settles to `drag` N. */
function history(name: string, drag = 50): ForceHistory {
  const t = Array.from({ length: 101 }, (_, i) => i * 20);
  const groups = ["forceCoeffs", "forcesTotal"].map((g, k) => ({
    name: g, total: k === 0, n: 101, t, drag: t.map((x) => drag + 5 * Math.exp(-x / 300)), vertical: t.map(() => 30),
  }));
  return { case: name, transient: false, vertical: "lift", groups };
}

const demo = (query: string) =>
  renderScreen(<ComparePage />, { path: "/demo/compare", at: `/demo/compare${query}`, transport: demoTransport(undefined, 0) });

/** The table's row for a force: the one whose cells start with its group (or follow it) and name the force. */
function forceRows() {
  return screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
}

/** A set of pictures of case `name` at written time `set`, made an hour ago (null: its first job is making it), with
 *  a picture for each file (`kind/name.png`). */
const pictureSet = (name: string, set: string, files: string[], made: string | null = "2026-11-25T10:00:00Z"): PictureSet => ({
  case: name, set, time: set, mean: false, kinds: ["cuts", "vortices"], made, notes: [],
  pictures: files.map((f) => ({ file: f, kind: f.startsWith("cuts/") ? "cuts" : "vortices", title: `${f.slice(f.indexOf("/") + 1, -4)} picture` })),
});

/** Your own engine: its cases with results, the comparison it answers (`answer`, of the path asked), or a refusal;
 *  `old`: one before API 1.25, which has no /compare, `api125` one of API 1.25, which has no A/B test's forces; each
 *  case's force history settles to 50 N of drag, an A/B test's original mesh's too and its repaired mesh's to 49 N.
 *  `sets`: its sets of pictures (none by default), each picture a PNG's first bytes; `fetched`, the pictures asked for. */
function engine(o: {
  cases?: string[]; answer?: (path: string) => Comparison; refuse?: EngineError; old?: boolean; api125?: boolean;
  sets?: PictureSet[];
} = {}) {
  const asked: string[] = [];
  const fetched: string[] = [];
  const sets = o.sets ?? [];
  const transport: Transport = {
    kind: "engine",
    scope: "test",
    request: async <T,>(_method: string, path: string) => {
      asked.push(path);
      const [route = ""] = path.split("?");
      if (route === "/jobs") return { items: [] } as T;
      if (route === "/pictures") {
        const of = new URLSearchParams(path.split("?")[1] ?? "").get("case");
        const items: PictureSetBrief[] = sets.filter((s) => s.case === of).map((s) => ({
          case: s.case, set: s.set, time: s.time, mean: s.mean, kinds: s.kinds, made: s.made,
          count: s.made ? s.pictures.length : null, job: s.made ? null : { id: `20261125-100000-pictures-${s.case}-0001`, state: "running" },
        }));
        return { items } as T;
      }
      const set = /^\/pictures\/([^/]+)\/([^/]+)$/.exec(route);
      if (set) {
        const found = sets.find((s) => s.case === decodeURIComponent(set[1]!) && s.set === decodeURIComponent(set[2]!));
        if (!found) throw new EngineError("not-found", "no such set", 404);
        return structuredClone(found) as T;
      }
      if (route === "/results") return { items: (o.cases ?? []).map((c) => ({ case: c })), waiting: [] } as T;
      const forces = /^\/results\/([^/]+)\/forces$/.exec(route);
      if (forces) return history(decodeURIComponent(forces[1]!)) as T;
      const runForces = /^\/abtests\/([^/]+)\/forces$/.exec(route);
      if (runForces && !o.old && !o.api125) {
        const fixed = new URLSearchParams(path.split("?")[1] ?? "").get("side") === "fixed";
        return history(`${decodeURIComponent(runForces[1]!)} (${fixed ? "repaired" : "original"} mesh)`, fixed ? 49 : 50) as T;
      }
      if (route !== "/compare" || o.old) throw new EngineError("not-found", `no such API route ${route}`, 404);
      if (o.refuse) throw o.refuse;
      return (o.answer ?? (() => MESH))(path) as T;
    },
    blob: async (path: string) => {
      fetched.push(path);
      return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    },
  };
  return { transport, asked, fetched };
}

const own = (query: string, e = engine()) => ({
  ...renderScreen(<ComparePage />, { path: "/app/compare", at: `/app/compare${query}`, transport: e.transport }),
  ...e,
});

describe("the Compare screen", () => {
  // Pictures show through blob: URLs, which jsdom hasn't; the demo's are the bundle's, fetched.
  let files: ReturnType<typeof catchDownloads>;
  beforeEach(() => {
    files = catchDownloads();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0x89, 0x50]), { headers: { "Content-Type": "image/png" } })));
  });
  afterEach(() => {
    files.restore();
    vi.unstubAllGlobals();
  });

  it("shows the demo's mesh study: each force's difference, its verdict and mesh check, both runs and their forces", async () => {
    demo("?a=ahmed-25-coarse&b=ahmed-25-medium&mesh=true");
    expect(await screen.findByRole("heading", { level: 1, name: "ahmed-25-coarse against ahmed-25-medium" })).toBeVisible();
    expect(screen.getByText("A mesh study: one design at two mesh sizes · recorded demo")).toBeVisible();
    expect(screen.queryByRole("note")).toBeNull();                       // both half models of one design: no warning
    expect(screen.getByText("Both averaged after iteration 1,600, up to 2,000: from the later of their judges' starts, "
      + "up to the shorter run's end.")).toBeVisible();
    // the two runs, each a link to its own results, with its cells and the judge's verdict
    const a = screen.getByRole("link", { name: "ahmed-25-coarse" });
    expect(a).toHaveAttribute("href", "/demo/results/ahmed-25-coarse");
    expect(screen.getByText("Steady · 478,901 cells · 400 values")).toBeVisible();
    expect(screen.getByText("Steady · 835,565 cells · 400 values")).toBeVisible();
    // the table: the total group's drag 6.2 % lower on the finer mesh, real and more than it swings; its lift inside the
    // noise and less than it swings; the second group says the same
    expect(screen.getByRole("columnheader", { name: "Between the meshes" })).toBeVisible();
    const rows = forceRows();
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatch(/^forceCoeffsTotalDrag16\.1215\.13−0\.994−6\.2 %0\.023RealMoves more than it swings$/);
    expect(rows[1]).toMatch(/^Lift16\.0715\.94−0\.126−0\.8 %0\.14Inside the noiseMoves less than it swings$/);
    expect(rows[2]).toMatch(/^forcesTotalDrag/);
    // both runs' forces, a's line solid and b's dashed, each chart with the window shaded
    expect(await screen.findByRole("img", { name: "Drag of forceCoeffs in both runs, in N" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Lift of forceCoeffs in both runs, in N" })).toBeVisible();
    const lines = screen.getByRole("list", { name: "Lines" });
    expect(within(lines).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["a: ahmed-25-coarse", "b: ahmed-25-medium"]);
    expect(screen.getAllByRole("slider", { name: "Start of the averaged part" })[0]).toHaveAttribute("aria-valuenow", "1600");
    // the other group's charts
    await userEvent.selectOptions(screen.getByLabelText("Force group"), "forcesTotal");
    expect(await screen.findByRole("img", { name: "Drag of forcesTotal in both runs, in N" })).toBeVisible();
    // the same picture of each: the demo's coarse case has no set, so the medium one's pictures show alone
    expect(screen.getByRole("heading", { name: "The same picture of each" })).toBeVisible();
    expect(screen.getByText("No pictures of ahmed-25-coarse yet.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Make pictures of ahmed-25-coarse…" })).toBeVisible();
    expect(within(await screen.findByLabelText("Picture")).getAllByRole("option")).toHaveLength(5);
    const cut = await screen.findByRole("img", { name: /^Side cut on the centreline.+Cp,t, of ahmed-25-medium at written time 2000$/ });
    await waitFor(() => expect(cut.getAttribute("src")).toMatch(/^blob:test\//));
    expect(screen.getByRole("link", { name: "Open its set of ahmed-25-medium" })).toHaveAttribute("href", "/demo/pictures/ahmed-25-medium/2000");
  });

  it("puts the two designs' cells warning first, and says the demo can't average them over another window", async () => {
    const { router } = demo("?a=ahmed-25-coarse&b=ahmed-25-medium");
    expect(await screen.findByText("Two designs · recorded demo")).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent(
      "Before you trust a differenceTheir meshes differ by 74.5 % in cells (478,901 and 835,565)");
    expect(screen.queryByRole("columnheader", { name: "Between the meshes" })).toBeNull();
    expect(forceRows()[0]).toMatch(/Real$/);
    await userEvent.type(screen.getByLabelText("From (iteration)"), "1000");
    await userEvent.click(screen.getByRole("button", { name: "Average" }));
    expect(router.state.location.search).toBe("?a=ahmed-25-coarse&b=ahmed-25-medium&from=1000");
    expect(await screen.findByText("Not in the demo")).toBeVisible();
    expect(screen.getByText(DEMO_COMPARE_NOTE)).toBeVisible();
    // its window card stays, to go back to their judges' window
    await userEvent.click(screen.getByRole("button", { name: "Their judges' window" }));
    expect(router.state.location.search).toBe("?a=ahmed-25-coarse&b=ahmed-25-medium");
    expect(await screen.findByText("Two designs · recorded demo")).toBeVisible();
  });

  it("picks the case to compare with: two different ones, as a mesh study or not, then asks your engine", async () => {
    const e = engine({ cases: ["wing", "wing-v2", "motorBike"] });
    const { router } = own("?a=wing", e);
    expect(await screen.findByRole("heading", { name: "Pick a case to compare with wing" })).toBeVisible();
    const b = screen.getByLabelText("Case b");
    await waitFor(() => expect(within(b).getAllByRole("option").map((o) => o.textContent))
      .toEqual(["Pick a case", "wing", "wing-v2", "motorBike"]));
    expect(screen.getByLabelText("Case a")).toHaveValue("wing");
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByText("Pick two cases to compare.")).toBeVisible();
    await userEvent.selectOptions(b, "wing");
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByText("Pick two different cases.")).toBeVisible();
    expect(e.asked.some((p) => p.startsWith("/compare"))).toBe(false);
    await userEvent.selectOptions(b, "wing-v2");
    await userEvent.click(screen.getByLabelText(/A mesh study/));
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(router.state.location.search).toBe("?a=wing&b=wing-v2&mesh=true");
    expect(await screen.findByRole("heading", { level: 1, name: "ahmed-25-coarse against ahmed-25-medium" })).toBeVisible();
    expect(e.asked).toContain("/compare?a=wing&b=wing-v2&mesh=true");
    // dragging the window's start (here a key) asks for it over another window, kept in the address
    const start = (await screen.findAllByRole("slider", { name: "Start of the averaged part" }))[0]!;
    start.focus();
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    await waitFor(() => expect(router.state.location.search).toMatch(/^\?a=wing&b=wing-v2&mesh=true&from=1\d\d0$/));
  });

  it("compares an A/B test's two runs: no case to pick, no links to results, its runs' forces read from the test", async () => {
    const e = engine({ answer: () => AB });
    own("?abtest=wing-fix", e);
    expect(await screen.findByRole("heading", { level: 1, name: "wing-fix (original mesh) against wing-fix (repaired mesh)" }))
      .toBeVisible();
    expect(screen.getByText("An A/B test's two runs: each difference below is b's less a's.")).toBeVisible();
    expect(screen.getByRole("link", { name: "A/B test" })).toHaveAttribute("href", "/app/abtests/wing-fix");
    expect(screen.queryByRole("link", { name: "wing-fix (original mesh)" })).toBeNull();
    expect(screen.queryByRole("form", { name: "What to compare" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Between the meshes" })).toBeNull();
    // both runs' forces on one chart each, read from the A/B test (API 1.26), not as two cases: and no pictures
    expect(await screen.findByRole("img", { name: "Drag of forceCoeffs in both runs, in N" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Lift of forceCoeffs in both runs, in N" })).toBeVisible();
    expect(screen.getByRole("list", { name: "Lines" })).toHaveTextContent("a: wing-fix (original mesh)b: wing-fix (repaired mesh)");
    expect(new Set(e.asked)).toEqual(new Set([
      "/compare?abtest=wing-fix", "/abtests/wing-fix/forces?side=base", "/abtests/wing-fix/forces?side=fixed",
    ]));
    expect(screen.queryByRole("heading", { name: "The same picture of each" })).toBeNull();
  });

  it("tells an engine of API 1.25 it can't chart an A/B test's runs yet: its table still compares them", async () => {
    own("?abtest=wing-fix", engine({ answer: () => AB, api125: true }));
    expect(await screen.findByText("Your engine can't chart an A/B test's runs yet")).toBeVisible();
    expect(screen.getByText(/older than these charts \(it speaks API 1\.25\)/)).toBeVisible();
    expect(forceRows()).toHaveLength(4);
    expect(screen.queryByRole("img", { name: /in both runs/ })).toBeNull();
  });

  it("in the demo, compares its finished A/B test's two runs: the same forces on both meshes, both still drifting", async () => {
    demo("?abtest=ahmed25-coarse-fix");
    expect(await screen.findByRole("heading", {
      level: 1, name: "ahmed25-coarse-fix (original mesh) against ahmed25-coarse-fix (repaired mesh)",
    })).toBeVisible();
    expect(screen.getByText("An A/B test's two runs · recorded demo")).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent(/still drifting over the window \(over 1 % between their halves\)/);
    expect(screen.getByRole("link", { name: "A/B test" })).toHaveAttribute("href", "/demo/abtests/ahmed25-coarse-fix");
    expect(screen.getByText(/^Both averaged after iteration 1, up to 201: /)).toBeVisible();
    const rows = forceRows();
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatch(/^forcesTotalTotalDrag17\.1317\.1300 %7\.5Inside the noise$/);
    expect(rows.every((r) => /0 %[\d.]+Inside the noise$/.test(r))).toBe(true);    // every force the same on both
    // both runs' forces, recorded from the same test: one line on the other, the window over the whole of both
    expect(await screen.findByRole("img", { name: "Drag of forcesTotal in both runs, in N" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Lift of forcesTotal in both runs, in N" })).toBeVisible();
    expect(screen.getAllByRole("slider", { name: "Start of the averaged part" })[0]).toHaveAttribute("aria-valuenow", "1");
  });

  it("puts the same picture of each side by side: of a set of the same written time first, another picked of either", async () => {
    const cuts = ["cuts/c1_side_U.png", "cuts/c3_wake_Cpt.png"];
    const e = engine({
      sets: [pictureSet("ahmed-25-coarse", "1000", [...cuts, "vortices/Q20000_rear34.png"]),
        pictureSet("ahmed-25-coarse", "2000", [...cuts, "vortices/Q20000_rear34.png"]),
        pictureSet("ahmed-25-medium", "2000", [...cuts, "cuts/c4_only_medium.png", "vortices/Q20000_rear34.png"])],
    });
    own("?a=ahmed-25-coarse&b=ahmed-25-medium&mesh=true", e);
    expect(await screen.findByRole("heading", { name: "The same picture of each" })).toBeVisible();
    // a's newest set is 1000, but both have 2000: that first; b has one set, so no list for it
    expect(await screen.findByLabelText("a's set")).toHaveValue("2000");
    expect(screen.queryByLabelText("b's set")).toBeNull();
    // the pictures both have, by kind, the first cut shown
    const pick = await screen.findByLabelText("Picture");
    expect(within(pick).getAllByRole("group").map((g) => g.getAttribute("label"))).toEqual(["Cuts", "Vortices"]);
    expect(within(pick).getAllByRole("option").map((x) => x.textContent))
      .toEqual(["c1_side_U picture", "c3_wake_Cpt picture", "Q20000_rear34 picture"]);
    await waitFor(() => expect(e.fetched).toEqual(
      ["/pictures/ahmed-25-coarse/2000/cuts/c1_side_U.png", "/pictures/ahmed-25-medium/2000/cuts/c1_side_U.png"]));
    for (const img of screen.getAllByRole("img", { name: /^c1_side_U picture, of / })) {
      await waitFor(() => expect(img.getAttribute("src")).toMatch(/^blob:test\//));
    }
    // another picture, then a's other set: each side asks for its own
    await userEvent.selectOptions(pick, "vortices/Q20000_rear34.png");
    await waitFor(() => expect(e.fetched).toContain("/pictures/ahmed-25-medium/2000/vortices/Q20000_rear34.png"));
    await userEvent.selectOptions(screen.getByLabelText("a's set"), "1000");
    await waitFor(() => expect(e.fetched).toContain("/pictures/ahmed-25-coarse/1000/vortices/Q20000_rear34.png"));
    expect(screen.getByRole("link", { name: "Open its set of ahmed-25-coarse" })).toHaveAttribute("href", "/app/pictures/ahmed-25-coarse/1000");
    expect(screen.getByText("written time 1000", { selector: "figcaption span" })).toBeVisible();
  });

  it("says when two sets have no picture in common, a case has none, or its first set is being made", async () => {
    const first = own("?a=ahmed-25-coarse&b=ahmed-25-medium", engine({
      sets: [pictureSet("ahmed-25-coarse", "2000", ["cuts/c1.png"]), pictureSet("ahmed-25-medium", "2000", ["cuts/c9.png"])],
    }));
    expect(await screen.findByText(/^These two sets have no picture in common\./)).toBeVisible();
    expect(screen.queryByLabelText("Picture")).toBeNull();
    first.unmount();

    own("?a=ahmed-25-coarse&b=ahmed-25-medium", engine({
      sets: [pictureSet("ahmed-25-medium", "2000", ["cuts/c1.png"], null)],
    }));
    expect(await screen.findByText("No pictures of ahmed-25-coarse yet.")).toBeVisible();
    expect(screen.getByText("Its first set of pictures is being made: it shows here once made.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Make pictures of ahmed-25-medium…" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Make pictures of ahmed-25-coarse…" }));
    expect(await screen.findByRole("dialog", { name: "Make pictures of ahmed-25-coarse" })).toBeVisible();
  });

  it("says why it can't compare, with the cases to pick again, and that an older engine can't", async () => {
    const first = own("?a=wing&b=nope", engine({ cases: ["wing"], refuse: new EngineError("not-found", "no case nope in the cases folder", 404) }));
    expect(await screen.findByText("Nothing to compare")).toBeVisible();
    expect(screen.getByText("No case nope in the cases folder")).toBeVisible();
    expect(screen.getByRole("form", { name: "What to compare" })).toBeVisible();
    first.unmount();

    own("?a=wing&b=wing-v2", engine({ old: true }));
    expect(await screen.findByText("Your engine can't compare runs yet")).toBeVisible();
    expect(screen.getByText(/speaks API 1\.24 or older/)).toBeVisible();
  });
});

describe("the Compare screen's words and numbers", () => {
  it("keeps what it compares in its address", () => {
    expect(comparePagePath()).toBe("/compare");
    expect(comparePagePath({ a: "wing" })).toBe("/compare?a=wing");
    expect(comparePagePath({ a: "a b", b: "c", mesh: true, from: 1000, to: null })).toBe("/compare?a=a+b&b=c&mesh=true&from=1000");
    expect(comparePagePath({ abtest: "wing-fix", a: "ignored", mesh: true, to: 0.5 })).toBe("/compare?abtest=wing-fix&to=0.5");
    const ask = askOf(new URLSearchParams("a=wing&b=&mesh=true&from=x&to=2000"));
    expect(ask).toEqual({ a: "wing", b: null, abtest: null, mesh: true, from: null, to: 2000 });
    expect(askOf(new URLSearchParams("a=w&b=v&mesh=1")).mesh).toBe(false);
  });

  it("words a difference, its verdict, a mesh study's check and the window", () => {
    expect([signed(-0.99431), signed(6.893), signed(0), signed(null), signed(-0.0136, 3)]).toEqual(["−0.994", "+6.89", "0", "–", "−0.0136"]);
    expect([signedPercent(-6.168), signedPercent(45.6), signedPercent(0.04), signedPercent(null)]).toEqual(["−6.2 %", "+45.6 %", "0 %", "–"]);
    const x = (more: Partial<Compared>): Compared =>
      ({ a: 16, b: 15, diff: -1, pct: -6.25, noise: 0.02, real: true, swing: 0.45, meshOk: null, small: false, ...more });
    expect([verdictOf(x({})), verdictOf(x({ real: false })), verdictOf(x({ real: null }))].map((v) => [v.text, v.tone])).toEqual([
      ["Real", "primary"], ["Inside the noise", "neutral"], ["Too few values", "neutral"]]);
    expect(meshCheck(x({}))).toBeNull();
    expect(meshCheck(x({ meshOk: true }))).toEqual({ text: "Moves less than it swings", tone: "success" });
    expect(meshCheck(x({ meshOk: false }))).toEqual({ text: "Moves more than it swings", tone: "warning" });
    expect(compareWindowText({ ...MESH, window: { from: 1000, to: 1500, how: "given" } }))
      .toBe("Both averaged after iteration 1,000, up to 1,500: the window asked for.");
    expect(compareWindowText({ ...MESH, a: { ...MESH.a, transient: true }, window: { from: null, to: 0.3, how: "judges" } }))
      .toBe("Both averaged up to 0.3 s: from the later of their judges' starts, up to the shorter run's end.");
    expect(compareWindowText({ ...DESIGN, window: null })).toMatch(/^Each averaged over its own judge's window/);
    const made = { ...MESH.a, made: { template: "ahmed-body", size: "coarse" } };
    expect(sideText(made)).toBe("Steady · 478,901 cells · made from ahmed-body (coarse) · 400 values");
    expect(sideWindowText(MESH.a)).toBe("its judge's window: after iteration 1,600, up to 2,000");
  });

  it("picks the sets and the pictures to put side by side", () => {
    const brief = (name: string, set: string, made: string | null = "2026-11-25T10:00:00Z"): PictureSetBrief =>
      ({ case: name, set, time: set, mean: false, kinds: ["cuts"], made, count: 1, job: null });
    // a set of the same name in both first, the newest of a's that b has too; else each one's newest made
    expect(firstSets([brief("a", "3000"), brief("a", "2000"), brief("a", "1000")], [brief("b", "1000"), brief("b", "2000")]))
      .toEqual(["2000", "2000"]);
    expect(firstSets([brief("a", "3000", null), brief("a", "2000")], [brief("b", "1000")])).toEqual(["2000", "1000"]);
    expect(firstSets([], [brief("b", "1000")])).toEqual([null, "1000"]);
    expect(madeSets([brief("a", "1", null), brief("a", "2")]).map((s) => s.set)).toEqual(["2"]);
    // the pictures both have in a's order, a cut over time's left out; one side's own when the other has none
    const a = pictureSet("a", "2000", ["vortices/q.png", "cuts/c1.png", "cuts/c2.png"]);
    const b = pictureSet("b", "2000", ["cuts/c2.png", "cuts/c1.png"]);
    a.pictures.push({ file: "times/c1_U_0100.png", kind: "times", title: "at 100" });
    expect(pictureChoices(a, b)?.map((p) => p.file)).toEqual(["cuts/c1.png", "cuts/c2.png"]);
    expect(pictureChoices(null, a)?.map((p) => p.file)).toEqual(["vortices/q.png", "cuts/c1.png", "cuts/c2.png"]);
    expect(pictureChoices(a, undefined)).toBeUndefined();
    expect(pictureChoices(null, null)).toEqual([]);
    // the one picked while it is a choice, else the first cut, else the first
    const choices = pictureChoices(null, a)!;
    expect(shownPicture(choices, "cuts/c2.png")?.file).toBe("cuts/c2.png");
    expect(shownPicture(choices, "gone.png")?.file).toBe("cuts/c1.png");
    expect(shownPicture(choices.slice(0, 1), null)?.file).toBe("vortices/q.png");
    expect(shownPicture(undefined, null)).toBeUndefined();
  });
});
