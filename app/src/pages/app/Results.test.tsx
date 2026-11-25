// SPDX-License-Identifier: GPL-3.0-or-later
// The Results screen (GET /results, API 1.23): each case's drag, downforce or lift, L/D, verdict and drift over the
// judge's window, the cases not averaged yet, and an engine too old to say; a case's page (GET /results/{case}) with
// its headline numbers, warnings, every force group's forces and coefficients and its residuals, and another window
// asked for in its address, which the engine (or the demo, which can't) answers.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DEMO_RESULTS_NOTE } from "@/demo/results";
import { demoTransport } from "@/demo/transport";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import type { CaseResults, ForceHistory, ResultForce, ResultsList } from "@/engine/types";
import { renderScreen } from "@/test/render";
import { CaseResultsPage } from "./CaseResults";
import { Results } from "./Results";
import { chartWindow, headlineDrift, resultsPagePath, waitingParts, windowOf, windowProblem } from "./resultsView";

const ago = (ms: number) => new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const force = (mean: number, more: Partial<ResultForce> = {}): ResultForce =>
  ({ mean, sd: 0.448, drift: 0.002, u: 0.0097, n: 400, ...more });

/** A steady case's results over the judge's window: its total group, and a mirror too small for its drift to count. */
function results(name: string, more: Partial<CaseResults> = {}): CaseResults {
  return {
    schemaVersion: "1.1", case: name, transient: false, axes: { flow: "-x", up: "z", vertical: "lift" },
    Uinf: 40, rho: 1.205, q: 964, cells: 478_901, updated: ago(3_600_000), start: 0, end: 2000,
    window: { from: 1600, to: 2000, how: "judge", n: 400 },
    groups: [
      {
        name: "forceCoeffs", total: true, patches: ["body"], drag: force(16.1191), vertical: force(16.066, { drift: 0.0079, u: 0.101 }),
        CdA: 0.016721, ClA: 0.016666, LD: 0.9967, Aref: 0.056, Cd: 0.29859, Cl: 0.29761,
      },
      {
        name: "mirrors", total: false, patches: ["mirrorL", "mirrorR"], drag: force(0.05, { drift: 0.3 }),
        vertical: force(0.01, { drift: 0.5 }), CdA: 5.2e-5, ClA: 1e-5, LD: 0.2, Aref: null, Cd: null, Cl: null,
      },
    ],
    residuals: { p: { first: 1, final: 0.0139, orders: 1.86 }, Ux: { first: 0.28, final: 0.00645, orders: 1.64 } },
    verdict: "converged (steady)", symmetry: [], warnings: [], ...more,
  };
}

/** Its force history as GET /results/{case}/forces gives it (API 1.24): each group's, at 201 of its 2,001 values from
 *  its forces' start to their end (every 10th iteration of 2,000), settling to its mean with a small swing. */
function history(doc: CaseResults): ForceHistory {
  const t = Array.from({ length: 201 }, (_, i) => doc.start + (i * (doc.end - doc.start)) / 200);
  const settle = (mean: number, swing: number) => t.map((_, i) => mean * (1 + 0.5 * Math.exp(-i / 20)) + swing * Math.sin(i / 3));
  return {
    case: doc.case, transient: doc.transient, vertical: doc.axes.vertical,
    groups: doc.groups.map((g) => ({
      name: g.name, total: g.total, n: 2001, t, drag: settle(g.drag?.mean ?? 0, 0.1), vertical: settle(g.vertical?.mean ?? 0, 0.3),
    })),
  };
}

/** Your own engine with these results; `waiting`: the cases it can't average yet; `old`: one before API 1.23, which
 * has no results routes; `oldForces`: one of API 1.23, with no force histories; `refuse`: what it answers for a case.
 * A window asked for is averaged as given, with 20 N of drag, unless it starts at or after the forces' end. */
