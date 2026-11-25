// SPDX-License-Identifier: GPL-3.0-or-later
// The Compare screen (GET /compare, API 1.25): the demo's recorded mesh study of the coarse and medium Ahmed bodies,
// with its table, both runs and their forces on one chart, and no other window; the same two as designs, with its
// cells warning first; two cases picked, with your own engine; an A/B test's two runs; refusals and an engine too old
// to compare; and the screen's words and numbers (compareView.ts).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import recorded from "@/demo/compare.json";
import { DEMO_COMPARE_NOTE } from "@/demo/results";
import { demoTransport } from "@/demo/transport";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import type { Compared, Comparison, ForceHistory } from "@/engine/types";
import { renderScreen } from "@/test/render";
import { ComparePage } from "./Compare";
import {
  askOf, comparePagePath, compareWindowText, meshCheck, sideText, sideWindowText, signed, signedPercent, verdictOf,
} from "./compareView";

const MESH = recorded.mesh as unknown as Comparison;
const DESIGN = recorded.design as unknown as Comparison;

const demo = (query: string) =>
  renderScreen(<ComparePage />, { path: "/demo/compare", at: `/demo/compare${query}`, transport: demoTransport(undefined, 0) });

/** The table's row for a force: the one whose cells start with its group (or follow it) and name the force. */
function forceRows() {
  return screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
}

/** Your own engine: its cases with results, the comparison it answers (`answer`, of the path asked), or a refusal;
 *  `old`: one before API 1.25, which has no /compare; each case's force history settles to 50 N of drag. */
function engine(o: { cases?: string[]; answer?: (path: string) => Comparison; refuse?: EngineError; old?: boolean } = {}) {
  const asked: string[] = [];
  const transport: Transport = {
    kind: "engine",
    scope: "test",
    request: async <T,>(_method: string, path: string) => {
      asked.push(path);
      const [route = ""] = path.split("?");
      if (route === "/results") return { items: (o.cases ?? []).map((c) => ({ case: c })), waiting: [] } as T;
      const forces = /^\/results\/([^/]+)\/forces$/.exec(route);
      if (forces) {
        const t = Array.from({ length: 101 }, (_, i) => i * 20);
        const groups = ["forceCoeffs", "forcesTotal"].map((name, k) => ({
          name, total: k === 0, n: 101, t, drag: t.map((x) => 50 + 5 * Math.exp(-x / 300)), vertical: t.map(() => 30),
        }));
        return { case: decodeURIComponent(forces[1]!), transient: false, vertical: "lift", groups } satisfies ForceHistory as T;
      }
      if (route !== "/compare" || o.old) throw new EngineError("not-found", `no such API route ${route}`, 404);
      if (o.refuse) throw o.refuse;
      return (o.answer ?? (() => MESH))(path) as T;
    },
  };
  return { transport, asked };
}

const own = (query: string, e = engine()) => ({
  ...renderScreen(<ComparePage />, { path: "/app/compare", at: `/app/compare${query}`, transport: e.transport }),
  ...e,
});

describe("the Compare screen", () => {
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

  it("compares an A/B test's two runs: no case to pick, no links to results, and no force charts", async () => {
    const ab: Comparison = {
      ...MESH, kind: "abtest",
      a: { ...MESH.a, case: "wing-fix (original mesh)", made: null }, b: { ...MESH.b, case: "wing-fix (repaired mesh)", made: null },
      groups: MESH.groups.map((g) => ({ ...g, drag: g.drag && { ...g.drag, meshOk: null }, vertical: g.vertical && { ...g.vertical, meshOk: null } })),
    };
    const e = engine({ answer: () => ab });
    own("?abtest=wing-fix", e);
    expect(await screen.findByRole("heading", { level: 1, name: "wing-fix (original mesh) against wing-fix (repaired mesh)" }))
      .toBeVisible();
    expect(screen.getByText("An A/B test's two runs: each difference below is b's less a's.")).toBeVisible();
    expect(screen.getByRole("link", { name: "A/B test" })).toHaveAttribute("href", "/app/abtests/wing-fix");
    expect(screen.queryByRole("link", { name: "wing-fix (original mesh)" })).toBeNull();
    expect(screen.queryByRole("form", { name: "What to compare" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Between the meshes" })).toBeNull();
    expect(screen.queryByRole("img", { name: /in both runs/ })).toBeNull();
    expect(e.asked).toEqual(["/compare?abtest=wing-fix"]);
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
});
