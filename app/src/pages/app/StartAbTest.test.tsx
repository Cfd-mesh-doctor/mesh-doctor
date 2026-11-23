// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { DEMO_VARIANTS, demoTransport } from "@/demo/transport";
import type { Method, Transport } from "@/engine/client";
import { abCommand, abExtendCommand } from "@/engine/commands";
import { EngineError } from "@/engine/errors";
import { isActive, type AbtestDetail, type Job, type JobList, type MachineInfo, type RepairSummary } from "@/engine/types";
import { caseName } from "@/engine/verdict";
import { renderScreen } from "@/test/render";
import { AbTest } from "./AbTest";
import { AbTests } from "./AbTests";
import {
  abRanks, abTestName, extendTarget, itersProblem, runSeconds, secondRunAt, targetProblem, testableRuns,
} from "./abStart";

const VERDICT = { improved: ["maxNonOrtho"], regressions: [], unchanged: [] };
const run = (name: string, source: string | null, finished: string | null = "2026-11-23 10:00:00"): RepairSummary =>
  ({ name, finished, nCells: 2_000_000, profile: "openfoam", source, status: {}, verdict: finished ? VERDICT : null });
/** 16 GB and 4 cores: a run of the test gets 4 ranks, not the command's 6. */
const MACHINE: MachineInfo = { cpus: 8, cores: 4, memoryMb: 16_000, ramLimitMb: null };
const job = (kind: Job["kind"], name: string, state: Job["state"], error?: string) =>
  ({ id: `20261123-120000-${kind}-${name}-ab12`, kind, name, state, params: {}, error }) as Job;

describe("which runs an A/B test starts from, and the name it gets", () => {
  it("takes finished runs whose source case the engine finds by its folder's name", () => {
    const runs = [run("wing-fix", "/cases/wing"), run("half", "/cases/wing", null), run("odd", "/cases/my case"), run("none", null)];
    expect(testableRuns(runs).map((r) => r.name)).toEqual(["wing-fix"]);
    expect(testableRuns(undefined)).toEqual([]);
  });

  it("is the run's own on the repaired mesh, and <case>_<variant> for other settings on the original mesh", () => {
    expect(abTestName(run("wing-fix", "/cases/wing"), "")).toBe("wing-fix");
    expect(abTestName(run("wing-fix", "/cases/wing"), "lts")).toBe("wing_lts");
  });
});

describe("an A/B test's numbers", () => {
  it("takes 20 to 2000 iterations a run, and a continuation past where its run is, up to 5000", () => {
    for (const ok of ["20", "200", " 2000 "]) expect(itersProblem(ok), ok).toBeNull();
    for (const bad of ["", "19", "2001", "1e3", "200.5", "-5", "abc"]) expect(itersProblem(bad), bad).toBe("A whole number from 20 to 2,000.");
    expect(targetProblem("201", 200)).toBeNull();
    expect(targetProblem("5000", 200)).toBeNull();
    for (const bad of ["200", "5001", ""]) expect(targetProblem(bad, 200), bad).toBe("A whole number from 201 to 5,000.");
  });

  it("times a run with the size estimator's model on the ranks it gets, or at the pace it had", () => {
    // 9.5 rank-seconds per million cells an iteration: 2 M cells and 200 iterations on 6 ranks, or on 4 cores.
    expect(abRanks(undefined)).toBe(6);
    expect(abRanks({ ...MACHINE, cores: 12 })).toBe(6);
    expect(abRanks(MACHINE)).toBe(4);
    expect(runSeconds(2e6, 200, undefined)).toBeCloseTo(633.33, 1);
    expect(runSeconds(2e6, 200, MACHINE)).toBeCloseTo(950, 6);
    expect(runSeconds(null, 200, MACHINE, 1.5)).toBe(300);
    expect(runSeconds(null, 200, MACHINE)).toBeNull();
    expect(runSeconds(2e6, 0, MACHINE)).toBeNull();
  });

  it("finds where the second run is: where its last continuation ended, or further when its residuals go on", () => {
    const result = { iters: 200, fixed: {}, extensions: [{ to: 400 }, { to: 700 }] } as unknown as NonNullable<AbtestDetail["result"]>;
    expect(secondRunAt(result, 650)).toBe(700);
    expect(secondRunAt(result, 720)).toBe(720);
    expect(secondRunAt({ ...result, extensions: undefined }, null)).toBe(200);
    expect(secondRunAt({ ...result, fixed: undefined }, 200)).toBeNull(); // the second run hasn't ended
    expect(extendTarget(200, 200)).toBe(400);
    expect(extendTarget(4900, 200)).toBe(5000);
  });

  it("gives the commands that do the same in a terminal", () => {
    expect(abCommand("wing", "wing-fix", { iters: 200, init: "auto", variant: "" })).toBe("meshdoctor ab wing wing-fix");
    expect(abCommand("wing", "wing-fix", { iters: 400, init: "0.warm" })).toBe("meshdoctor ab wing wing-fix --iters 400 --init 0.warm");
    // Other settings on the original mesh: "-" in place of the repaired run.
    expect(abCommand("wing", "wing-fix", { variant: "lts" })).toBe("meshdoctor ab wing - --variant lts");
    expect(abExtendCommand("wing-fix", 400)).toBe("meshdoctor ab extend wing-fix 400");
    expect(abExtendCommand("my test", 400)).toBeNull();
  });
});

