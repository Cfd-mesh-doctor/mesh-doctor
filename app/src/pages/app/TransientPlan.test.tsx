// SPDX-License-Identifier: GPL-3.0-or-later
// A solved run's Plan a transient run (TransientPlan.tsx): starting the plan, following its job, the plan once made, a
// plan from an earlier result, one that failed, a busy engine, and an engine from before it.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import type { Job, RunDetail, TransientPlan } from "@/engine/types";
import { renderScreen } from "@/test/render";
import { OLD_ENGINE_TPLAN, TransientPlanCard } from "./TransientPlan";

const RUN: RunDetail = {
  name: "ahmed", state: "done", step: "done", iteration: 300, start: 0, end: 300, written: 300, nProcs: 6,
  stretches: [{ from: 0, to: 300 }], started: "2026-11-23T21:57:21Z", updated: "2026-11-23T22:00:27Z",
  finished: "2026-11-23T22:00:27Z", error: null,
};

/** GET /tplans/ahmed as the engine answered it of a real coarse Ahmed body solved to 300 on 6 processes, to 6 digits. */
const PLAN: TransientPlan = {
  schemaVersion: "1.0", case: "ahmed", time: "300", processors: 6, cells: 478_901,
  courantPerSecond: { median: 4329.14, p99: 15320.4, p999: 20357.4, p9999: 29466.6, max: 54448.3, withoutTop: 24803.3 },
  top: 100, cellsWithin2x: 62,
  regions: [
    { nCells: 38, centre: [-0.0635271, 0.179941, 0.322101], h: 0.00264837, maxRate: 54448.3 },
    { nCells: 26, centre: [-0.931042, 0.190741, 0.298457], h: 0.0025086, maxRate: 43727.2 },
    { nCells: 33, centre: [-0.0525219, 0.177295, 0.0701108], h: 0.00219626, maxRate: 41831 },
    { nCells: 3, centre: [-1.04556, 0.193505, 0.0518287], h: 0.00274267, maxRate: 27844.4 },
  ],
  speed: 40, length: 1.044, flowTime: 0.2088, flowTimeSource: "8 L/U", secondsPerIteration: 0.4, outerCorrectors: 3,
  options: [
    { maxCo: 1, deltaT: 1.83661e-5, deltaTWithoutTop: 4.03171e-5, stepsPerSecond: 54448.3, hoursPerFlowSecond: 18.1494,
      steps: 11_369, hours: 3.78967, hoursWithoutTop: 1.72633 },
    { maxCo: 5, deltaT: 9.18303e-5, deltaTWithoutTop: 2.01586e-4, stepsPerSecond: 10889.7, hoursPerFlowSecond: 3.62988,
      steps: 2274, hours: 0.758, hoursWithoutTop: 0.345333 },
    { maxCo: 20, deltaT: 3.67321e-4, deltaTWithoutTop: 8.06343e-4, stepsPerSecond: 2722.41,
      hoursPerFlowSecond: 0.907471, steps: 569, hours: 0.189667, hoursWithoutTop: 0.0863333 },
  ],
  seconds: 1.5,
  notes: [
    "Courant numbers come from the steady flow; in the transient run the velocity fluctuates, so the real max Co is "
      + "usually somewhat higher.",
    "Hours assume one PIMPLE outer iteration costs about one steady iteration.",
    "DES/LES need max Co <= 1; URANS with enough outer correctors usually runs higher.",
  ],
};

const ID = "20261123-220028-tplan-ahmed-479f";
const NEW = "20261123-221500-tplan-ahmed-0001";
const job = (state: Job["state"], more: Partial<Job> = {}) =>
  ({ id: ID, kind: "tplan", name: "ahmed", state, params: { name: "ahmed" }, ...more }) as Job;

/** Your own engine (or the demo, by `kind`) with these job kinds (those of API 1.6 by default), jobs and plan (none by
 * default: not-found). A job it starts waits to start; `refuse`: the error it answers instead of starting one. */
