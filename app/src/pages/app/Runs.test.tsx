// SPDX-License-Identifier: GPL-3.0-or-later
// The solves of the cases Mesh Doctor made (API 1.6): the Solve screen's Runs card and its Solve dialog, and a run's
// page with its charts, judge, Stop and Continue.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import type { Job, MachineInfo, Run } from "@/engine/types";
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

/** Your own engine (or the demo, by `kind`) with these made cases, runs and jobs. */
function engine(o: {
  made?: Record<string, string>; runs?: Run[]; jobs?: Job[]; live?: (r: Run) => unknown; noRuns?: boolean;
  kind?: "engine" | "demo";
} = {}) {
  const posted: { path: string; body?: unknown }[] = [];
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
        return { items: ["mine", ...Object.keys(made)], cells: Object.fromEntries(Object.keys(made).map((n) => [n, 480_000])), made } as T;
      }
      if (route === "/runs" && !o.noRuns) return { items: [...runs.values()] } as T;
      if (route === "/jobs") return { items: o.jobs ?? [] } as T;
      if (route === "/machine") return MACHINE as T;
      if (route === "/judge") return { verdict: "converged", window: 200, group: "body", average: { drag: { mean: 41.8, u: 0.2 } } } as T;
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
  return { transport, posted };
}

const solvePage = (o: Parameters<typeof engine>[0]) => {
  const e = engine(o);
  return { ...renderScreen(<Solve />, { path: "/app/solve", transport: e.transport }), posted: e.posted };
};
const runPage = (name: string, o: Parameters<typeof engine>[0]) => {
  const e = engine(o);
  return { ...renderScreen(<RunPage />, { path: "/app/solve/:name", at: `/app/solve/${name}`, transport: e.transport }), posted: e.posted };
};
const dialog = () => within(screen.getByRole("dialog"));

describe("the Solve screen's runs", () => {
  it("lists each case Mesh Doctor made with its solve: those solving first, a link to each run's page", async () => {
    solvePage({
      made: { a: "ahmed-body", b: "wheel-wing", c: "ahmed-body" },
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
    const { posted, router } = solvePage({ made: { c: "ahmed-body" } });
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
    solvePage({ made: { c: "ahmed-body" }, jobs: [job("wing-fix", "running", "repair")] });
    await user.click(await screen.findByRole("button", { name: "Solve c" }));
    expect(await dialog().findByText(/Repair wing-fix is running\. The engine runs one big job at a time/)).toBeInTheDocument();
    expect(dialog().getByRole("button", { name: "Solve" })).toBeDisabled();
  });

  it("gives the command in the demo, which can't start jobs", async () => {
    const user = userEvent.setup();
    solvePage({ made: { c: "ahmed-body" }, kind: "demo" });
    await user.click(await screen.findByRole("button", { name: "Solve c" }));
    expect(await dialog().findByRole("button", { name: "Copy “meshdoctor solve c --to 2000 --np 4”" })).toBeInTheDocument();
    expect(dialog().queryByRole("button", { name: "Solve" })).toBeNull();
    expect(dialog().getByText(/^The demo can't start jobs\. With your own engine paired, Solve runs this/)).toBeInTheDocument();
  });

  it("says when no case was made yet, and tells an engine before the solve job to update", async () => {
    const view = solvePage({});
    expect(await screen.findByText(/^No case made with New case yet/)).toBeInTheDocument();
    view.unmount();
    solvePage({ made: { c: "ahmed-body" }, noRuns: true });
    expect(await screen.findByText(/^Your engine is older than this page and can't solve cases from here yet/)).toBeInTheDocument();
    expect(OLD_ENGINE_RUNS).toContain("`git pull`");
    expect(screen.queryByRole("list", { name: "Runs" })).toBeNull();
  });
});

describe("a run's page", () => {
  it("follows a solve: its progress and pace, residuals and forces, the live judge, and Stop", async () => {
    const user = userEvent.setup();
    const { posted } = runPage("a", { made: { a: "ahmed-body" }, runs: [run("a")], jobs: [job("a", "running")] });
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
    expect(screen.queryByRole("button", { name: /Continue/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByText("Stopping: the solver writes the iteration it has reached, then ends.")).toBeInTheDocument();
    expect(posted).toEqual([{ path: "/runs/a/stop", body: undefined }]);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("judges a run that has ended, and continues it from the latest iteration written", async () => {
    const user = userEvent.setup();
    const { posted, router } = runPage("b", { made: { b: "ahmed-body" }, runs: [stopped("b")] });
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
    expect(screen.getByText(/or it is being solved in a terminal\. What it wrote is kept, to iteration 100/)).toBeInTheDocument();
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