/** Your own engine: these runs and A/B tests, a 16 GB computer with 4 cores, the jobs, and what POST /jobs answers
 *  (a queued job named as the engine names the test). */
function ownEngine(ui: ReactElement, at: string, { runs = [run("wing-fix", "/cases/wing")], tests = [], jobs = [], refuse, variants = true }: {
  runs?: RepairSummary[];
  tests?: string[];
  jobs?: Job[];
  refuse?: EngineError;
  variants?: boolean;
} = {}) {
  const posted: unknown[] = [];
  const transport: Transport = {
    kind: "engine",
    scope: "test",
    request: async <T,>(method: Method, path: string, body?: unknown) => {
      const route = path.split("?")[0]!;
      if (method === "POST" && route === "/jobs") {
        posted.push(body);
        if (refuse) throw refuse;
        const b = body as { kind: Job["kind"]; params: { name: string; variant?: string } };
        const source = runs.find((r) => r.name === b.params.name)?.source;
        const name = b.params.variant ? `${caseName(source)}_${b.params.variant}` : b.params.name;
        return { ...job(b.kind, name, "queued"), params: b.params } as T;
      }
      if (route === "/repairs") return { items: runs } as T;
      if (route === "/cases") return { items: ["wing"], cells: { wing: 2_000_000 } } as T;
      if (route === "/jobs") return { items: jobs } as T;
      if (route === "/machine") return MACHINE as T;
      if (route === "/variants" && variants) return structuredClone(DEMO_VARIANTS) as T;
      if (route === "/abtests") {
        const brief = { step: "done", updated: null, finished: "2026-11-23 11:00:00", ratios: { p: 0.9 }, verdict: null };
        return { items: tests, tests: Object.fromEntries(tests.map((n) => [n, brief])) } as T;
      }
      throw new EngineError("not-found", "no such route", 404);
    },
  };
  return { ...renderScreen(ui, { path: "/app/abtests", at, transport }), posted };
}

const dialog = () => screen.getByRole("dialog");
const startButton = () => within(dialog()).getByRole("button", { name: "Start A/B test" });
const field = (name: string) => within(dialog()).getByRole("textbox", { name });
const pick = (name: string) => within(dialog()).getByRole("combobox", { name });

