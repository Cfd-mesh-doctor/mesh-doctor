// SPDX-License-Identifier: GPL-3.0-or-later
// The solves of the cases Mesh Doctor made (API 1.6): the Solve screen's Runs card and its Solve dialog, and a run's
// page with its charts, judge, Stop and Continue; a transient run's, in seconds.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import type { Job, MachineInfo, Made, Run } from "@/engine/types";
import { renderScreen } from "@/test/render";
import { RunPage } from "./Run";
import { Solve } from "./Solve";
import { OLD_ENGINE_RUNS } from "./solveStart";

const MACHINE: MachineInfo = { cpus: 8, cores: 4, memoryMb: 16_000, ramLimitMb: null };
const HOUR_AGO = new Date(Date.now() - 3_600_000).toISOString();

const run = (name: string, more: Partial<Run> = {}): Run => ({
  name, state: "running", step: "solving", iteration: 120, start: 0, end: 200, written: 100, nProcs: 4, stretches: [],
  started: HOUR_AGO, updated: new Date().toISOString(), finished: null, error: null, ...more,
});
const stopped = (name: string) => run(name, {
  state: "stopped", step: "done", iteration: 150, end: 150, written: 150, stretches: [{ from: 0, to: 150 }], finished: HOUR_AGO,
});
const job = (name: string, state: Job["state"], kind: Job["kind"] = "solve", more: Partial<Job> = {}) =>
  ({ id: `20261123-120000-${kind}-${name}-ab12`, kind, name, state, params: { name }, ...more }) as Job;

/** A run's page data as the engine's live monitor gives it: p and Ux falling, a body's forces settling, a live judge. */
function liveOf(r: Run) {
  const ts = Array.from({ length: Number(r.iteration ?? 0) }, (_, i) => i + 1);
  return {
    name: r.name, run: r, stages: [{ name: "First solve", from: r.start, to: r.end ?? 0 }],
    current: { name: "First solve", from: r.start, to: r.end ?? 0 },
    solver: r.state === "running"
      ? { state: "running", iteration: r.iteration, end: r.end, wall_per_it: 0.5, eta: ((r.end ?? 0) - (r.iteration ?? 0)) * 0.5 }
      : { state: "done", iteration: r.iteration, end: r.end },
    residuals: { cols: ["Time", "p", "Ux"], rows: ts.map((t) => [t, 0.3 / t, 0.1 / t]) },
    forces: { body: ts.map((t) => [t, 40 + 10 / t, 150 - 50 / t]) },
    forceInfo: { total: "body", groups: ["body"], vertical: "downforce", flow: "+x", up: "z", source: {} },
    judge: { window: 50, level: "warn", verdict: "not converged yet", average: { drag: { mean: 42.1, u: 0.4 } } },
    now: Date.now() / 1000,
  };
}

/** A transient run of steady run "s" (API 1.6), solving from 0 to 0.001 s on 4 processes, at 0.0005 s with 0.00025 s
 * written; and its page data: 30 time steps of 16.7 µs, 1.4 s each, its residuals and forces over time, and the
 * transient judge in time steps, as the live page answers it for one. */
const T = (more: Partial<Run> = {}): Run => run("t", {
  iteration: 0.0005, start: 0, end: 0.001, written: 0.00025,
  transient: { steady: "s", at: "300", maxCo: 1, model: "DDES" }, ...more,
});
function transientLive(r: Run) {
  const ts = Array.from({ length: 30 }, (_, i) => (i + 1) * 1.67e-5);
  return {
    ...liveOf(r),
    solver: r.state === "running"
      ? { state: "running", iteration: r.iteration, end: r.end, deltaT: 1.67e-5, wall_per_it: 1.4, eta: 42 }
      : { state: "stopped", iteration: r.iteration, end: r.end, deltaT: 1.67e-5 },
    residuals: { cols: ["Time", "p", "Ux"], rows: ts.map((t) => [t, 0.01, 0.002]) },
    forces: { body: ts.map((t) => [t, 40 + Math.sin(t * 1e5), 150]) },
    steps: { cols: ["Time", "deltaT", "coMean", "coMax"], rows: ts.map((t, i) => [t, 1.67e-5, 0.05, 0.9 + 0.01 * (i % 3)]) },
    judge: {
      transient: true, window: 15, group: "body", verdict: "statistically stationary, but check: k bounded in 90% of steps",
      flags: ["k bounded in 90% of steps"], average: { drag: { mean: 40.2, u: 0.3 } }, axes: { flow: "+x", up: "z" },
      settled: r.state === "running" ? null : 0.0001,
    },
  };
}