function engine(o: {
  docs?: CaseResults[]; waiting?: ResultsList["waiting"]; old?: boolean; oldForces?: boolean; refuse?: Record<string, EngineError>;
} = {}) {
  const asked: string[] = [];
  const transport: Transport = {
    kind: "engine",
    scope: "test",
    request: async <T,>(_method: string, path: string) => {
      asked.push(path);
      const [route = "", query = ""] = path.split("?");
      if (o.old) throw new EngineError("not-found", "no such API route", 404);
      if (route === "/results") return { items: o.docs ?? [], waiting: o.waiting ?? [] } as T;
      const m = /^\/results\/([^/]+)(\/forces)?$/.exec(route);
      if (!m || (m[2] && o.oldForces)) throw new EngineError("not-found", `no such API route ${route}`, 404);
      const name = decodeURIComponent(m[1]!);
      const refused = o.refuse?.[name];
      if (refused) throw refused;
      const doc = (o.docs ?? []).find((d) => d.case === name);
      if (!doc) throw new EngineError("not-found", `no case ${name} in the cases folder`, 404);
      if (m[2]) return history(doc) as T;
      const q = new URLSearchParams(query);
      if (!q.has("from") && !q.has("to")) return structuredClone(doc) as T;
      const from = q.has("from") ? Number(q.get("from")) : doc.window.from!;
      const to = q.has("to") ? Number(q.get("to")) : doc.end;
      if (from >= doc.end) {
        throw new EngineError("not-ready", `${name}'s forces end at ${doc.end}, before the window's from (${from}): pick an earlier one`, 409);
      }
      const given = structuredClone(doc);
      given.window = { from, to, how: "given", n: to - from };
      given.groups[0]!.drag = force(20);
      return given as T;
    },
  };
  return { transport, asked };
}

const list = (e = engine()) => ({ ...renderScreen(<Results />, { path: "/app/results", transport: e.transport }), ...e });
const page = (name: string, e = engine(), query = "") => ({
  ...renderScreen(<CaseResultsPage />, { path: "/app/results/:name", at: `/app/results/${name}${query}`, transport: e.transport }),
  ...e,
});
const row = (name: string) => screen.getByRole("link", { name }).closest("tr")!;

describe("the Results screen's words", () => {
  it("puts a window in the page's address and reads it back, refusing what isn't one", () => {
    expect(resultsPagePath("car")).toBe("/results/car");
    expect(resultsPagePath("a b", { from: 1000, to: null })).toBe("/results/a%20b?from=1000");
    expect(resultsPagePath("car", { from: 0.1, to: 0.3 })).toBe("/results/car?from=0.1&to=0.3");
    expect(windowOf(new URLSearchParams("from=1000&to=1500"))).toEqual({ from: 1000, to: 1500 });
    expect(windowOf(new URLSearchParams("from=-1&to=x"))).toEqual({ from: null, to: null });
    expect(windowProblem("", "")).toBeNull();
    expect(windowProblem("1000", "")).toBeNull();
    expect(windowProblem("x", "")).toBe("From must be a number of 0 or more.");
    expect(windowProblem("", "-5")).toBe("To must be a number of 0 or more.");
    expect(windowProblem("2000", "1000")).toBe("From must come before To.");
  });

  it("shades the window the address asks for on the charts, else the one averaged over, up to the end without a To", () => {
    const doc = results("car");
    expect(chartWindow({ from: null, to: null }, doc)).toEqual({ from: 1600, to: null });
    expect(chartWindow({ from: 1000, to: null }, doc)).toEqual({ from: 1000, to: null });
    expect(chartWindow({ from: null, to: 1800 }, doc)).toEqual({ from: 1600, to: 1800 });
    expect(chartWindow({ from: 500, to: 900 }, undefined)).toEqual({ from: 500, to: 900 });
    expect(chartWindow({ from: null, to: 900 }, undefined)).toBeNull();
    const short = results("car", { window: { from: 1600, to: 1900, how: "judge", n: 300 } });
    expect(chartWindow({ from: null, to: null }, short)).toEqual({ from: 1600, to: 1900 });
  });

  it("judges only a drift of a force large enough, as the engine does, and stands a waiting case's name out", () => {
    expect(headlineDrift(results("car"))).toBe(0.0079);
    // a lift of 0.05 N against 16 N of drag is too small for its drift to count
    const tiny = results("car");
    tiny.groups[0]!.vertical = force(0.05, { drift: 0.9 });
    expect(headlineDrift(tiny)).toBe(0.002);
    expect(waitingParts({ case: "run1", why: "run1 has too few forces to average yet" })).toEqual(["run1", " has too few forces to average yet"]);
    expect(waitingParts({ case: "run1", why: "run1's force files couldn't be read" })).toEqual(["run1", "'s force files couldn't be read"]);
    expect(waitingParts({ case: "run1", why: "something else" })).toEqual(["run1", ": something else"]);
  });
});

