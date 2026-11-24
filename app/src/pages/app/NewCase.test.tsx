// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DEMO_TEMPLATES, demoTransport } from "@/demo/transport";
import type { Transport } from "@/engine/client";
import { EngineError, explain } from "@/engine/errors";
import type { Job, MachineInfo } from "@/engine/types";
import { savePairing } from "@/engine/pairing";
import { renderScreen } from "@/test/render";
import { OLD_ENGINE_CASES, caseStep, checkCaseName, newCaseCommand, suggestName, takenCaseNames } from "./caseStart";
import { Solve } from "./Solve";

const [AHMED, WHEEL] = DEMO_TEMPLATES.items as [typeof DEMO_TEMPLATES.items[0], typeof DEMO_TEMPLATES.items[0]];
const job = (name: string, state: Job["state"], kind: Job["kind"] = "case") =>
  ({ id: `20261123-120000-${kind}-${name}-ab12`, kind, name, state, params: {} }) as Job;
const MACHINE: MachineInfo = { cpus: 8, cores: 4, memoryMb: 16_000, ramLimitMb: null };

describe("a new case's name and command", () => {
  it("is the template's first word and the size, or the template's name when it has one size, then -2, -3…", () => {
    expect(suggestName(AHMED, "coarse", new Set())).toBe("ahmed-coarse");
    expect(suggestName(AHMED, "coarse", new Set(["ahmed-coarse", "ahmed-coarse-2"]))).toBe("ahmed-coarse-3");
    expect(suggestName(WHEEL, "medium", new Set(["wing"]))).toBe("wheel-wing");
  });

  it("can't be a case's, or that of a new case being made; one that stopped is made again", () => {
    const jobs = [job("a1", "running"), job("a2", "failed"), job("a3", "cancelled"), job("a4", "done"), job("r", "failed", "repair")];
    expect([...takenCaseNames(["wing"], jobs)].sort()).toEqual(["a1", "a2", "a3", "a4", "wing"]); // a repair's isn't a case
    expect(checkCaseName("wing", ["wing"], jobs).problem).toMatch(/A case with this name exists already/);
    expect(checkCaseName("a1", [], jobs).problem).toMatch(/is being made now/);
    expect(checkCaseName("a2", [], jobs)).toEqual({ problem: null, again: jobs[1] });
    expect(checkCaseName("a3", [], jobs).again).toBe(jobs[2]);
    expect(checkCaseName("a4", [], jobs)).toEqual({ problem: null, again: null }); // gone from Cases: the engine decides
    expect(checkCaseName("", [], jobs).problem).toMatch(/Give the new case a name/);
    for (const bad of ["my case", ".x", "a/b"]) expect(checkCaseName(bad, [], jobs).problem, bad).toMatch(/Use only letters/);
  });

  it("is meshdoctor new in a terminal, with the size when it isn't the template's own", () => {
    expect(newCaseCommand(AHMED, "medium", "ahmed")).toBe("meshdoctor new ahmed-body ahmed");
    expect(newCaseCommand(AHMED, "fine", "ahmed")).toBe("meshdoctor new ahmed-body ahmed --size fine");
  });

  it("is made in steps the Jobs screen says in plain words", () => {
    expect(caseStep("snappyHexMesh: adding layers")).toBe("Adding layers at the walls (snappyHexMesh)");
    expect(caseStep("geometry")).toBe("Making the geometry");
    expect(caseStep("something new")).toBe("something new");
    expect(caseStep(null)).toBeNull();
  });

  it("that's taken is explained in plain words", () => {
    const e = new EngineError("exists", "a case named wing exists already; pick another name (a case you made is never changed)", 409);
    expect(explain(e)).toMatchObject({ title: "A case with that name already exists" });
  });
});

/** Your own engine, paired: its templates (none: older than API 1.5), cases, jobs and a 16 GB computer. */
/** The cells of the Ahmed body's meshes, for what GET /disk/case says each takes (API 1.12). */
const CELLS: Record<string, number> = { coarse: 480_000, medium: 836_000, fine: 1_570_000 };