function engine(o: {
  kinds?: string[]; jobs?: Job[]; plan?: TransientPlan; refuse?: EngineError; kind?: "engine" | "demo";
} = {}) {
  const posted: unknown[] = [];
  const asked: string[] = [];
  const jobs = [...(o.jobs ?? [])];
  const transport: Transport = {
    kind: o.kind ?? "engine",
    scope: "test",
    request: async <T,>(method: string, path: string, body?: unknown) => {
      const route = path.split("?")[0]!;
      asked.push(route);
      if (method === "POST" && route === "/jobs") {
        if (o.refuse) throw o.refuse;
        posted.push(body);
        const made = job("queued", { id: NEW });
        jobs.unshift(made);
        return structuredClone(made) as T;
      }
      if (route === "/") {
        return { apiVersion: "1.6", version: "0.2.0", jobKinds: o.kinds ?? ["repair", "abtest", "abextend", "case",
          "solve", "tplan"] } as T;
      }
      if (route === "/jobs") return { items: structuredClone(jobs) } as T;
      if (route === "/tplans/ahmed" && o.plan) return structuredClone(o.plan) as T;
      if (route === "/tplans/ahmed") throw new EngineError("not-found", "no transient plan of ahmed: a tplan job makes one", 404);
      throw new EngineError("not-found", `no such API route ${route}`, 404);
    },
  };
  return { transport, posted, asked };
}

const show = (o: Parameters<typeof engine>[0] = {}, run: RunDetail = RUN) => {
  const e = engine(o);
  const view = renderScreen(<TransientPlanCard run={run} />, { path: "/app/solve/ahmed", transport: e.transport });
  return { ...e, unmount: view.unmount };
};
const button = (name: string) => screen.getByRole("button", { name });
const enabled = (name: string) => waitFor(() => expect(button(name)).toBeEnabled());

