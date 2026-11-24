// SPDX-License-Identifier: GPL-3.0-or-later
// The Cases screen's Plan a transient run of a case you made (CasePlanDialog in TransientPlan.tsx): offered once the
// engine says the case has a result (GET /cases' `results`, API 1.8), planned by a tplan job as a run's is, and the
// plan shown in the dialog with what a later result means; none for a case without one or one Mesh Doctor made.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import type { CaseList, Job, TransientPlan } from "@/engine/types";
import { renderScreen } from "@/test/render";
import { Cases } from "./Cases";

/** A plan of the case you made "mine" from its result at time 300: a coarse Ahmed body's numbers, to 6 digits. */
const PLAN: TransientPlan = {
  schemaVersion: "1.1", case: "mine", time: "300", processors: 6, decomposed: true, tool: "foamCourantCells",
  cells: 478_901,
  courantPerSecond: { median: 4329.14, p99: 15320.4, p999: 20357.4, p9999: 29466.6, max: 54448.3, withoutTop: 24803.3 },
  top: 100, cellsWithin2x: 62, regions: [],
  speed: 40, length: 1.044, flowTime: 0.2088, flowTimeSource: "8 L/U", secondsPerIteration: 0.4, outerCorrectors: 3,
  options: [
    { maxCo: 1, deltaT: 1.83661e-5, deltaTWithoutTop: 4.03171e-5, stepsPerSecond: 54448.3, hoursPerFlowSecond: 18.1494,
      steps: 11_369, hours: 3.78967, hoursWithoutTop: 1.72633 },
  ],
  seconds: 12, notes: [],
};

/** A case you made with a result, one without, and one Mesh Doctor made (its run's page plans it). */
const CASES: CaseList = {
  items: ["mine", "fresh", "ahmed"], cells: { mine: 478_901, fresh: 2_000_000, ahmed: 478_901 },
  made: { ahmed: { template: "ahmed-body" } }, results: { mine: "300", fresh: null, ahmed: "2000" },
};

/** Your own engine with these cases and the plan of "mine" (none by default: not-found); a job it starts waits. */
function engine(o: { cases?: CaseList; plan?: TransientPlan } = {}) {
  const posted: unknown[] = [];
  const jobs: Job[] = [];
  const transport: Transport = {
    kind: "engine",
    scope: "test",
    request: async <T,>(method: string, path: string, body?: unknown) => {
      const route = path.split("?")[0]!;
      if (method === "POST" && route === "/jobs") {
        posted.push(body);
        const made = { id: "20261124-091500-tplan-mine-0001", kind: "tplan", name: "mine", state: "queued",
          params: { name: "mine" } } as unknown as Job;
        jobs.unshift(made);
        return structuredClone(made) as T;
      }
      if (route === "/cases") return structuredClone(o.cases ?? CASES) as T;
      if (route === "/repairs") return { items: [] } as T;
      if (route === "/jobs") return { items: structuredClone(jobs) } as T;
      if (route === "/") {
        return { apiVersion: "1.8", version: "0.3.0", jobKinds: ["repair", "abtest", "abextend", "case", "solve", "tplan"] } as T;
      }
      if (route === "/tplans/mine" && o.plan) return structuredClone(o.plan) as T;
      if (route === "/tplans/mine") throw new EngineError("not-found", "no transient plan of mine: a tplan job makes one", 404);
      throw new EngineError("not-found", `no such API route ${route}`, 404);
    },
  };
  return { transport, posted };
}

const show = (o: Parameters<typeof engine>[0] = {}) => {
  const e = engine(o);
  return { ...renderScreen(<Cases />, { path: "/app/cases", transport: e.transport }), posted: e.posted };
};
const dialog = () => within(screen.getByRole("dialog"));

describe("Plan a transient run of a case you made", () => {
  it("is offered under a case you made with a result: not one without, one Mesh Doctor made, or by an older engine", async () => {
    const view = show();
    expect(await screen.findByRole("button", { name: "Plan a transient run of mine" })).toHaveTextContent("Plan a transient run");
    expect(screen.queryByRole("button", { name: "Plan a transient run of fresh" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Plan a transient run of ahmed" })).toBeNull();
    view.unmount();

    show({ cases: { items: CASES.items, cells: CASES.cells, made: CASES.made } });       // an engine before API 1.8
    expect(await screen.findByRole("button", { name: "Repair mine" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Plan a transient run of / })).toBeNull();
  });

  it("plans it with a tplan job, as a run's page does, and says where a transient run of it starts", async () => {
    const user = userEvent.setup();
    const { posted } = show();
    await user.click(await screen.findByRole("button", { name: "Plan a transient run of mine" }));
    expect(dialog().getByRole("heading", { name: "Plan a transient run of mine" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "From its result at time 300: the time step a transient run would need at each largest Courant number");
    expect(screen.getByRole("dialog")).toHaveTextContent("A transient run starts from a solved run of a case Mesh Doctor "
      + "made: Solve a case you made…, on the Solve screen with this case picked, solves a copy of it, and that run's "
      + "page starts one.");
    expect(dialog().getByRole("link", { name: "Solve a case you made…" })).toHaveAttribute("href", "/app/solve?copy=mine");

    await user.click(await dialog().findByRole("button", { name: "Plan" }));
    await waitFor(() => expect(posted).toEqual([{ kind: "tplan", params: { name: "mine" } }]));
    expect(await dialog().findByText(/^Waiting to start: OpenFOAM works out each cell's Courant number from this case's result/))
      .toBeInTheDocument();
    expect(dialog().getByRole("button", { name: "Plan" })).toBeDisabled();
    await user.click(dialog().getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows the plan made before, and says when the case has a later result", async () => {
    const user = userEvent.setup();
    show({ cases: { ...CASES, results: { ...CASES.results, mine: "500" } }, plan: PLAN });
    await user.click(await screen.findByRole("button", { name: "Plan a transient run of mine" }));
    expect(await dialog().findByRole("table", { name: "The time step and time of a transient run at each largest Courant number" }))
      .toBeInTheDocument();
    expect(dialog().getByText("Planned from its result at time 300, in 12 s. The case has a later result since, at time "
      + "500: Plan again plans from there.")).toBeInTheDocument();
    expect(dialog().getByRole("button", { name: "Plan again" })).toBeEnabled();
    expect(dialog().queryByRole("button", { name: /Start a transient run/ })).toBeNull();     // planned only
  });
});
