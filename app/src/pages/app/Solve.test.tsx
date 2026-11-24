// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DEMO_READINESS, demoTransport } from "@/demo/transport";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import type { Readiness, ReadinessCheck } from "@/engine/types";
import { renderScreen } from "@/test/render";
import { CHECK_COMMAND, OLD_ENGINE, cellsAtMost } from "./readiness";
import { Solve } from "./Solve";

const path = "/app/solve";
const CHECKED = "2026-11-23T22:31:00Z";

/** An engine that answers GET /check with each of `answers` in turn (the last one from then on): a document, or an
 *  error it throws. `asked` counts the checks. */
function engine(...answers: (Readiness | EngineError)[]): Transport & { asked: number } {
  const t = {
    kind: "engine" as const,
    scope: "test",
    asked: 0,
    request: async <T,>(_m: string, p: string) => {
      if (p !== "/check") throw new EngineError("not-found", `no route ${p}`, 404);
      const a = answers[Math.min(t.asked++, answers.length - 1)]!;
      if (a instanceof EngineError) throw a;
      return structuredClone(a) as T;
    },
  };
  return t;
}

/** The demo's answer with these checks changed (by id), and ready again worked out as the engine does. */
function withChecks(change: Record<string, Partial<ReadinessCheck>>, drop: string[] = []): Readiness {
  const checks = DEMO_READINESS.checks.filter((c) => !drop.includes(c.id)).map((c) => ({ ...c, ...change[c.id] }));
  return { ...structuredClone(DEMO_READINESS), checks, ready: !checks.some((c) => c.state === "fail"), checked: CHECKED };
}

const section = (name: string) => within(screen.getByRole("region", { name }));

