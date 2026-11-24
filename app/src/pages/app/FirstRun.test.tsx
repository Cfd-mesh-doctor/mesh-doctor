// SPDX-License-Identifier: GPL-3.0-or-later
// Try it on the Ahmed body: each step ticked off from what the engine lists, and started here with the screens'
// own dialogs, set for the guide (the Ahmed body's coarse mesh, a short solve, a repair and an A/B test of it).
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import type { MachineInfo } from "@/engine/types";
import { renderScreen } from "@/test/render";
import { OLD_ENGINE_CASES } from "./caseStart";
import { FirstRun } from "./FirstRun";

const MACHINE: MachineInfo = { cpus: 8, cores: 4, memoryMb: 16_000, ramLimitMb: null };
const TEMPLATES = {
  items: [{
    name: "ahmed-body", label: "Ahmed body", about: "The standard car shape.", size: "medium",
    sizes: [
      { name: "coarse", label: "Coarse", cells: 480_000, about: "" },
      { name: "medium", label: "Medium", cells: 1_500_000, about: "" },
    ],
  }],
};
const RUN = { name: "ahmed-coarse", state: "done", step: "done", iteration: 1000, start: 0, end: 1000, written: 1000,
  nProcs: 4, stretches: [{ from: 0, to: 1000 }], started: null, updated: null, finished: null, error: null };
const REPAIR = { name: "ahmed-coarse-fix", source: "~/cases/ahmed-coarse", finished: "2026-11-24 10:00:00",
  verdict: { improved: ["maxNonOrth"], regressions: [], summary: "" }, nCells: 480_000, status: null };

interface Engine {
  ready?: boolean; made?: boolean; runs?: unknown[]; judge?: string; repairs?: unknown[]; tests?: unknown;
  templates?: unknown; jobs?: unknown[];
}

function engine(o: Engine = {}): Transport {
  return {
    kind: "engine",
    scope: "test",
    request: async <T,>(method: string, path: string) => {
      const route = path.split("?")[0]!;
      if (method === "POST") throw new EngineError("busy", "not in this test", 409);
      const answers: Record<string, unknown> = {
        "/check": { ready: o.ready ?? true, checks: o.ready === false ? [{ name: "OpenFOAM", state: "fail", found: "none" }] : [] },
        "/templates": o.templates === null ? undefined : TEMPLATES,
        "/cases": o.made
          ? { items: ["mine", "ahmed-coarse"], cells: { "ahmed-coarse": 478_901 }, made: { "ahmed-coarse": { template: "ahmed-body" } } }
          : { items: ["mine"], cells: {}, made: {} },
        "/runs": { items: o.runs ?? [] },
        "/jobs": { items: o.jobs ?? [] },
        "/repairs": { items: o.repairs ?? [] },
        "/abtests": o.tests ?? { items: [], tests: {} },
        "/judge": { verdict: o.judge ?? "converged", window: 200 },
        "/machine": MACHINE,
        "/variants": { items: [] },
      };
      if (answers[route] !== undefined) return answers[route] as T;
      throw new EngineError("not-found", `no such API route ${route}`, 404);
    },
  };
}

const page = (o: Engine = {}) => renderScreen(<FirstRun />, { path: "/app/first-run", transport: engine(o) });
const step = (title: string) => screen.getByRole("heading", { name: title, level: 3 }).closest("li")!;
const dialog = () => within(screen.getByRole("dialog"));