/** Your own engine (or the demo, by `kind`) with these made cases, runs and jobs. */
function engine(o: {
  made?: Record<string, Made>; runs?: Run[]; jobs?: Job[]; live?: (r: Run) => unknown; noRuns?: boolean;
  kind?: "engine" | "demo";
} = {}) {
  const posted: { path: string; body?: unknown }[] = [];
  const judged: string[] = [];
  const runs = new Map((o.runs ?? []).map((r) => [r.name, structuredClone(r)]));
  const transport: Transport = {
    kind: o.kind ?? "engine",
    scope: "test",
    request: async <T,>(method: string, path: string, body?: unknown) => {
      const route = path.split("?")[0]!;
      if (method === "POST") {
        posted.push({ path, body });
        if (route === "/jobs") {
          const p = (body as { params: { name: string } }).params;
          return job(p.name, "queued", "solve", { params: p }) as T;
        }
        const stop = /^\/runs\/([^/]+)\/stop$/.exec(route);
        if (stop) return structuredClone(runs.get(decodeURIComponent(stop[1]!))) as T;
      }
      const made = o.made ?? {};
      if (route === "/cases") {
        const items = ["mine", ...Object.keys(made)];
        return { items, cells: Object.fromEntries(items.map((n) => [n, 480_000])), made } as T;
      }
      if (route === "/runs" && !o.noRuns) return { items: [...runs.values()] } as T;
      if (route === "/jobs") return { items: o.jobs ?? [] } as T;
      if (route === "/machine") return MACHINE as T;
      if (route === "/judge") {
        judged.push(path);
        return { verdict: "converged", window: 200, group: "body", average: { drag: { mean: 41.8, u: 0.2 } } } as T;
      }
      const m = /^\/runs\/([^/]+)(\/live)?$/.exec(route);
      const r = m && runs.get(decodeURIComponent(m[1]!));
      if (m && r && m[2]) {
        const doc = (o.live ?? liveOf)(r);
        if (doc instanceof EngineError) throw doc;
        return doc as T;
      }
      if (m && r) return structuredClone(r) as T;
      throw new EngineError("not-found", `no such API route ${route}`, 404);
    },
  };
  return { transport, posted, judged };
}

const solvePage = (o: Parameters<typeof engine>[0]) => {
  const e = engine(o);
  return { ...renderScreen(<Solve />, { path: "/app/solve", transport: e.transport }), posted: e.posted };
};
const runPage = (name: string, o: Parameters<typeof engine>[0]) => {
  const e = engine(o);
  return {
    ...renderScreen(<RunPage />, { path: "/app/solve/:name", at: `/app/solve/${name}`, transport: e.transport }),
    posted: e.posted, judged: e.judged,
  };
};
const dialog = () => within(screen.getByRole("dialog"));

