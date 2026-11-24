// SPDX-License-Identifier: GPL-3.0-or-later
// The Solve screen's Verify install: starting it, following it, continuing it to 2,000, and its comparison with the
// accuracy check, drawn as that check's chart draws its cases.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import type { Job, MachineInfo, Run, RunValidation } from "@/engine/types";
import { renderScreen } from "@/test/render";
import { OLD_ENGINE_VERIFY, VerifyInstall } from "./VerifyInstall";

const MACHINE: MachineInfo = { cpus: 8, cores: 8, memoryMb: 16_000, ramLimitMb: null };

const run = (name: string, more: Partial<Run> = {}): Run => ({
  name, state: "done", step: "done", iteration: 2000, start: 0, end: 2000, written: 2000, nProcs: 6,
  stretches: [{ from: 0, to: 2000 }], started: "2026-11-23T21:09:54Z", updated: "2026-11-23T21:24:19Z",
  finished: "2026-11-23T21:24:19Z", error: null, ...more,
});
const job = (name: string, state: Job["state"], more: Partial<Job> = {}) =>
  ({ id: `20261123-210954-solve-${name}-9bd7`, kind: "solve", name, state,
    params: { name, template: "ahmed-body", size: "coarse", to: 2000, np: 6 }, ...more }) as Job;

/** GET /runs/verify-install/validation as a real coarse run with OpenFOAM 14 answered it. */
const MATCHING: RunValidation = {
  name: "verify-install", state: "done", template: "ahmed-body", size: "coarse", slant: 25, cells: 478_901,
  iterations: 2000, window: 500, cd: 0.2986, cl: 0.2978, drift: -0.11,
  tunnel: { cd: 0.285, difference: 4.76 },
  published: { cd: 0.299, cl: 0.298, iterations: 2000, difference: -0.15 },
  comparable: true, matches: true,
};

/** Your own engine (or the demo, by `kind`) with these runs and jobs, and this answer to the comparison (an error it
 * throws, or none from an engine before it); `noRuns`: an engine before the solve job. */
function engine(o: {
  runs?: Run[]; jobs?: Job[]; validation?: RunValidation | EngineError; noRuns?: boolean; kind?: "engine" | "demo";
  /** the MB free GET /disk says for the coarse Ahmed body (API 1.13): nothing, as an older engine, unless given;
   * `old`: an engine before API 1.13, which says the free space but not what the template's case takes */
  freeMb?: number; old?: boolean;
} = {}) {
  const posted: unknown[] = [];
  const transport: Transport = {
    kind: o.kind ?? "engine",
    scope: "test",
    request: async <T,>(method: string, path: string, body?: unknown) => {
      if (method === "POST" && path === "/jobs") {
        posted.push(body);
        const p = (body as { params: { name: string } }).params;
        return job(p.name, "queued", { params: p }) as T;
      }
      if (path === "/cases") {
        const made = Object.fromEntries((o.runs ?? []).map((r) => [r.name, { template: "ahmed-body" }]));
        return { items: ["mine", ...Object.keys(made)], made } as T;
      }
      if (path === "/runs" && !o.noRuns) return { items: o.runs ?? [] } as T;
      if (path === "/jobs") return { items: o.jobs ?? [] } as T;
      if (path === "/machine") return MACHINE as T;
      if (path === "/disk?template=ahmed-body&size=coarse" && o.freeMb != null) {
        // its new case, the mesh with its sets, 68 MB, then what its solve writes: 215 MB split, 80 on one process
        return { freeMb: o.freeMb, keepMb: 1024, case: null, ...(o.old ? {} : {
          template: { name: "ahmed-body", size: "coarse", madeMb: 68, solveMb: { several: 215, one: 80 } } }) } as T;
      }
      if (/^\/runs\/[^/]+\/validation$/.test(path) && o.validation) {
        if (o.validation instanceof EngineError) throw o.validation;
        return structuredClone(o.validation) as T;
      }
      throw new EngineError("not-found", `no such API route ${path}`, 404);
    },
  };
  return { transport, posted };
}

const show = (o: Parameters<typeof engine>[0] = {}) => {
  const e = engine(o);
  const view = renderScreen(<VerifyInstall />, { path: "/app/solve", transport: e.transport });
  return { posted: e.posted, unmount: view.unmount,
    card: () => within(screen.getByRole("heading", { name: "Verify install" }).closest("section")!) };
};
const dialog = () => within(screen.getByRole("dialog"));