describe("Try it on the Ahmed body", () => {
  it("starts with a coarse Ahmed case: New case opens with the Ahmed body's coarse mesh picked", async () => {
    const user = userEvent.setup();
    page();
    expect(await screen.findByText("1 of 6 done")).toBeInTheDocument();
    expect(step("Make a coarse Ahmed case")).toHaveAttribute("aria-current", "step");
    expect(step("Make a coarse Ahmed case")).toHaveTextContent("about 480,000 cells: the quickest to solve");
    expect(within(step("Solve it, to iteration 1,000")).queryByRole("button")).toBeNull();
    await user.click(screen.getByRole("button", { name: "New case…" }));
    expect(await dialog().findByRole("combobox", { name: "Template" })).toHaveValue("ahmed-body");
    expect(dialog().getByRole("radio", { name: "Coarse" })).toHaveAttribute("aria-checked", "true");
  });

  it("then solves it a short way: Solve opens set to iteration 1,000", async () => {
    const user = userEvent.setup();
    page({ made: true });
    expect(await screen.findByText("2 of 6 done")).toBeInTheDocument();
    expect(step("Make a coarse Ahmed case")).toHaveTextContent("ahmed-coarse, made from the Ahmed body template: about 478,901 cells");
    // its name kept whole on a line, with the comma after it (InlineCode)
    const made = within(step("Make a coarse Ahmed case")).getByText("ahmed-coarse", { selector: "code" });
    expect(made.parentElement).toHaveClass("code-box");
    expect(made.parentElement).toHaveTextContent(/^ahmed-coarse,$/);
    await user.click(screen.getByRole("button", { name: "Solve…" }));
    expect(await dialog().findByRole("textbox", { name: "Solve to iteration" })).toHaveValue("1000");
  });

  it("reads the judge's verdict on the solve, then repairs a copy of the case", async () => {
    const user = userEvent.setup();
    page({ made: true, runs: [RUN], judge: "not converged yet" });
    expect(await screen.findByText("4 of 6 done")).toBeInTheDocument();
    expect(step("Read the judge's verdict")).toHaveTextContent("The judge says not converged yet.");
    expect(within(step("Solve it, to iteration 1,000")).getByRole("link", { name: "its page" }))
      .toHaveAttribute("href", "/app/solve/ahmed-coarse");
    await user.click(screen.getByRole("button", { name: "Repair a copy…" }));
    expect(await dialog().findByRole("combobox", { name: "Case" })).toHaveValue("ahmed-coarse");
  });

  it("A/B tests the repair, and its end finishes the guide", async () => {
    const user = userEvent.setup();
    const view = page({ made: true, runs: [RUN], repairs: [REPAIR] });
    expect(await screen.findByText("5 of 6 done")).toBeInTheDocument();
    expect(within(step("Repair a copy of it")).getByRole("link", { name: "report" }))
      .toHaveAttribute("href", "/app/repairs/ahmed-coarse-fix/report");
    expect(within(step("Repair a copy of it")).getByText("ahmed-coarse-fix", { selector: "code" }).parentElement)
      .toHaveTextContent(/^ahmed-coarse-fix:$/);
    await user.click(screen.getByRole("button", { name: "A/B test it…" }));
    expect(await dialog().findByRole("heading", { name: /A\/B test/ })).toBeInTheDocument();
    view.unmount();
    page({ made: true, runs: [RUN], repairs: [REPAIR],
      tests: { items: ["ahmed-coarse-fix"], tests: { "ahmed-coarse-fix": { finished: "2026-11-24 11:00:00" } } } });
    expect(await screen.findByText("6 of 6 done")).toBeInTheDocument();
    expect(within(step("A/B test the repair")).getByRole("link", { name: "its page" }))
      .toHaveAttribute("href", "/app/abtests/ahmed-coarse-fix");
    expect(screen.queryByRole("button", { name: /…$/ })).toBeNull();
  });

  it("says when a step's last try failed, and where its log is", async () => {
    const failed = {
      id: "20261124-100000-case-ahmed-coarse-ab12", kind: "case", name: "ahmed-coarse", state: "failed",
      params: { template: "ahmed-body", size: "coarse", name: "ahmed-coarse", replace: false },
      error: "blockMesh failed", created: "2026-11-24T10:00:00Z", log: "ahmed-coarse.log", runner: "local",
      schemaVersion: "1.0",
    };
    page({ jobs: [failed] });
    expect(await screen.findByText(/^The last try failed: blockMesh failed\. Its log is on the/)).toBeInTheDocument();
    expect(within(step("Make a coarse Ahmed case")).getByRole("link", { name: "Jobs screen" }))
      .toHaveAttribute("href", "/app/jobs?show=failed");
    expect(screen.getByRole("button", { name: "New case…" })).toBeInTheDocument();
  });

  it("waits for the engine's checks to pass, saying where their fixes are", async () => {
    page({ ready: false });
    expect(await screen.findByText(/^1 check fails: each says how to fix it/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Solve screen" })).toHaveAttribute("href", "/app/solve");
    expect(screen.queryByRole("button", { name: "New case…" })).toBeNull();
  });

  it("says when the engine is older than the guide", async () => {
    page({ templates: null });
    expect(await screen.findByText(OLD_ENGINE_CASES)).toBeInTheDocument();
    expect(screen.queryByText(/of 6 done/)).toBeNull();
  });
});