describe("Plan a transient run", () => {
  it("before a plan: says what it does, and plans the run as a tplan job, which it then follows", async () => {
    const user = userEvent.setup();
    const { posted } = show();
    expect(screen.getByRole("heading", { name: "Plan a transient run" })).toBeInTheDocument();
    expect(screen.getByText(/^A steady run that won.t settle \(the judge.s “plateau \/ oscillation”\)/)).toBeInTheDocument();
    expect(screen.getByText("It reads the result and doesn't solve: about 2 s for half a million cells.")).toBeInTheDocument();
    await enabled("Plan a transient run");
    await user.click(button("Plan a transient run"));
    expect(posted).toEqual([{ kind: "tplan", params: { name: "ahmed" } }]);
    expect(await screen.findByText(/^Waiting to start: OpenFOAM works out each cell's Courant number from this run's/))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Its job" })).toHaveAttribute("href", `/app/jobs?job=${NEW}`);
    expect(button("Plan a transient run")).toBeDisabled();
  });

  it("while it plans: its job, a bar with no end, and no second plan", async () => {
    show({ jobs: [job("running")] });
    expect(await screen.findByText(/^Planning: OpenFOAM works out each cell's Courant number/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Its job" })).toHaveAttribute("href", `/app/jobs?job=${ID}`);
    expect(screen.getByRole("progressbar", { name: "Planning a transient run of ahmed" })).not.toHaveAttribute("aria-valuenow");
    expect(button("Plan a transient run")).toBeDisabled();
  });

  it("a plan: the time step at each Courant number, what a run would take, and which cells set the pace, where", async () => {
    show({ jobs: [job("done")], plan: PLAN });
    expect(await screen.findByText("At a largest Courant number of 1, which DES and LES need, the time step is 18 µs: "
      + "11,369 steps for 0.21 s of flow (8 body lengths), about 3.8 h on 6 processes.")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "The time step and time of a transient run at each largest Courant number" });
    expect(within(table).getAllByRole("row").map((r) => [...r.querySelectorAll("th, td")].map((c) => c.textContent)))
      .toEqual([
        ["Largest Courant number", "Time step", "Steps", "Time on 6 processes", "Without the 100 fastest cells"],
        ["1", "18 µs", "11,369", "3.8 h", "40 µs, 1.7 h"],
        ["5", "92 µs", "2,274", "45 min", "200 µs, 21 min"],
        ["20", "370 µs", "569", "11 min", "810 µs, 5 min"],
      ]);
    expect(screen.getByText("62 cells of 478,901 are within 2× of the largest Courant number: they set the time step. "
      + "Without the 100 fastest, it could be 2.2× larger: so few cells set the pace of the whole run.")).toBeInTheDocument();
    expect(screen.getByText("38 cells near (−0.0635, 0.18, 0.322) m, about 2.6 mm across")).toBeInTheDocument();
    expect(screen.getByText("26 cells near (−0.931, 0.191, 0.298) m, about 2.5 mm across")).toBeInTheDocument();
    expect(screen.getByText("33 cells near (−0.0525, 0.177, 0.0701) m, about 2.2 mm across")).toBeInTheDocument();
    expect(screen.queryByText(/^3 cells near/)).toBeNull();                        // the three fastest places
    expect(within(screen.getByRole("list", { name: "What the plan assumes" })).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Planned from iteration 300 of this run, in 2 s.")).toBeInTheDocument();
    expect(screen.getByText("Plans again from the run's latest result.")).toBeInTheDocument();
    await enabled("Plan again");
  });

  it("a plan from an earlier result: says the run has been solved further since, and plans again from there", async () => {
    const user = userEvent.setup();
    const further = { ...RUN, iteration: 600, end: 600, written: 600, stretches: [{ from: 0, to: 300 }, { from: 300, to: 600 }] };
    const { posted } = show({ jobs: [job("done")], plan: PLAN }, further);
    expect(await screen.findByText("Planned from iteration 300 of this run, in 2 s. The run has been solved to iteration "
      + "600 since: Plan again plans from there.")).toBeInTheDocument();
    await enabled("Plan again");
    await user.click(button("Plan again"));
    expect(posted).toEqual([{ kind: "tplan", params: { name: "ahmed" } }]);
    expect(await screen.findByText(/^Waiting to start/)).toBeInTheDocument();
  });

  it("a plan that failed says why and where its log is; one cancelled says so; either plans again", async () => {
    const failed = show({ jobs: [job("failed", { error: "exit code 1: foamPostProcess failed", exitCode: 1 })] });
    expect(await screen.findByText(/^The plan stopped with an error: exit code 1: foamPostProcess failed\. See/))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "its job" })).toHaveAttribute("href", `/app/jobs?job=${ID}`);
    await enabled("Plan a transient run");
    failed.unmount();
    show({ jobs: [job("cancelled")] });
    expect(await screen.findByText("Its job was cancelled before the plan was made.")).toBeInTheDocument();
    await enabled("Plan a transient run");
  });

  it("with the engine busy solving, says which job is in the way", async () => {
    const user = userEvent.setup();
    const { posted } = show({ refuse: new EngineError("busy",
      "job 20261123-215721-solve-ahmed-b094 (solve ahmed) is running; one big job at a time (RAM)", 409) });
    await enabled("Plan a transient run");
    await user.click(button("Plan a transient run"));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Another OpenFOAM job is running")).toBeInTheDocument();
    expect(within(alert).getByText("The solve of ahmed is running. Wait for it to finish, or cancel it on the Jobs page."))
      .toBeInTheDocument();
    expect(posted).toEqual([]);
  });

  it("with an engine from before it, says to update and asks for no plan; the demo plans nothing", async () => {
    const old = show({ kinds: ["repair", "case", "solve"] });
    expect(await screen.findByText(/^Your engine is older than this page and can't plan a transient run from here yet/))
      .toBeInTheDocument();
    expect(OLD_ENGINE_TPLAN).toContain("`git pull`");
    expect(button("Plan a transient run")).toBeDisabled();
    expect(old.asked).not.toContain("/tplans/ahmed");
    old.unmount();
    const demo = show({ kind: "demo" });
    await waitFor(() => expect(demo.asked).toContain("/tplans/ahmed"));
    expect(button("Plan a transient run")).toBeDisabled();
  });
});