describe("Verify install", () => {
  it("before one: says what it does, and starts it as the accuracy check's coarse run under a free name", async () => {
    const user = userEvent.setup();
    const { posted, card } = show({ runs: [run("verify-install", { state: "cancelled", written: 0 })], freeMb: 402_339 });
    expect(card().getByText(/^Whether your install gives the answer the accuracy check got/)).toBeInTheDocument();
    await user.click(await card().findByRole("button", { name: "Verify install again…" }));
    expect(dialog().getByRole("heading", { name: "Verify install" })).toBeInTheDocument();
    const name = dialog().getByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("verify-install-2");                  // the one cut short keeps its folder
    await user.clear(name);
    await user.type(name, "mine");
    expect(dialog().getByText("A case or a run has this name already. Pick another name.")).toBeInTheDocument();
    expect(dialog().getByRole("button", { name: "Verify install" })).toBeDisabled();
    await user.clear(name);
    await user.type(name, "verify-install-2");
    expect(dialog().getByRole("combobox", { name: "Processes" })).toHaveValue("6");
    expect(dialog().getByText(/^Its mesh, more than its solve, needs about/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent(
      "Its mesh and its solve need about 283 MB of disk space; the disk the cases are on has 393 GB free."));
    await user.click(dialog().getByRole("button", { name: "Verify install" }));
    expect(posted).toEqual([{ kind: "solve", params: { name: "verify-install-2", template: "ahmed-body", size: "coarse",
      to: 2000, np: 6 } }]);
    expect(screen.queryByRole("dialog")).toBeNull();                 // it stays on this screen, which follows it
  });

  it("warns when its new case and what its solve writes won't fit on the disk; an older engine says nothing", async () => {
    const user = userEvent.setup();
    const view = show({ freeMb: 1200 });
    await user.click(await view.card().findByRole("button", { name: "Verify install…" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("Its mesh and its solve need about 283 MB "
      + "of disk space, more than the disk the cases are on can give: it has 1.2 GB free, and the engine keeps 1.0 GB of "
      + "that for everything else. Delete runs or results you no longer need: the engine refuses a solve that won't fit."));
    expect(dialog().getByRole("button", { name: "Verify install" })).toBeEnabled();            // the engine decides
    await user.selectOptions(dialog().getByRole("combobox", { name: "Processes" }), "1");      // unsplit, it writes less
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Its mesh and its solve need about 148 MB of disk space; the disk the cases are on has 1.2 GB free.");
    view.unmount();
    const older = show({ freeMb: 402_339, old: true });
    await user.click(await older.card().findByRole("button", { name: "Verify install…" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent(/Its mesh, more than its solve, needs about/));
    expect(screen.getByRole("dialog")).not.toHaveTextContent(/disk space/);
  });

  it("with none yet: Verify install…, and the command that does the same in a terminal", async () => {
    const { card } = show();
    expect(await card().findByRole("button", { name: "Verify install…" })).toBeEnabled();
    expect(card().getByText("meshdoctor solve verify-install --template ahmed-body --size coarse --to 2000 --np 6"))
      .toBeInTheDocument();
  });

  it("while it makes its mesh, then solves: the step in plain words, and how far it has come", async () => {
    const meshing = run("verify-install", { state: "running", step: "meshing: snappyHexMesh: snapping", iteration: 0,
      written: 0, stretches: [], finished: null });
    const { card } = show({ runs: [meshing], jobs: [job("verify-install", "running")] });
    expect(await card().findByText("Snapping the mesh to the shape (snappyHexMesh)")).toBeInTheDocument();
    expect(card().getByRole("link", { name: "verify-install" })).toHaveAttribute("href", "/app/solve/verify-install");
    expect(card().getByRole("progressbar", { name: "Progress of verify-install" })).not.toHaveAttribute("aria-valuenow");
    expect(card().queryByRole("button", { name: /^Verify install/ })).toBeNull();
  });

  it("solving: the iteration of 2,000", async () => {
    const solving = run("verify-install", { state: "running", step: "solving", iteration: 500, written: 500, stretches: [],
      finished: null });
    const { card } = show({ runs: [solving], jobs: [job("verify-install", "running")] });
    expect(await card().findByText("Solving (foamRun) · iteration 500 of 2,000")).toBeInTheDocument();
    expect(card().getByRole("progressbar", { name: "Progress of verify-install" })).toHaveAttribute("aria-valuenow", "25");
  });

  it("stopped short of 2,000: continues it there, on its own processes", async () => {
    const user = userEvent.setup();
    const { posted, card } = show({ runs: [run("verify-install", { state: "stopped", written: 1200, end: 1200,
      stretches: [{ from: 0, to: 1200 }] })] });
    expect(await card().findByText(/stopped at iteration 1,200 of 2,000\. Continue it to 2,000/)).toBeInTheDocument();
    await user.click(card().getByRole("button", { name: "Continue to 2,000…" }));
    expect(dialog().getByRole("textbox", { name: "Solve to iteration" })).toHaveValue("2000");
    await user.click(dialog().getByRole("button", { name: "Continue" }));
    expect(posted).toEqual([{ kind: "solve", params: { name: "verify-install", to: 2000 } }]);
  });

  it("failed: says why, where its log is, and starts a new one beside it", async () => {
    const said = "the mesh failed at snappyHexMesh: see log.snappyHexMesh in the case's folder";
    const { card } = show({ runs: [run("verify-install", { state: "failed", written: 0, step: "meshing: snappyHexMesh: refining",
      error: said })], jobs: [job("verify-install", "failed", { error: said })] });
    expect(await card().findByText(`stopped with an error: ${said}.`, { exact: false })).toBeInTheDocument();
    expect(card().getByRole("link", { name: "Jobs screen" })).toHaveAttribute("href", "/app/jobs?show=failed");
    expect(card().getByRole("button", { name: "Verify install again…" })).toBeEnabled();
  });

  it("solved to 2,000: the same answer as the accuracy check, beside its run on that check's chart", async () => {
    const { card } = show({ runs: [run("verify-install")], validation: MATCHING });
    expect(await card().findByText("Same answer")).toBeInTheDocument();
    expect(card().getByText(/^Its drag is within 2 % of the accuracy check's run of the same mesh \(Cd 0\.299\)/))
      .toBeInTheDocument();
    expect(card().getByRole("img", { name: /^Drag coefficient of each case/ })).toHaveAccessibleName(
      "Drag coefficient of each case, the Mesh Doctor run against the wind tunnel: Accuracy check, coarse mesh, 0.299 "
      + "against 0.285 (+4.8 %); Your install, coarse mesh, 0.299 against 0.285 (+4.8 %).");
    expect(card().getByText(/^Cd 0\.2986 and Cl 0\.2978 over the last 500 of its 2,000 iterations, −0\.15 % from/))
      .toBeInTheDocument();
    expect(card().getByRole("link", { name: "The whole accuracy check" })).toHaveAttribute("href", "/accuracy");
    expect(card().getByRole("button", { name: "Verify install again…" })).toBeEnabled();
  });

  it("further off than 2 %: a different answer, and what may differ", async () => {
    const off = { ...MATCHING, cd: 0.312, published: { ...MATCHING.published, difference: 4.35 }, matches: false };
    const { card } = show({ runs: [run("verify-install")], validation: off });
    expect(await card().findByText("A different answer")).toBeInTheDocument();
    expect(card().getByText(/from the accuracy check's run .*, more than 2 %: something in your setup differs/))
      .toBeInTheDocument();
  });

  it("far off: the chart's axis widens to take it, by the accuracy check's steps", async () => {
    const far = { ...MATCHING, cd: 0.6213, published: { ...MATCHING.published, difference: 107.8 }, matches: false };
    const { card } = show({ runs: [run("verify-install")], validation: far });
    const chart = await card().findByRole("img", { name: /^Drag coefficient of each case/ });
    const ticks = [...chart.querySelectorAll("text")].map((t) => t.textContent).filter((t) => /^\d\.\d\d$/.test(t ?? ""));
    expect(ticks).toEqual(["0.20", "0.25", "0.30", "0.35", "0.40", "0.45", "0.50", "0.55", "0.60", "0.65"]);
  });

  it("with an engine from before it, says to update; the demo gives the command for a terminal", async () => {
    const user = userEvent.setup();
    const first = show({ noRuns: true });
    expect(await first.card().findByText(/^Your engine is older than this page and can't verify the install/))
      .toBeInTheDocument();
    expect(OLD_ENGINE_VERIFY).toContain("`git pull`");
    expect(first.card().getByRole("button", { name: "Verify install…" })).toBeDisabled();
    first.unmount();
    const second = show({ runs: [run("verify-install")] });                       // solves, but can't compare
    expect(await second.card().findByText(/^Your engine is older than this page and can't verify the install/))
      .toBeInTheDocument();
    second.unmount();
    const demo = show({ kind: "demo" });
    await user.click(await demo.card().findByRole("button", { name: "Verify install…" }));
    expect(dialog().getByRole("button", {
      name: "Copy “meshdoctor solve verify-install --template ahmed-body --size coarse --to 2000 --np 6”" }))
      .toBeInTheDocument();
    expect(dialog().queryByRole("button", { name: "Verify install" })).toBeNull();
  });
});
