// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { demoTransport } from "@/demo/transport";
import type { Transport } from "@/engine/client";
import { fullCommand, repairCommand, repairName } from "@/engine/commands";
import { EngineError } from "@/engine/errors";
import type { Job, MachineInfo, RepairSummary } from "@/engine/types";
import { savePairing } from "@/engine/pairing";
import { renderScreen } from "@/test/render";
import { Cases } from "./Cases";
import { Repairs } from "./Repairs";
import { caseCells, nameProblem, repairMemory, takenNames } from "./repairStart";

const run = (name: string, source: string, nCells: number | null = 1000, finished = "2026-11-21 12:05:00"): RepairSummary =>
  ({ name, finished, nCells, profile: "openfoam", source, status: {}, verdict: null });
const job = (name: string, state: Job["state"], kind: Job["kind"] = "repair") =>
  ({ id: `20261123-120000-${kind}-${name}-ab12`, kind, name, state, params: {} }) as Job;
const MACHINE: MachineInfo = { cpus: 8, cores: 4, memoryMb: 16_000, ramLimitMb: null };

describe("a new repair run's name and command", () => {
  it("is the case's name with -fix, else the first -fix-N no run has", () => {
    expect(repairName("wing", [])).toBe("wing-fix");
    expect(repairName("wing", ["wing-fix", "wing-fix-2"])).toBe("wing-fix-3");
    expect(repairName("my case", [])).toBeNull();
  });

  it("asks for the strict limits only when they are picked", () => {
    expect(fullCommand("wing", "wing-fix")).toBe("meshdoctor full wing wing-fix");
    expect(fullCommand("wing", "wing-fix", "strict")).toBe("meshdoctor full wing wing-fix --profile strict");
    expect(repairCommand("wing", ["wing-fix"], "strict")).toBe("meshdoctor full wing wing-fix-2 --profile strict");
  });

  it("can't be a name a run or a repair job has, or one the engine refuses", () => {
    const taken = takenNames([run("wing-fix", "/cases/wing")], [job("wing-fix-2", "running"), job("ab", "done", "abtest")]);
    expect([...taken].sort()).toEqual(["wing-fix", "wing-fix-2"]); // an A/B test's name isn't a run of its own
    expect(nameProblem("wing-fix", taken)).toMatch(/exists already/);
    expect(nameProblem("", taken)).toMatch(/Give the new run a name/);
    for (const bad of ["my run", ".hidden", "-x", "a/b", "c".repeat(81)]) expect(nameProblem(bad, taken), bad).toMatch(/Use only letters/);
    expect(nameProblem("wing-fix-3", taken)).toBeNull();
  });
});

describe("the repair dialog's memory check", () => {
  it("uses the engine's count of a case's cells, else its newest repair's", () => {
    const runs = [run("a", "/c/wing", 900, "2026-11-20 10:00:00"), run("b", "/c/wing", 1200, "2026-11-21 10:00:00")];
    expect(caseCells("wing", { wing: 5000 }, runs)).toBe(5000);
    expect(caseCells("wing", { wing: null }, runs)).toBe(1200);
    expect(caseCells("cyl", undefined, runs)).toBeNull();
  });

  it("works the need out as the size estimator does, against the RAM limit when the engine has a lower one", () => {
    // 2 M cells: 1.5 GB per million and half a gigabyte, so 3.5 GB of the 15.6 GB.
    expect(repairMemory(2e6, MACHINE)).toEqual({ need: 3.5, have: 15.6, limited: false, fits: true });
    expect(repairMemory(2e6, { ...MACHINE, ramLimitMb: 3_072 })).toEqual({ need: 3.5, have: 3, limited: true, fits: false });
    expect(repairMemory(null, MACHINE)).toBeNull();
    expect(repairMemory(2e6, undefined)).toBeNull();
    expect(repairMemory(2e6, { ...MACHINE, memoryMb: null })).toBeNull();
  });
});

/** Your own engine, paired: these cases and runs, a 16 GB computer, these jobs, and what POST /jobs answers. */
function ownEngine({ runs = [], jobs = [], refuse, screen: ui = <Cases /> }: {
  runs?: RepairSummary[];
  jobs?: Job[];
  refuse?: EngineError;
  screen?: ReactElement;
} = {}) {
  savePairing({ engine: "http://localhost:8765", key: "TestKey_0123456789abcdefghijklmnopqrstuvwxy", paired: "2026-11-22T12:00:00Z" });
  const posted: unknown[] = [];
  const transport: Transport = {
    kind: "engine",
    scope: "test",
    request: async <T,>(method: string, path: string, body?: unknown) => {
      const route = path.split("?")[0]!;
      if (method === "POST" && route === "/jobs") {
        posted.push(body);
        if (refuse) throw refuse;
        const p = (body as { params: { name: string } }).params;
        return { ...job(p.name, "queued"), params: p } as T;
      }
      if (route === "/cases") return { items: ["wing", "my case"], cells: { wing: 12_225, "my case": null } } as T;
      if (route === "/repairs") return { items: runs } as T;
      if (route === "/jobs") return { items: jobs } as T;
      if (route === "/machine") return MACHINE as T;
      throw new EngineError("not-found", "no such route", 404);
    },
  };
  const at = ui.type === Repairs ? "/app/repairs" : "/app/cases";
  return { ...renderScreen(ui, { path: at, transport }), posted };
}

const dialog = () => screen.getByRole("dialog");
const startButton = () => within(dialog()).getByRole("button", { name: "Start repair" });