function ownEngine({ jobs = [], templates = true, refuse, disk }: {
  jobs?: Job[]; templates?: boolean; refuse?: EngineError;
  /** the MB free GET /disk/case says (API 1.12): nothing, as an older engine, unless given */
  disk?: number;
} = {}) {
  savePairing({ engine: "http://localhost:8765", key: "TestKey_0123456789abcdefghijklmnopqrstuvwxy", paired: "2026-11-22T12:00:00Z" });
  const posted: unknown[] = [];
  const asked: string[] = [];
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
      if (route === "/templates" && templates) return structuredClone(DEMO_TEMPLATES) as T;
      if (route === "/cases") return { items: ["wing", "ahmed-medium"], cells: { wing: 12_225, "ahmed-medium": 836_000 } } as T;
      if (route === "/jobs") return { items: jobs } as T;
      if (route === "/machine") return MACHINE as T;
      if (route === "/disk/case" && disk != null) {     // its mesh and the sets beside it, as the engine counts them
        asked.push(path);
        const cells = CELLS[new URLSearchParams(path.split("?")[1]).get("size") ?? "medium"] ?? 0;
        return { needMb: Math.ceil(cells * 0.14 / 1024 * 1.03), freeMb: disk, keepMb: 1024, folder: "cases" } as T;
      }
      throw new EngineError("not-found", "no such API route", 404);
    },
  };
  return { ...renderScreen(<Solve />, { path: "/app/solve", transport }), posted, asked };
}

const dialog = () => within(screen.getByRole("dialog"));
const nameBox = () => dialog().getByRole("textbox", { name: "Name of the new case" });
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "New case" }));
  await dialog().findByRole("combobox", { name: "Template" });
}