describe("the Solve screen's runs", () => {
  it("lists each case Mesh Doctor made with its solve: those solving first, a link to each run's page", async () => {
    solvePage({
      made: { a: { template: "ahmed-body" }, b: { template: "wheel-wing" }, c: { template: "ahmed-body" } },
      runs: [run("a"), stopped("b")],
      jobs: [job("a", "running")],
    });
    const list = within(await screen.findByRole("list", { name: "Runs" }));
    const items = list.getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "aSolvingSolving (foamRun) · iteration 120 of 200",
      expect.stringMatching(/^bStoppedStopped at iteration 150, (about )?1 hour ago$/),
      "cNot solvedMade from the ahmed-body template, about 480,000 cells Solve…",
    ]);
    expect(list.getByRole("link", { name: "a" })).toHaveAttribute("href", "/app/solve/a");
    expect(list.getByRole("link", { name: "b" })).toHaveAttribute("href", "/app/solve/b");
    expect(list.queryByRole("link", { name: "c" })).toBeNull();
    expect(list.getByRole("progressbar", { name: "Progress of the solve of a" })).toHaveAttribute("aria-valuenow", "60");
    expect(list.getAllByRole("button")).toHaveLength(1);
    expect(list.getByRole("button", { name: "Solve c" })).toBeInTheDocument();
  });

  it("solves a case with Solve…, on the processes picked, and opens its page", async () => {
    const user = userEvent.setup();
    const { posted, router } = solvePage({ made: { c: { template: "ahmed-body" } } });
    await user.click(await screen.findByRole("button", { name: "Solve c" }));
    expect(dialog().getByRole("heading", { name: "Solve c" })).toBeInTheDocument();
    expect(dialog().getByRole("textbox", { name: "Solve to iteration" })).toHaveValue("2000");
    const procs = dialog().getByRole("combobox", { name: "Processes" });
    expect(procs).toHaveValue("4");
    expect(within(procs).getAllByRole("option").map((o) => o.textContent)).toEqual(["1", "2", "3", "4"]);
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent(
      /The solve needs about \d+(\.\d)? GB of memory; your engine's computer has 15\.6 GB\./));
    await user.selectOptions(procs, "2");
    expect(procs).toHaveAccessibleDescription(
      "The case is split into 2 parts (decomposePar), each solved by a process of its own (mpirun). A continuation keeps the same. Your engine's computer has 4 cores.");
    await user.click(dialog().getByRole("button", { name: "Solve" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/solve/c"));
    expect(posted).toEqual([{ path: "/jobs", body: { kind: "solve", params: { name: "c", to: 2000, np: 2 } } }]);
  });

  it("won't start a solve while another job runs, and says why", async () => {
    const user = userEvent.setup();
    solvePage({ made: { c: { template: "ahmed-body" } }, jobs: [job("wing-fix", "running", "repair")] });
    await user.click(await screen.findByRole("button", { name: "Solve c" }));
    expect(await dialog().findByText(/Repair wing-fix is running\. The engine runs one big job at a time/)).toBeInTheDocument();
    expect(dialog().getByRole("button", { name: "Solve" })).toBeDisabled();
  });

  it("gives the command in the demo, which can't start jobs", async () => {
    const user = userEvent.setup();
    solvePage({ made: { c: { template: "ahmed-body" } }, kind: "demo" });
    await user.click(await screen.findByRole("button", { name: "Solve c" }));
    expect(await dialog().findByRole("button", { name: "Copy “meshdoctor solve c --to 2000 --np 4”" })).toBeInTheDocument();
    expect(dialog().queryByRole("button", { name: "Solve" })).toBeNull();
    expect(dialog().getByText(/^The demo can't start jobs\. With your own engine paired, Solve runs this/)).toBeInTheDocument();
  });

  it("says when no case was made yet, and tells an engine before the solve job to update", async () => {
    const view = solvePage({});
    expect(await screen.findByText(/^Nothing to solve here yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Solve a case you made…" })).toBeEnabled();
    view.unmount();
    solvePage({ made: { c: { template: "ahmed-body" } }, noRuns: true });
    const runs = within(screen.getByRole("heading", { name: "Runs" }).closest("section")!);
    expect(await runs.findByText(/^Your engine is older than this page and can't solve cases from here yet/)).toBeInTheDocument();
    expect(OLD_ENGINE_RUNS).toContain("`git pull`");
    expect(screen.queryByRole("list", { name: "Runs" })).toBeNull();
    expect(screen.getByRole("button", { name: "Solve a case you made…" })).toBeDisabled();
  });
});

describe("solving a copy of a case you made", () => {
  it("picks one of yours, suggests a free name for the copy, and starts the job that makes it and solves it", async () => {
    const user = userEvent.setup();
    const { posted, router } = solvePage({ made: { "mine-run": { copyOf: "mine" } } });
    expect(await screen.findByText("A copy of mine, about 480,000 cells")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Solve a case you made…" }));
    expect(dialog().getByRole("heading", { name: "Solve a copy of a case you made" })).toBeInTheDocument();
    const which = dialog().getByRole("combobox", { name: "Case" });
    expect(within(which).getAllByRole("option").map((o) => o.textContent)).toEqual(["mine (about 480,000 cells)"]);
    const name = dialog().getByRole("textbox", { name: "Name of the copy" });
    expect(name).toHaveValue("mine-run-2");                                 // mine-run is taken: the copy before
    await user.clear(name);
    await user.type(name, "mine-run");
    expect(name).toHaveAccessibleDescription("A case with this name is in the cases folder already. Pick another name.");
    expect(dialog().getByRole("button", { name: "Solve a copy" })).toBeDisabled();
    await user.clear(name);
    await user.type(name, ".x");
    expect(name).toHaveAccessibleDescription(/^Use only letters, digits/);
    await user.clear(name);
    await user.type(name, "mine-fine");
    expect(dialog().getByRole("textbox", { name: "Solve to iteration" })).toHaveValue("2000");
    expect(dialog().getByRole("combobox", { name: "Processes" })).toHaveValue("4");
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent(/The solve needs about \d+(\.\d)? GB of memory/));
    await user.click(dialog().getByRole("button", { name: "Solve a copy" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/solve/mine-fine"));
    expect(posted).toEqual([{ path: "/jobs", body: { kind: "solve", params: { name: "mine-fine", source: "mine", to: 2000, np: 4 } } }]);
  });

  it("says when there is no case of yours to copy, and gives the command in the demo", async () => {
    const user = userEvent.setup();
    const view = solvePage({ made: { mine: { template: "ahmed-body" } } });     // every case there made here
    await user.click(await screen.findByRole("button", { name: "Solve a case you made…" }));
    expect(await dialog().findByText(/cases folder has no case of yours with a mesh/)).toBeInTheDocument();
    expect(dialog().getByRole("button", { name: "Solve a copy" })).toBeDisabled();
    view.unmount();
    solvePage({ kind: "demo" });
    await user.click(await screen.findByRole("button", { name: "Solve a case you made…" }));
    expect(await dialog().findByRole("button", { name: "Copy “meshdoctor solve mine mine-run --to 2000 --np 4”" }))
      .toBeInTheDocument();
    expect(dialog().getByText(/^The demo can't start jobs\. With your own engine paired, Solve a copy runs this/)).toBeInTheDocument();
  });

  it("lists a copy that waits to be made, and its page says what it copies", async () => {
    const copy = job("mine-run", "queued", "solve", { params: { name: "mine-run", source: "mine", to: 2000, np: 4 } });
    const view = solvePage({ jobs: [copy] });
    const list = within(await screen.findByRole("list", { name: "Runs" }));
    expect(list.getByRole("listitem")).toHaveTextContent("mine-runQueuedWaiting to start");
    expect(list.getByRole("link", { name: "mine-run" })).toHaveAttribute("href", "/app/solve/mine-run");
    view.unmount();
    runPage("mine-run", { jobs: [copy] });
    expect(await screen.findByText("Solve · a copy of mine")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Starting" })).toBeInTheDocument();
  });

  it("names the copying step, with no Stop while it copies", async () => {
    runPage("mine-run", {
      made: { "mine-run": { copyOf: "mine" } }, jobs: [job("mine-run", "running")],
      runs: [run("mine-run", { step: "copying", iteration: 0, written: 0 })],
    });
    expect(await screen.findByRole("heading", { name: "Copying your case" })).toBeInTheDocument();
    expect(screen.getByText(/^Solve · a copy of mine · to iteration 200/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("says a copy cancelled before its solve began", async () => {
    runPage("mine-run", { jobs: [job("mine-run", "cancelled", "solve", { params: { name: "mine-run", source: "mine" } })] });
    expect(await screen.findByRole("heading", { name: "The solve didn't start" })).toBeInTheDocument();
    expect(screen.getByText(/^It was cancelled before the solve began\. See/)).toBeInTheDocument();
  });
});

describe("a run's page", () => {
  it("follows a solve: its progress and pace, residuals and forces, the live judge, and Stop", async () => {
    const user = userEvent.setup();
    const { posted } = runPage("a", { made: { a: { template: "ahmed-body" } }, runs: [run("a")], jobs: [job("a", "running")] });
    expect(await screen.findByRole("heading", { name: "a", level: 1 })).toBeInTheDocument();
    expect(await screen.findByText("Solve · made from the ahmed-body template · to iteration 200")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Solving (foamRun)" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Progress of the solve of a" })).toHaveAttribute("aria-valuenow", "60");
    expect(await screen.findByText("60 % · iteration 120 of 200 · 0.50 s per iteration · about 40 s left")).toBeInTheDocument();
    expect(screen.getByText("Written to iteration 100, on 4 processes.")).toBeInTheDocument();

    expect(screen.getByRole("img", { name: "Initial residual of p per iteration, log scale" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Ux" }));
    expect(screen.getByRole("img", { name: "Initial residual of Ux per iteration, log scale" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Downforce from body per iteration" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Drag" }));
    expect(screen.getByRole("img", { name: "Drag from body per iteration" })).toBeInTheDocument();
    expect(screen.getByText("The live judge, so far")).toBeInTheDocument();
    expect(screen.getByText("not converged yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Job details" })).toHaveAttribute("href", `/app/jobs?job=${job("a", "running").id}`);
    expect(screen.queryByText(/solving in a terminal/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Continue/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByText("Stopping: the solver writes the iteration it has reached, then ends.")).toBeInTheDocument();
    expect(posted).toEqual([{ path: "/runs/a/stop", body: undefined }]);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("follows a solve run in a terminal, which has no job: it says so, and Stop works on it as on a job's", async () => {
    const user = userEvent.setup();
    const { posted } = runPage("t", { made: { t: { template: "ahmed-body" } }, runs: [run("t")] });
    expect(await screen.findByRole("heading", { name: "Solving (foamRun)" })).toBeInTheDocument();
    expect(await screen.findByText(/^It is solving in a terminal/)).toHaveTextContent("It is solving in a terminal "
      + "(meshdoctor solve), not as a job: Stop ends it at the iteration it has reached, which it writes first; "
      + "Ctrl+C in its terminal ends it at the one it wrote last.");
    expect(screen.queryByRole("link", { name: "Job details" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByText("Stopping: the solver writes the iteration it has reached, then ends.")).toBeInTheDocument();
    expect(posted).toEqual([{ path: "/runs/t/stop", body: undefined }]);
  });

  it("judges a run that has ended, and continues it from the latest iteration written", async () => {
    const user = userEvent.setup();
    const { posted, router } = runPage("b", { made: { b: { template: "ahmed-body" } }, runs: [stopped("b")] });
    expect(await screen.findByRole("heading", { name: "Stopped at iteration 150" })).toBeInTheDocument();
    expect(screen.getByText("Solved 0 → 150, on 4 processes.")).toBeInTheDocument();
    expect(screen.getByText(/^Stopped by request at iteration 150, which it wrote/)).toBeInTheDocument();
    expect(await screen.findByText("The judge on the whole run")).toBeInTheDocument();
    expect(screen.getByText("converged")).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "Initial residual of p per iteration, log scale" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Continue…" }));
    expect(dialog().getByRole("heading", { name: "Continue b" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "The solve continues from iteration 150, the latest written, on the run's 4 processes, to the iteration you give.");
    expect(dialog().queryByRole("combobox", { name: "Processes" })).toBeNull();
    const to = dialog().getByRole("textbox", { name: "Solve to iteration" });
    expect(to).toHaveValue("1150");
    await user.clear(to);
    await user.type(to, "150");
    expect(to).toHaveAccessibleDescription("Give one past 150, the latest iteration written: the solve continues from there.");
    expect(dialog().getByRole("button", { name: "Continue" })).toBeDisabled();
    await user.clear(to);
    await user.type(to, "400");
    await user.click(dialog().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ path: "/jobs", body: { kind: "solve", params: { name: "b", to: 400 } } });
    expect(router.state.location.pathname).toBe("/app/solve/b");
  });

  it("says why a run failed, with its job's log, and what an interrupted one kept", async () => {
    const failed = run("f", { state: "failed", step: "solving", error: "foamRun failed (exit code 1)", finished: HOUR_AGO });
    const view = runPage("f", { runs: [failed], jobs: [job("f", "failed")] });
    expect(await screen.findByRole("heading", { name: "Stopped with an error" })).toBeInTheDocument();
    expect(screen.getByText(/^foamRun failed \(exit code 1\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "its job" })).toHaveAttribute("href", `/app/jobs?job=${job("f", "failed").id}`);
    view.unmount();

    runPage("i", { runs: [run("i", { state: "interrupted" })] });
    expect(await screen.findByRole("heading", { name: "Interrupted" })).toBeInTheDocument();
    expect(screen.getByText(/or the terminal it was solving in was closed\. What it wrote is kept, to iteration 100/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue…" })).toBeInTheDocument();
  });

  it("shows a solve just started as starting, and says when the engine has no such run", async () => {
    const view = runPage("n", { jobs: [job("n", "queued")] });
    expect(await screen.findByRole("heading", { name: "Starting" })).toBeInTheDocument();
    expect(screen.getByText("Its job is waiting to start")).toBeInTheDocument();
    view.unmount();

    runPage("gone", {});
    expect(await screen.findByText(/^The engine has no solve of this case\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the runs it has" })).toHaveAttribute("href", "/app/solve");
  });

  it("shows a continuation whose job has started, but not yet written the run, as starting", async () => {
    runPage("b", { runs: [stopped("b")], jobs: [job("b", "running")] });
    expect(await screen.findByRole("heading", { name: "Starting" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Progress of the solve of b" })).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText("Under way")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue…" })).toBeNull();
  });

  it("leaves out the pace until the engine can tell it", async () => {
    runPage("a", {
      runs: [run("a")], jobs: [job("a", "running")],
      live: (r) => ({ ...liveOf(r), solver: { state: "running", iteration: 120, end: 200 } }),
    });
    expect(await screen.findByText("60 % · iteration 120 of 200")).toBeInTheDocument();
  });

  it("follows a transient run in seconds: its time and time step, what it started from, its charts over time", async () => {
    const user = userEvent.setup();
    runPage("t", { made: { t: { transientOf: "s" } }, runs: [T()], jobs: [job("t", "running")], live: transientLive });
    expect(await screen.findByText("Solve · a transient run of s · to 0.001 s")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Solving (foamRun)" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Progress of the solve of t" })).toHaveAttribute("aria-valuenow", "50");
    expect(await screen.findByText("50 % · 0.0005 s of 0.001 s · time step 17 µs · 1.40 s per time step · about 42 s left"))
      .toBeInTheDocument();
    expect(screen.getByText("Written to 0.00025 s, on 4 processes.")).toBeInTheDocument();
    expect(screen.getByText(/^A transient run of/)).toHaveTextContent(
      "A transient run of s: DDES at a largest Courant number of 1, from s's iteration 300.");
    expect(screen.getByRole("link", { name: "s" })).toHaveAttribute("href", "/app/solve/s");
    expect(screen.getByRole("img", { name: "Initial residual of p per time step, log scale" })).toBeInTheDocument();
    expect(screen.getByText(/^Initial residual at each time step, log scale/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Downforce from body over time" })).toBeInTheDocument();
    expect(screen.getByText(/a transient run's forces swing with the flow/)).toBeInTheDocument();
    // The live page's judge is the transient judge, in time steps
    expect(screen.getByText("The live judge, so far")).toBeInTheDocument();
    expect(screen.getByText("Judged over the last 15 time steps, flow along +x, z up")).toBeInTheDocument();
    expect(screen.getByText("statistically stationary, but check: k bounded in 90% of steps")).toBeInTheDocument();
    // Its forces haven't settled yet: nothing shaded, and the judge says so
    expect(screen.getByText("Its forces haven't settled yet: the means are over the last two windows.")).toBeInTheDocument();
    expect(screen.queryByText("averaged")).toBeNull();
    // Its time step and Courant number at each time step
    expect(screen.getByRole("heading", { name: "Time step", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Time step over time, in µs" })).toBeInTheDocument();
    expect(screen.getByText(/^In µs\. OpenFOAM sets each time step so that the largest Courant number stays at 1, the run's setting:/))
      .toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Courant number" }));
    expect(screen.getByRole("img", { name: "Largest and mean Courant number over time" })).toBeInTheDocument();
    expect(screen.getByText(/^The largest Courant number, which the time step holds at about 1, the run's setting, and the mean/))
      .toBeInTheDocument();
  });

  it("judges a transient run that has ended in time steps, plans none of it, and continues it by time", async () => {
    const user = userEvent.setup();
    const ended = T({ state: "stopped", step: "done", iteration: 0.00025, written: 0.00025, end: 0.001,
      stretches: [{ from: 0, to: 0.00025 }], finished: HOUR_AGO });
    const { posted, judged } = runPage("t", { made: { t: { transientOf: "s" } }, runs: [ended], live: transientLive });
    expect(await screen.findByRole("heading", { name: "Stopped at 0.00025 s" })).toBeInTheDocument();
    expect(screen.getByText("Solved 0 → 0.00025 s, on 4 processes.")).toBeInTheDocument();
    expect(screen.getByText("Stopped by request at 0.00025 s, which it wrote: Continue solves on from there.")).toBeInTheDocument();
    expect(await screen.findByText("The judge on the whole run")).toBeInTheDocument();
    expect(screen.getByText("statistically stationary, but check: k bounded in 90% of steps")).toBeInTheDocument();
    // its means from when its forces settled, shaded on the forces chart
    expect(screen.getByText("The means are from 0.0001 s on, when its forces settled.")).toBeInTheDocument();
    expect(screen.getByText(/The shaded part, from when they settled, is what it averages\.$/)).toBeInTheDocument();
    expect(screen.getByText("averaged")).toBeInTheDocument();
    expect(judged).toEqual([]);                                  // not GET /judge's 200 iterations
    expect(screen.queryByRole("heading", { name: "Plan a transient run" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Continue…" }));
    expect(dialog().getByRole("heading", { name: "Continue t" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("The transient run continues from 0.00025 s, the latest time "
      + "written, on the run's 4 processes, to the time you give, writing four times on the way.");
    const to = dialog().getByRole("textbox", { name: "Solve to (s)" });
    expect(to).toHaveValue("0.001");                             // the end it stopped short of
    await user.clear(to);
    await user.type(to, "0.0002");
    expect(to).toHaveAccessibleDescription("Give one past 0.00025 s, the latest time written: the run continues from there.");
    expect(dialog().getByRole("button", { name: "Continue" })).toBeDisabled();
    await user.clear(to);
    await user.type(to, "0.002");
    await user.click(dialog().getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ path: "/jobs", body: { kind: "solve", params: { name: "t", to: 0.002 } } });
  });

  it("says when the engine's server has no live monitor, and still says how the run stands", async () => {
    runPage("a", {
      runs: [run("a")], jobs: [job("a", "running")],
      live: () => new EngineError("unavailable", "the live monitor is not running in this server", 503),
    });
    expect(await screen.findByText(/^This engine's server has no live monitor/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Solving (foamRun)" })).toBeInTheDocument();
    expect(screen.getByText("iteration 120 of 200", { exact: false })).toBeInTheDocument();
  });
});