describe("starting an A/B test from the A/B tests screen", () => {
  it("picks the first run with no test yet, says what runs and about how long, then opens the test's page", async () => {
    const user = userEvent.setup();
    const { posted, router } = ownEngine(<AbTests />, "/app/abtests", {
      runs: [run("wing-fix", "/cases/wing"), run("wing-fix-2", "/cases/wing")],
      tests: ["wing-fix"],
    });
    await user.click(await screen.findByRole("button", { name: "Start an A/B test" }));
    expect(within(dialog()).getByRole("heading", { name: "Start an A/B test" })).toBeInTheDocument();
    expect(pick("Repair run")).toHaveValue("wing-fix-2"); // wing-fix has a test already
    expect(dialog()).toHaveTextContent("case wing · 2,000,000 cells");
    expect(pick("Second run")).toHaveValue("");
    // 9.5 × 2 M cells × 200 iterations on 4 ranks: 950 s a run, 32 min for both.
    expect(dialog()).toHaveTextContent(
      "Solves wing twice, 200 iterations each: on the original mesh, then on the repaired mesh of wing-fix-2. About 32 min in all on 4 solver ranks.");
    expect(dialog()).toHaveTextContent("Needs about 3.5 GB of memory; your engine's computer has 15.6 GB.");

    await user.clear(field("Iterations"));
    await user.type(field("Iterations"), "400");
    expect(dialog()).toHaveTextContent("About 63 min in all on 4 solver ranks.");
    await user.selectOptions(pick("Both runs start from"), "0.warm");
    await user.click(startButton());
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/abtests/wing-fix-2"));
    expect(posted).toEqual([{ kind: "abtest", params: { name: "wing-fix-2", iters: 400, init: "0.warm", variant: "", replace: false } }]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tests solver settings on the original mesh with a variant: the test is named after the case", async () => {
    const user = userEvent.setup();
    const { posted, router } = ownEngine(<AbTests />, "/app/abtests");
    // No test yet: the empty list starts one.
    await user.click(await screen.findByRole("button", { name: "Start an A/B test" }));
    const second = pick("Second run");
    await within(second).findByRole("option", { name: "Original mesh, SIMPLEC (consistent yes, U 0.9)" });
    await user.selectOptions(second, "simplec");
    expect(second).toHaveAccessibleDescription(
      "Tests the solver settings, not the repair: both runs solve the original mesh, the second with these settings. The test is called wing_simplec.");
    expect(dialog()).toHaveTextContent("Solves the original mesh of wing twice, 200 iterations each: with the case's settings, then with " +
      "SIMPLEC (consistent yes, U 0.9). About 32 min in all on 4 solver ranks, or half that when an earlier test solved the first run " +
      "with the same iterations and start.");
    await user.click(startButton());
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/abtests/wing_simplec"));
    expect(posted).toEqual([{ kind: "abtest", params: { name: "wing-fix", iters: 200, init: "auto", variant: "simplec", replace: false } }]);
  });

  it("won't start with iterations the engine refuses, nor over a test unless Replace is ticked", async () => {
    const user = userEvent.setup();
    const { posted, router } = ownEngine(<AbTests />, "/app/abtests", { tests: ["wing-fix"] });
    await user.click(await screen.findByRole("button", { name: "Start an A/B test" }));
    expect(dialog()).toHaveTextContent("The engine has an A/B test called wing-fix already. Starting this one replaces it: its results are deleted.");
    expect(startButton()).toBeDisabled();
    await user.click(within(dialog()).getByRole("checkbox", { name: "Replace wing-fix" }));
    expect(startButton()).toBeEnabled();

    await user.clear(field("Iterations"));
    await user.type(field("Iterations"), "10");
    expect(field("Iterations")).toHaveAccessibleDescription("A whole number from 20 to 2,000.");
    expect(field("Iterations")).toHaveAttribute("aria-invalid", "true");
    expect(startButton()).toBeDisabled();
    await user.type(field("Iterations"), "0");
    await user.click(startButton());
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/abtests/wing-fix"));
    expect(posted).toEqual([{ kind: "abtest", params: { name: "wing-fix", iters: 100, init: "auto", variant: "", replace: true } }]);
  });

  it("waits while another job runs, as the engine runs one big job at a time", async () => {
    const user = userEvent.setup();
    ownEngine(<AbTests />, "/app/abtests", { jobs: [job("repair", "cyl-fix", "running")] });
    await user.click(await screen.findByRole("button", { name: "Start an A/B test" }));
    expect(await within(dialog()).findByText(/Repair cyl-fix is running\. The engine runs one big job at a time/)).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });

  it("shows the engine's reason when it refuses the test, and stays open", async () => {
    const user = userEvent.setup();
    ownEngine(<AbTests />, "/app/abtests", {
      refuse: new EngineError("unsupported", "A/B test supports serial (root) meshes only for now", 422),
    });
    await user.click(await screen.findByRole("button", { name: "Start an A/B test" }));
    await user.click(startButton());
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("A/B test supports serial (root) meshes only for now");
    expect(startButton()).toBeEnabled();
  });

  it("offers the repaired mesh alone when the engine doesn't say which other settings it has", async () => {
    const user = userEvent.setup();
    ownEngine(<AbTests />, "/app/abtests", { variants: false });
    await user.click(await screen.findByRole("button", { name: "Start an A/B test" }));
    await waitFor(() => expect(pick("Second run")).toHaveAccessibleDescription(
      "Tests the repair: only the mesh differs. The engine didn't say which other solver settings it has."));
    expect(within(pick("Second run")).getAllByRole("option")).toHaveLength(1);
  });

  it("has nothing to start before a repair has finished", async () => {
    ownEngine(<AbTests />, "/app/abtests", { runs: [run("wing-fix", "/cases/wing", null)] });
    expect(await screen.findByRole("heading", { name: "No A/B tests yet" })).toBeInTheDocument();
    expect(screen.getByText(/It starts from a finished repair, so repair a case first; each test shows here while it runs\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start an A/B test" })).toBeNull();
  });
});

describe("the demo's A/B test dialog", () => {
  it("says the demo can't start jobs and gives the command that does the same, with what was picked", async () => {
    const user = userEvent.setup();
    renderScreen(<AbTests />, { path: "/demo/abtests", transport: demoTransport(undefined, 0) });
    await user.click(await screen.findByRole("button", { name: "Start an A/B test" }));
    expect(pick("Repair run")).toHaveValue("ahmed25-fine-fix"); // the first with no test
    expect(dialog()).toHaveTextContent("The demo can't start jobs.");
    // 1,565,115 cells, 200 iterations a run on the demo computer's 6 of 8 cores.
    expect(dialog()).toHaveTextContent("About 17 min in all on 6 solver ranks.");
    expect(within(dialog()).getByText("meshdoctor ab ahmed-25-fine ahmed25-fine-fix")).toBeInTheDocument();
    await within(pick("Second run")).findByRole("option", { name: "Original mesh, pseudo-transient local time stepping (localEuler)" });
    await user.selectOptions(pick("Second run"), "lts");
    expect(within(dialog()).getByText("meshdoctor ab ahmed-25-fine - --variant lts")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Start A/B test" })).toBeNull();
  });
});

/** The demo's recorded A/B tests as your own engine would give them, where POST /jobs starts a job: it is then in the
 *  jobs list, as the engine's would be. `idle`: without the demo's running job, so the engine can start one. */
function ownDemo(name: string, idle = false) {
  const demo = demoTransport(undefined, 0);
  const posted: unknown[] = [];
  const started: Job[] = [];
  const transport: Transport = {
    kind: "engine",
    scope: "own",
    request: async <T,>(method: Method, path: string, body?: unknown, signal?: AbortSignal) => {
      if (method === "POST" && path === "/jobs") {
        posted.push(body);
        const b = body as { kind: Job["kind"]; params: { name: string } };
        started.unshift({ ...job(b.kind, b.params.name, "queued"), params: b.params } as Job);
        return structuredClone(started[0]) as T;
      }
      const answer = await demo.request<T>(method, path, body, signal);
      if (path.split("?")[0] === "/jobs") {
        const list = answer as JobList;
        return { ...list, items: [...structuredClone(started), ...list.items.filter((j) => !idle || !isActive(j.state))] } as T;
      }
      return answer;
    },
  };
  return { ...renderScreen(<AbTest />, { path: "/app/abtests/:name", at: `/app/abtests/${name}`, transport }), posted };
}

describe("running an A/B test longer", () => {
  it("continues the second run from where it stopped, at the pace it had, and the page follows the job", async () => {
    const user = userEvent.setup();
    const { posted } = ownDemo("ahmed25-coarse-fix", true);
    await user.click(await screen.findByRole("button", { name: "Run longer" }));
    expect(within(dialog()).getByRole("heading", { name: "Run ahmed25-coarse-fix longer" })).toBeInTheDocument();
    // 200 iterations a run: as far again, at the 0.39 s an iteration the recorded run took.
    expect(field("Continue to iteration")).toHaveValue("400");
    expect(field("Continue to iteration")).toHaveAccessibleDescription("The second run is at iteration 200; the engine goes up to 5,000.");
    expect(dialog()).toHaveTextContent("Solves 200 more iterations on the second run's copy, about 1 min at the 0.39 s an iteration it took so far.");

    await user.clear(field("Continue to iteration"));
    await user.type(field("Continue to iteration"), "150");
    expect(field("Continue to iteration")).toHaveAccessibleDescription("A whole number from 201 to 5,000.");
    expect(within(dialog()).getByRole("button", { name: "Continue" })).toBeDisabled();
    await user.clear(field("Continue to iteration"));
    await user.type(field("Continue to iteration"), "1000");
    expect(dialog()).toHaveTextContent("Solves 800 more iterations on the second run's copy, about 5 min");
    expect(dialog()).not.toHaveTextContent("one big job at a time");
    await user.click(within(dialog()).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posted).toEqual([{ kind: "abextend", params: { name: "ahmed25-coarse-fix", to: 1000 } }]);
    // Its job is waiting: the page says so, and there is nothing to run longer until it has ended.
    expect(await screen.findByRole("link", { name: "Job details" })).toHaveAttribute("href",
      `/app/jobs?job=${encodeURIComponent(job("abextend", "ahmed25-coarse-fix", "queued").id)}`);
    expect(screen.queryByRole("button", { name: "Run longer" })).toBeNull();
  });

  it("isn't offered while the test runs", async () => {
    ownDemo("ahmed25-medium-fix");
    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run longer" })).toBeNull();
  });

  it("in the demo, gives the command that does the same", async () => {
    const user = userEvent.setup();
    renderScreen(<AbTest />, { path: "/demo/abtests/:name", at: "/demo/abtests/ahmed25-coarse-fix", transport: demoTransport(undefined, 0) });
    await user.click(await screen.findByRole("button", { name: "Run longer" }));
    expect(dialog()).toHaveTextContent("The demo can't start jobs. With your own engine paired, Continue runs this on your computer");
    expect(within(dialog()).getByText("meshdoctor ab extend ahmed25-coarse-fix 400")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Continue" })).toBeNull();
  });
});

describe("a test just started", () => {
  /** An engine that has no A/B test of the name yet, and this job for it. */
  function starting(j: Job) {
    const transport: Transport = {
      kind: "engine",
      scope: "test",
      request: async <T,>(_m: Method, path: string) => {
        if (path.startsWith("/jobs")) return { items: [j] } as T;
        if (path === "/repairs") return { items: [] } as T;
        throw new EngineError("not-found", `no A/B test ${j.name}`, 404);
      },
    };
    return renderScreen(<AbTest />, { path: "/app/abtests/:name", at: `/app/abtests/${j.name}`, transport });
  }

  it("shows as starting while its job makes the test's folder, not as missing", async () => {
    starting(job("abtest", "wing-fix", "queued"));
    expect(await screen.findByText("Starting")).toBeInTheDocument();
    expect(screen.getByText("Its job is waiting to start")).toBeInTheDocument();
    expect(screen.getByText(/the test shows here as soon as its first step begins/)).toBeInTheDocument();
    expect(screen.queryByText(/The engine has no A\/B test of this name/)).toBeNull();
  });

  it("says why when its job stopped before the test began", async () => {
    starting(job("abtest", "wing-fix", "failed", "not enough memory: the solve needs about 3.5 GB; 1.2 GB free"));
    expect(await screen.findByText("The test didn't start")).toBeInTheDocument();
    expect(screen.getByText(/^not enough memory: the solve needs about 3\.5 GB; 1\.2 GB free/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "its job" })).toHaveAttribute("href",
      `/app/jobs?job=${encodeURIComponent(job("abtest", "wing-fix", "failed").id)}`);
  });
});