describe("the Solve screen's Ready to solve?", () => {
  it("lists what the demo engine's computer has, each section with its checks, and the meshes its memory takes", async () => {
    renderScreen(<Solve />, { path: "/demo/solve", transport: demoTransport(undefined, 0) });
    expect(screen.getByRole("heading", { name: "Solve", level: 1 })).toBeInTheDocument();
    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(screen.getByText(/What the demo engine's computer has/)).toBeInTheDocument();
    expect(section("Python").getByText("3.10.12")).toBeInTheDocument();
    expect(section("Folders").getByText("private (700)")).toBeInTheDocument();
    expect(section("OpenFOAM").getByText("OpenFOAM 14")).toBeInTheDocument();
    // The programs found share a line: eight of them, by name.
    expect(section("OpenFOAM").getByText("All 8 found")).toBeInTheDocument();
    expect(section("OpenFOAM").getByText(/^foamRun · checkMesh · .* · foamCourantCells$/)).toBeInTheDocument();
    expect(section("Memory").getByText("20.8 GB available")).toBeInTheDocument();
    expect(section("Memory").getByText(/repair a mesh of up to about 14\.1 M cells, or to solve one of up to about 15\.7 M/))
      .toBeInTheDocument();
    expect(section("Memory").getByRole("link", { name: "size estimator" })).toHaveAttribute("href", "/demo/estimate");
    expect(screen.getByText(/Checked /)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Copy/ })).toBeNull(); // nothing to fix, so no command to copy
    expect(document.title).toBe("Solve · Mesh Doctor");
  });

  it("says what's wrong, with the fix and its command, and that the programs wait for OpenFOAM", async () => {
    const t = engine(withChecks({
      openfoam: {
        state: "fail", found: "no OpenFOAM environment", command: "meshdoctor config",
        fix: "install OpenFOAM 14 from openfoam.org, or set `bashrc` in the config file to its etc/bashrc; this shows the one it reads",
      },
      cases: { state: "warn", found: "does not exist", fix: "set `cases` in the config file", command: "meshdoctor config" },
    }, DEMO_READINESS.checks.filter((c) => c.group === "programs").map((c) => c.id)));
    renderScreen(<Solve />, { path, transport: t });
    expect(await screen.findByText("1 problem to fix")).toBeInTheDocument();
    const foam = section("OpenFOAM");
    expect(foam.getByText("no OpenFOAM environment")).toBeInTheDocument();
    // The engine's fix as a sentence, its setting as code, and its command to copy.
    const fix = foam.getByText((_, el) => el?.tagName === "P" && el.textContent?.startsWith("Install OpenFOAM 14 from") === true);
    expect(within(fix).getByText("bashrc").tagName).toBe("CODE");
    expect(foam.getByRole("button", { name: "Copy “meshdoctor config”" })).toBeInTheDocument();
    expect(foam.getByText(/checked once OpenFOAM is found/)).toBeInTheDocument();
    expect(foam.queryByText(/found$/)).toBeNull();
    // A warning has its fix too, and its own state said in words.
    expect(section("Folders").getByText("does not exist")).toBeInTheDocument();
    expect(section("Folders").getAllByText("Warning:")).toHaveLength(1);
    expect(section("Folders").getAllByText("OK:")).toHaveLength(1);
  });

  it("gives a missing program a line of its own and counts the ones found", async () => {
    renderScreen(<Solve />, {
      path,
      transport: engine(withChecks({
        foamCourantCells: {
          state: "fail", found: "not built", fix: "run ./Allwmake in the repository, with OpenFOAM 14 loaded", command: "./Allwmake",
        },
      })),
    });
    expect(await screen.findByText("1 problem to fix")).toBeInTheDocument();
    const foam = section("OpenFOAM");
    expect(foam.getByText("foamCourantCells")).toBeInTheDocument();
    expect(foam.getByText("not built")).toBeInTheDocument();
    expect(foam.getByRole("button", { name: "Copy “./Allwmake”" })).toBeInTheDocument();
    expect(foam.getByText("7 of 8 found")).toBeInTheDocument();
    expect(foam.getByText(/^foamRun · .* · foamResidualHotspots$/)).toBeInTheDocument();
  });

  it("calls a check with only warnings ready, and says how many", async () => {
    renderScreen(<Solve />, {
      path,
      transport: engine(withChecks({
        numpy: { state: "warn", found: "missing", fix: "only the repair map needs it", command: "sudo apt install python3-numpy" },
      })),
    });
    expect(await screen.findByText("Ready, 1 warning")).toBeInTheDocument();
    expect(section("Python").getByText("Only the repair map needs it")).toBeInTheDocument();
  });

  it("says when the free memory is the engine's RAM limit, and leaves out the meshes when it is unknown", async () => {
    const limited = withChecks({});
    limited.memory = { ...limited.memory, limitMb: 21_300 };
    const view = renderScreen(<Solve />, { path, transport: engine(limited) });
    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(section("Memory").getByText(/the engine's RAM limit/)).toBeInTheDocument();
    expect(section("Memory").getByText("ram_limit_mb").tagName).toBe("CODE");
    view.unmount();

    const unknown = withChecks({
      memory: { state: "warn", found: "unknown (no /proc/meminfo)", fix: "the RAM guard can't check that a job fits, so it lets every job start" },
    });
    unknown.memory = { availableMb: null, limitMb: null, cells: { repair: null, solve: null } };
    renderScreen(<Solve />, { path, transport: engine(unknown) });
    expect(await screen.findByText("Ready, 1 warning")).toBeInTheDocument();
    expect(section("Memory").getByText("unknown (no /proc/meminfo)")).toBeInTheDocument();
    expect(section("Memory").queryByText(/repair a mesh of up to/)).toBeNull();
  });

  it("asks again with Check again", async () => {
    const user = userEvent.setup();
    const fixed = withChecks({});
    const t = engine(withChecks({ mpirun: { state: "fail", found: "not found", fix: "A/B tests and solves need it" } }), fixed);
    renderScreen(<Solve />, { path, transport: t });
    expect(await screen.findByText("1 problem to fix")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(t.asked).toBe(2);
  });

  it("tells an engine older than the check to update, with the same checks for a terminal", async () => {
    renderScreen(<Solve />, { path, transport: engine(new EngineError("not-found", "no such API route", 404)) });
    expect(await screen.findByText("Not checked")).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === OLD_ENGINE.replace(/`/g, "")))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Copy “${CHECK_COMMAND}”` })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  });

  it("shows another error with a way to try again", async () => {
    const user = userEvent.setup();
    const t = engine(new EngineError("internal", "internal error; details are in the server window", 500), withChecks({}));
    renderScreen(<Solve />, { path, transport: t });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Ready")).toBeInTheDocument();
  });
});

describe("the Solve screen's other parts", () => {
  it("lists what comes next on it, and the worked example until then", () => {
    renderScreen(<Solve />, { path, transport: engine(withChecks({})) });
    const next = within(screen.getByRole("heading", { name: "Coming next on this screen" }).closest("section")!);
    expect(next.getAllByRole("listitem")).toHaveLength(1);
    expect(next.getByRole("link", { name: /the Ahmed body/ })).toHaveAttribute("href", expect.stringContaining("examples/ahmed-body"));
  });

  it("makes a case from a template with New case", async () => {
    const user = userEvent.setup();
    renderScreen(<Solve />, { path: "/demo/solve", transport: demoTransport(undefined, 0) });
    const card = within(screen.getByRole("heading", { name: "New case" }).closest("section")!);
    expect(card.getByText(/^A ready-made case from a template: the Ahmed body/)).toBeInTheDocument();
    expect(card.getByText("meshdoctor new").tagName).toBe("CODE");
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(card.getByRole("button", { name: "New case" }));
    expect(await screen.findByRole("dialog", { name: "New case" })).toBeInTheDocument();
  });

  it("rounds a mesh size down, so it's never more than fits", () => {
    expect(cellsAtMost(14_191_274)).toBe("14.1 M");
    expect(cellsAtMost(15_768_082)).toBe("15.7 M");
    expect(cellsAtMost(999_999)).toBe("999 k");
    expect(cellsAtMost(5_000)).toBe("5,000");
    expect(cellsAtMost(0)).toBe("0");
  });
});