describe("starting a repair from the Cases screen", () => {
  it("names the run, says what the limits do and that it fits, then starts the job and opens it on Jobs", async () => {
    const user = userEvent.setup();
    const { posted, router } = ownEngine({ runs: [run("wing-fix", "/cases/wing")] });
    await user.click(await screen.findByRole("button", { name: "Repair wing" }));
    expect(within(dialog()).getByRole("heading", { name: "Repair wing" })).toBeInTheDocument();
    expect(within(dialog()).getByRole("combobox", { name: "Case" })).toHaveValue("wing");
    expect(within(dialog()).getByText("12,225 cells")).toBeInTheDocument();
    // wing-fix is taken: the next free name.
    expect(within(dialog()).getByRole("textbox", { name: "Name of the new run" })).toHaveValue("wing-fix-2");
    expect(dialog()).toHaveTextContent("OpenFOAM's usual limits: non-orthogonality up to 65°");
    expect(dialog()).toHaveTextContent("Needs about 0.5 GB of memory; your engine's computer has 15.6 GB.");

    await user.click(within(dialog()).getByRole("radio", { name: "Strict" }));
    expect(dialog()).toHaveTextContent("Tighter limits: non-orthogonality up to 60°");
    await user.click(startButton());
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/jobs"));
    expect(posted).toEqual([{ kind: "repair", params: { source: "wing", name: "wing-fix-2", profile: "strict" } }]);
    expect(router.state.location.search).toBe(`?job=${encodeURIComponent(job("wing-fix-2", "queued").id)}`);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("won't start a run with a name that's taken or that the engine refuses, and says why", async () => {
    const user = userEvent.setup();
    const { posted } = ownEngine({ runs: [run("wing-fix", "/cases/wing")] });
    await user.click(await screen.findByRole("button", { name: "Repair wing" }));
    const box = within(dialog()).getByRole("textbox", { name: "Name of the new run" });
    await user.clear(box);
    await user.type(box, "wing-fix");
    expect(box).toHaveAccessibleDescription("A run with this name exists already. Pick another name.");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(startButton()).toBeDisabled();
    await user.clear(box);
    await user.type(box, "wing fix");
    expect(box).toHaveValue("wingfix"); // spaces never go in
    expect(startButton()).toBeEnabled();
    expect(posted).toEqual([]);
  });

  it("waits while another job runs, as the engine runs one big job at a time", async () => {
    const user = userEvent.setup();
    ownEngine({ jobs: [job("cyl-fix", "running")] });
    await user.click(await screen.findByRole("button", { name: "Repair wing" }));
    expect(await within(dialog()).findByText(/Repair cyl-fix is running\. The engine runs one big job at a time/)).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });

  it("shows the engine's reason when it refuses the job, and stays open", async () => {
    const user = userEvent.setup();
    const why = "not enough memory: repair of 12,225 cells needs about 0.5 GB; 0.2 GB free. Close other programs.";
    ownEngine({ refuse: new EngineError("not-enough-memory", why, 409) });
    await user.click(await screen.findByRole("button", { name: "Repair wing" }));
    await user.click(startButton());
    expect(await within(dialog()).findByText("Not enough free memory")).toBeInTheDocument();
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("It needs about 0.5 GB, and 0.2 GB is free.");
    expect(startButton()).toBeEnabled(); // try again once memory is free
  });
});

describe("starting a repair from the Repairs screen", () => {
  it("offers the first case the engine can repair, and says when one can't be repaired from here", async () => {
    const user = userEvent.setup();
    ownEngine({ screen: <Repairs /> });
    await user.click(await screen.findByRole("button", { name: "New repair" }));
    expect(within(dialog()).getByRole("heading", { name: "Start a repair" })).toBeInTheDocument();
    const pick = within(dialog()).getByRole("combobox", { name: "Case" });
    expect(pick).toHaveValue("wing");
    await user.selectOptions(pick, "my case");
    expect(dialog()).toHaveTextContent("The engine can't repair this case from here");
    expect(within(dialog()).queryByRole("textbox", { name: "Name of the new run" })).toBeNull();
    expect(startButton()).toBeDisabled();
    await user.selectOptions(pick, "wing");
    expect(within(dialog()).getByRole("textbox", { name: "Name of the new run" })).toHaveValue("wing-fix");
  });

  it("starts one from the empty list too", async () => {
    const user = userEvent.setup();
    ownEngine({ screen: <Repairs /> });
    await user.click(await screen.findByRole("button", { name: "Start a repair" }));
    expect(within(dialog()).getByRole("heading", { name: "Start a repair" })).toBeInTheDocument();
  });
});

describe("the demo's repair dialog", () => {
  it("says the demo can't start jobs and gives the command that does the same, with the limits picked", async () => {
    const user = userEvent.setup();
    renderScreen(<Cases />, { path: "/demo/cases", transport: demoTransport(undefined, 0) });
    await user.click(await screen.findByRole("button", { name: "Repair pitzDaily" }));
    expect(dialog()).toHaveTextContent("The demo can't start jobs.");
    expect(dialog()).toHaveTextContent("Needs about 0.5 GB of memory; the demo engine's computer has");
    expect(within(dialog()).getByText("meshdoctor full pitzDaily pitzDaily-fix")).toBeInTheDocument();
    await user.click(within(dialog()).getByRole("radio", { name: "Strict" }));
    expect(within(dialog()).getByText("meshdoctor full pitzDaily pitzDaily-fix --profile strict")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Start repair" })).toBeNull();
    // The dialog's own Close, not the corner's X (also called Close).
    await user.click(within(dialog()).getAllByRole("button", { name: "Close" })[0]!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