describe("Results", () => {
  it("lists each case's drag, lift, L/D, verdict and drift over the judge's window, each linked to its page", async () => {
    const drifting = results("wing", { verdict: "not converged (plateau/oscillation)", updated: ago(7_200_000) });
    drifting.groups[0]!.vertical = force(120.5, { drift: 0.031, u: 2.4 });
    drifting.axes.vertical = "downforce";
    list(engine({ docs: [results("car"), drifting] }));

    const car = within(await waitFor(() => row("car")));
    expect(screen.getByRole("link", { name: "car" })).toHaveAttribute("href", "/app/results/car");
    expect(car.getByText(/Steady · iterations 0 to 2,000 · 479 k cells/)).toBeInTheDocument();
    expect(car.getByText("16.12")).toBeInTheDocument();
    expect(car.getByText("± 0.0097")).toBeInTheDocument();
    expect(car.getByText("16.07")).toBeInTheDocument();
    expect(car.getByText("lift ± 0.1")).toBeInTheDocument();
    expect(car.getByText("0.997")).toBeInTheDocument();
    expect(car.getByText("converged (steady)")).toBeInTheDocument();
    expect(car.getByText("0.8 %")).toBeInTheDocument();
    expect(car.getByText("1 hour ago")).toBeInTheDocument();
    // only its total group: the mirrors' 30 % drift isn't its headline
    expect(car.queryByText("30.0 %")).not.toBeInTheDocument();

    const wing = within(row("wing"));
    expect(wing.getByText("downforce ± 2.4")).toBeInTheDocument();
    expect(wing.getByText("not converged (plateau/oscillation)")).toBeInTheDocument();
    expect(wing.getByText("3.1 %").closest("[title]")).toHaveAttribute("title", expect.stringMatching(/run it longer before comparing/));
    expect(screen.queryByText("Not averaged yet")).not.toBeInTheDocument();
  });

  it("lists the cases it can't average yet, and why", async () => {
    list(engine({ docs: [results("car")], waiting: [{ case: "run2", why: "run2 has too few forces to average yet: let it solve longer" }] }));
    expect(await screen.findByText("Not averaged yet")).toBeInTheDocument();
    expect(screen.getByText("run2")).toHaveClass("font-medium");
    expect(screen.getByText("has too few forces to average yet: let it solve longer")).toBeInTheDocument();
  });

  it("says how a case gets results when none has any, and points to Solve", async () => {
    list(engine({ waiting: [{ case: "run2", why: "run2 has too few forces to average yet: let it solve longer" }] }));
    expect(await screen.findByText("No results yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Solve" })).toHaveAttribute("href", "/app/solve");
    expect(screen.getByText("Not averaged yet")).toBeInTheDocument();
  });

  it("says an engine before API 1.23 can't show results, and asks it only once", async () => {
    const { asked } = list(engine({ old: true }));
    expect(await screen.findByText("Your engine can't show results yet")).toBeInTheDocument();
    expect(screen.getByText(/API 1\.22 or older/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(asked).toEqual(["/results"]);
  });

  it("says why the list didn't load", async () => {
    const e = engine();
    e.transport.request = async () => { throw new EngineError("internal", "boom", 500); };
    list(e);
    expect(await screen.findByText("The results didn't load")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The engine hit an error");
  });
});

describe("a case's results", () => {
  it("shows its headline numbers, its forces and coefficients by group, its residuals and its window", async () => {
    page("car", engine({ docs: [results("car")] }));
    expect(await screen.findByText("16.12 N")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "car" })).toBeInTheDocument();
    expect(screen.getByText(/Results · Steady, iterations 0 to 2,000 · 479 k cells · forces written 1 hour ago/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Results" })).toHaveAttribute("href", "/app/results");
    expect(screen.getByText("± 0.0097 N · drift 0.2 %")).toBeInTheDocument();
    expect(screen.getByText("Lift")).toBeInTheDocument();
    expect(screen.getByText("16.07 N")).toBeInTheDocument();
    expect(screen.getByText("Lift over drag")).toBeInTheDocument();
    expect(screen.getByText("0.01672 m²")).toBeInTheDocument();
    expect(screen.getByText("Cd 0.2986, over its forceCoeffs's 0.056 m²")).toBeInTheDocument();
    expect(screen.getByText("Averaged over the judge's window: after iteration 1,600, up to 2,000 (400 values)")).toBeInTheDocument();
    expect(screen.getByText("converged (steady)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "The judge's window" })).toBeDisabled();

    // each group in both tables, the total one marked
    expect(screen.getAllByText("Total")).toHaveLength(2);
    expect(screen.getAllByText("mirrorL, mirrorR")).toHaveLength(2);
    // the mirrors are too small for their drift to warn of
    expect(screen.getByText("30.0 %").closest("[title]")).toBeNull();
    expect(screen.getByText(/CdA and ClA are each force over q, ½ ρ U² = 964 Pa \(ρ 1\.205 kg\/m³, U 40 m\/s\)/)).toBeInTheDocument();
    expect(screen.getByText("p")).toBeInTheDocument();
    expect(screen.getByText("1.9 orders")).toBeInTheDocument();
    expect(screen.getByText("0.00645")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("says its warnings first, and marks a drift over 1 %", async () => {
    const doc = results("car", { warnings: ["Still drifting over the window (over 1 % between its two halves): forceCoeffs drag 2.0 %. Run longer before comparing these with another run."] });
    doc.groups[0]!.drag = force(16.1, { drift: 0.02 });
    page("car", engine({ docs: [doc] }));
    expect(await screen.findByRole("note")).toHaveTextContent(/Before you compare it.*forceCoeffs drag 2\.0 %/);
    expect(screen.getByText("± 0.0097 N · drift 2.0 %")).toBeInTheDocument();
    expect(screen.getByText("2.0 %").closest("[title]")).toHaveAttribute("title", expect.stringMatching(/run it longer/));
  });

  it("averages over a window typed in, keeps it in the address, and goes back to the judge's", async () => {
    const user = userEvent.setup();
    const { asked, router } = page("car", engine({ docs: [results("car")] }));
    await screen.findByText("16.12 N");
    await user.type(screen.getByLabelText("From (iteration)"), "1000");
    await user.click(screen.getByRole("button", { name: "Average" }));
    expect(await screen.findByText("Averaged over the window asked for: after iteration 1,000, up to 2,000 (1,000 values)")).toBeInTheDocument();
    expect(screen.getByText("20 N")).toBeInTheDocument();
    expect(router.state.location.search).toBe("?from=1000");
    expect(asked).toContain("/results/car?from=1000");
    expect(screen.getByLabelText("From (iteration)")).toHaveValue("1000");

    await user.click(screen.getByRole("button", { name: "The judge's window" }));
    expect(await screen.findByText(/Averaged over the judge's window/)).toBeInTheDocument();
    expect(router.state.location.search).toBe("");
    expect(screen.getByLabelText("From (iteration)")).toHaveValue("");
  });

  it("charts its total group's drag and lift over the run with the window shaded, and another group's when picked", async () => {
    const user = userEvent.setup();
    page("car", engine({ docs: [results("car")] }));
    expect(await screen.findByRole("img", { name: "Drag of forceCoeffs over the run, in N" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Lift of forceCoeffs over the run, in N" })).toBeInTheDocument();
    expect(screen.getByText(/The total group's drag and lift over the whole run, in N\. The shaded part is the averaging window/)).toBeInTheDocument();
    for (const start of screen.getAllByRole("slider", { name: "Start of the averaged part" })) {
      expect(start).toHaveAttribute("aria-valuenow", "1600");
    }
    expect(screen.getAllByRole("slider", { name: "End of the averaged part" })[0]).toHaveAttribute("aria-valuenow", "2000");
    expect(screen.getByText(/after the run's first tenth: larger ones before it run off its edges\. Drawn from 201 of its 2,001 values: each stretch's lowest and highest, so a swing or a spike still shows\.$/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Force group"), "mirrors");
    expect(screen.getByRole("img", { name: "Drag of mirrors over the run, in N" })).toBeInTheDocument();
    expect(screen.getByText(/The mirrors group's drag and lift/)).toBeInTheDocument();
  });

  it("averages over the window its edges are moved to on a chart, and keeps it in the address", async () => {
    const { asked, router } = page("car", engine({ docs: [results("car")] }));
    const [start] = await screen.findAllByRole("slider", { name: "Start of the averaged part" });
    // Shift and an arrow: a tenth of the run, 200 iterations, earlier
    fireEvent.keyDown(start!, { key: "ArrowLeft", shiftKey: true });
    expect(start).toHaveAttribute("aria-valuenow", "1400");
    fireEvent.keyUp(start!, { key: "ArrowLeft" });
    expect(await screen.findByText("Averaged over the window asked for: after iteration 1,400, up to 2,000 (600 values)")).toBeInTheDocument();
    expect(router.state.location.search).toBe("?from=1400");
    expect(asked).toContain("/results/car?from=1400");
    expect(screen.getByLabelText("From (iteration)")).toHaveValue("1400");
    // its end dragged to iteration 1,800: 9 tenths of the way along the plot's 576 px from 50 (640 px wide in tests)
    const [end] = screen.getAllByRole("slider", { name: "End of the averaged part" });
    fireEvent.pointerDown(end!, { pointerId: 1, buttons: 1, clientX: 626 });
    fireEvent.pointerMove(end!, { pointerId: 1, buttons: 1, clientX: 50 + 0.9 * 576 });
    fireEvent.pointerUp(end!, { pointerId: 1 });
    expect(await screen.findByText("Averaged over the window asked for: after iteration 1,400, up to 1,800 (400 values)")).toBeInTheDocument();
    expect(router.state.location.search).toBe("?from=1400&to=1800");
    expect(screen.getByLabelText("To (iteration)")).toHaveValue("1800");
  });

  it("says an engine of API 1.23 can't chart its forces, and still shows its numbers", async () => {
    page("car", engine({ docs: [results("car")], oldForces: true }));
    expect(await screen.findByText("Your engine can't chart its forces yet")).toBeInTheDocument();
    expect(screen.getByText("16.12 N")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("says what is wrong with a window before asking for it", async () => {
    const user = userEvent.setup();
    const { asked } = page("car", engine({ docs: [results("car")] }));
    await screen.findByText("16.12 N");
    await user.type(screen.getByLabelText("From (iteration)"), "2000");
    await user.type(screen.getByLabelText("To (iteration)"), "1000");
    expect(screen.getByText("From must come before To.")).toBeInTheDocument();
    expect(screen.getByLabelText("From (iteration)")).toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "Average" }));
    expect(asked.filter((p) => p.includes("?"))).toEqual([]);
  });

  it("says why a window can't be averaged, and keeps the window to change", async () => {
    page("car", engine({ docs: [results("car")] }), "?from=3000");
    expect(await screen.findByText("Nothing to average")).toBeInTheDocument();
    expect(screen.getByText("car's forces end at 2000, before the window's from (3000): pick an earlier one")).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveValue("3000");
    expect(screen.getByRole("button", { name: "The judge's window" })).toBeEnabled();
    // its forces stay charted, to move the window back to where there are some
    expect(await screen.findByRole("img", { name: "Drag of forceCoeffs over the run, in N" })).toBeInTheDocument();
  });

  it("says a case with too few forces has nothing to average yet", async () => {
    page("run2", engine({ refuse: { run2: new EngineError("not-ready", "run2 has too few forces to average yet: let it solve longer", 409) } }));
    expect(await screen.findByText("Nothing to average")).toBeInTheDocument();
    expect(screen.getByText("run2 has too few forces to average yet: let it solve longer")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Averaging window" })).not.toBeInTheDocument();
  });

  it("says when there is no such case, or the engine is too old to say", async () => {
    page("gone", engine({ docs: [] }));
    expect(await screen.findByText("No such case")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the cases with results" })).toHaveAttribute("href", "/app/results");
  });

  it("says an engine before API 1.23 can't show a case's results", async () => {
    page("car", engine({ old: true }));
    expect(await screen.findByText("Your engine can't show results yet")).toBeInTheDocument();
  });

  it("says a transient run's window in seconds of flow", async () => {
    const doc = results("ddes", { transient: true, start: 0.001, end: 0.3, window: { from: 0.12, to: 0.3, how: "settled", n: 1800 } });
    page("ddes", engine({ docs: [doc] }));
    expect(await screen.findByText(/Transient, 0\.001 s to 0\.3 s of flow/)).toBeInTheDocument();
    expect(screen.getByText("Averaged from when its forces settled: after 0.12 s, up to 0.3 s (1,800 values)")).toBeInTheDocument();
    expect(screen.getByLabelText("From (s)")).toBeInTheDocument();
  });

  it("in the demo, shows its recorded results and says it can't average over another window", async () => {
    const user = userEvent.setup();
    renderScreen(<CaseResultsPage />, { path: "/demo/results/:name", at: "/demo/results/ahmed-25-coarse", transport: demoTransport(undefined, 0) });
    expect(await screen.findByText("16.12 N")).toBeInTheDocument();
    expect(screen.getByText(/recorded demo/)).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/symmetry plane/);
    // its recorded forces, every 4th iteration's
    expect(await screen.findByRole("img", { name: "Drag of forceCoeffs over the run, in N" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Lift of forceCoeffs over the run, in N" })).toBeInTheDocument();
    expect(screen.queryByText(/Drawn from/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("From (iteration)"), "1000");
    await user.click(screen.getByRole("button", { name: "Average" }));
    expect(await screen.findByText("Not in the demo")).toBeInTheDocument();
    expect(screen.getByText(DEMO_RESULTS_NOTE)).toBeInTheDocument();
  });
});