describe("New case on the Solve screen", () => {
  it("suggests a name from the template and its size, says what the mesh needs, then makes it and opens its job", async () => {
    const user = userEvent.setup();
    const { posted, router } = ownEngine();
    await openDialog(user);
    expect(dialog().getByRole("heading", { name: "New case" })).toBeInTheDocument();
    expect(dialog().getByRole("combobox", { name: "Template" })).toHaveValue("ahmed-body");
    expect(dialog().getByText(/^The standard test shape for car aerodynamics/)).toBeInTheDocument();
    expect(dialog().getByRole("radio", { name: "Medium" })).toBeChecked();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "About 836,000 cells: the accuracy check's mesh, with drag within 2 % of the wind tunnel's.");
    expect(nameBox()).toHaveValue("ahmed-medium-2");                     // ahmed-medium is a case already
    expect(screen.getByRole("dialog")).toHaveTextContent("Its mesh needs about 1.8 GB of memory; your engine's computer has 15.6 GB.");

    await user.click(dialog().getByRole("radio", { name: "Coarse" }));
    expect(dialog().getByRole("radio", { name: "Coarse" })).toBeChecked();
    expect(dialog().getByRole("radio", { name: "Medium" })).not.toBeChecked();
    expect(nameBox()).toHaveValue("ahmed-coarse");
    expect(screen.getByRole("dialog")).toHaveTextContent("About 480,000 cells: for a quick look");
    await user.click(dialog().getByRole("button", { name: "Make case" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/jobs"));
    expect(posted).toEqual([{ kind: "case", params: { template: "ahmed-body", size: "coarse", name: "ahmed-coarse", replace: false } }]);
    expect(router.state.location.search).toBe(`?job=${encodeURIComponent(job("ahmed-coarse", "queued").id)}`);
  });

  it("gives the wheel and wing its one mesh, and the template's name", async () => {
    const user = userEvent.setup();
    ownEngine();
    await openDialog(user);
    await user.selectOptions(dialog().getByRole("combobox", { name: "Template" }), "wheel-wing");
    expect(dialog().queryByRole("radiogroup", { name: "Mesh" })).toBeNull();
    expect(screen.getByRole("dialog")).toHaveTextContent("About 920,000 cells: the template's tested mesh.");
    expect(nameBox()).toHaveValue("wheel-wing");
  });

  it("won't take a case's name, and makes again a new case that failed, replacing what it left", async () => {
    const user = userEvent.setup();
    const { posted } = ownEngine({ jobs: [job("ahmed-coarse", "failed")] });
    await openDialog(user);
    await user.click(dialog().getByRole("radio", { name: "Coarse" }));
    expect(nameBox()).toHaveValue("ahmed-coarse-2");                    // the failed one's name isn't suggested
    await user.clear(nameBox());
    await user.type(nameBox(), "wing");
    expect(nameBox()).toHaveAccessibleDescription("A case with this name exists already. Pick another name.");
    expect(dialog().getByRole("button", { name: "Make case" })).toBeDisabled();
    await user.clear(nameBox());
    await user.type(nameBox(), "ahmed-coarse");
    expect(nameBox()).toHaveAccessibleDescription(
      "A new case with this name failed before its mesh was made. Making it again deletes what it left first.");
    await user.click(dialog().getByRole("button", { name: "Make it again" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ kind: "case", params: { name: "ahmed-coarse", size: "coarse", replace: true } });
  });

  it("shows what the engine refuses in plain words, and stays open", async () => {
    const user = userEvent.setup();
    ownEngine({ refuse: new EngineError("exists", "a case named ahmed-medium-2 exists already; pick another name (a case you made is never changed)", 409) });
    await openDialog(user);
    await user.click(dialog().getByRole("button", { name: "Make case" }));
    expect(await dialog().findByText("A case with that name already exists")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("tells an engine older than templates to update", async () => {
    const user = userEvent.setup();
    ownEngine({ templates: false });
    await user.click(screen.getByRole("button", { name: "New case" }));
    expect(await dialog().findByText((_, el) => el?.tagName === "P" && el.textContent === OLD_ENGINE_CASES.replace(/`/g, "")))
      .toBeInTheDocument();
    expect(dialog().getByText("git pull").tagName).toBe("CODE");
    expect(dialog().getAllByRole("button", { name: "Close" })).toHaveLength(2);    // the corner's and the footer's
    expect(dialog().queryByRole("button", { name: "Make case" })).toBeNull();
  });

  it("in the demo, gives the command that makes the same case in a terminal", async () => {
    const user = userEvent.setup();
    renderScreen(<Solve />, { path: "/demo/solve", transport: demoTransport(undefined, 0) });
    await openDialog(user);
    await user.click(dialog().getByRole("radio", { name: "Fine" }));
    const name = (nameBox() as HTMLInputElement).value;
    expect(name).toBe("ahmed-fine");
    expect(dialog().getByRole("button", { name: `Copy “meshdoctor new ahmed-body ${name} --size fine”` })).toBeInTheDocument();
    expect(dialog().queryByRole("button", { name: "Make case" })).toBeNull();
  });
});

describe("what a new case takes on the disk", () => {
  it("says what its mesh and the sets beside it take on the disk the cases are on, for the size picked", async () => {
    const user = userEvent.setup();
    const { asked } = ownEngine({ disk: 1100 });
    await openDialog(user);
    // The medium mesh: 118 MB, more than 1.1 GB free can give with the 1 GB the engine keeps.
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("Its mesh needs about 118 MB of disk space, more "
      + "than the disk the cases are on can give: it has 1.1 GB free, and the engine keeps 1.0 GB of that for everything "
      + "else. Delete runs or results you no longer need: the engine refuses a case that won't fit."));
    expect(asked).toContain("/disk/case?template=ahmed-body&size=medium");
    await user.click(dialog().getByRole("radio", { name: "Coarse" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent(
      "Its mesh needs about 68 MB of disk space; the disk the cases are on has 1.1 GB free."));
    expect(dialog().getByRole("button", { name: "Make case" })).toBeEnabled();
  });
});
