// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { demoTransport } from "@/demo/transport";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import { savePairing } from "@/engine/pairing";
import { renderScreen } from "@/test/render";
import { Cases } from "./Cases";

const path = "/demo/cases";
/** The demo's cases: ahmed-25-coarse, -fine and -medium, ahmed-35-medium and pitzDaily. */
const open = (at: string) => renderScreen(<Cases />, { path, at, transport: demoTransport(undefined, 0) });
/** The table's rows, without its head. */
const rows = () => screen.getAllByRole("row").slice(1);

describe("the Cases screen", () => {
  it("keeps what's typed in its filter box in the address, so a reload or a link keeps it", async () => {
    const { router } = open(`${path}?q=pitz`);
    expect(await screen.findByText("1 of 5 cases")).toBeInTheDocument();
    const box = screen.getByRole("searchbox", { name: "Filter cases" });
    expect(box).toHaveValue("pitz");
    expect(rows()).toHaveLength(1);

    await userEvent.clear(box);
    expect(router.state.location.search).toBe("");
    expect(rows()).toHaveLength(5);

    await userEvent.type(box, "ahmed-25");
    expect(router.state.location.search).toBe("?q=ahmed-25");
    expect(screen.getByText("3 of 5 cases")).toBeInTheDocument();
    expect(rows()).toHaveLength(3);
  });

  it("puts the cursor in its filter box on “/”, as the site's search boxes do", async () => {
    const user = userEvent.setup();
    open(path);
    expect(await screen.findByText("5 of 5 cases")).toBeInTheDocument();
    const box = screen.getByRole("searchbox", { name: "Filter cases" });
    expect(box).toHaveAttribute("aria-keyshortcuts", "/");
    await user.keyboard("/");
    expect(box).toHaveFocus();
    expect(box).toHaveValue("");
  });
});

/** Opens the Cases screen of your own engine, paired, with these cases, or whose cases don't load (null); and with
 * these repair runs (none by default), runs that never come (null), or runs that don't load ("broken"). */
function ownEngine(cases: string[] | null, at = "/app/cases", runs: unknown[] | null | "broken" = []) {
  savePairing({ engine: "http://localhost:8765", key: "TestKey_0123456789abcdefghijklmnopqrstuvwxy", paired: "2026-11-22T12:00:00Z" });
  const asked: string[] = [];
  const transport: Transport = {
    kind: "engine",
    scope: "test",
    request: async <T,>(_method: string, path: string) => {
      const route = path.split("?")[0]!;
      asked.push(route);
      if (route === "/repairs" && runs === null) return new Promise<T>(() => {});
      if (route === "/repairs" && runs !== "broken") return { items: runs } as T;
      if (route === "/cases" && cases) return { items: cases } as T;
      throw new EngineError("internal", "internal error; details are in the server window", 500);
    },
  };
  return { ...renderScreen(<Cases />, { path: "/app/cases", at, transport }), asked };
}
/** A finished repair run of a case, with no verdict. */
const run = (name: string, source: string) =>
  ({ name, finished: "2026-11-21 12:05:00", nCells: 1000, profile: "openfoam", source, status: {}, verdict: null });
/** The table row of the case with this name. */
const caseRow = (name: string) => rows().find((r) => within(r).queryByText(name, { exact: true }))!;
const COPY = /^Copy repair command/;

describe("the Cases screen of your own engine", () => {
  it("with no cases, says where the engine looks and how to point it at another folder", async () => {
    ownEngine([]);
    expect(await screen.findByRole("heading", { name: "No cases found" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy “MESHDOCTOR_CASES=~/cases meshdoctor serve”" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("whose cases didn't load says so under the message that says why, not that nothing matches the filter", async () => {
    ownEngine(null, "/app/cases?q=wing");
    expect(await screen.findByRole("heading", { name: "The cases didn't load" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The engine hit an error");
    expect(screen.queryByRole("heading", { name: "No case matches" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "No cases found" })).toBeNull();
  });

  it("counts one case as “1 of 1 case”, and none shown of it as “0 of 1 case”", async () => {
    ownEngine(["wing"]);
    expect(await screen.findByText("1 of 1 case")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox", { name: "Filter cases" }), "pitz");
    expect(screen.getByText("0 of 1 case")).toBeInTheDocument();
  });

  it("gives each case its own repair command, naming the copy with a name no run has yet", async () => {
    ownEngine(["wing", "pitz", "my case"], undefined, [run("wing-fix", "wing"), run("pitz-fix-2", "pitz")]);
    // wing-fix is taken (the repair would replace it), pitz-fix isn't
    expect(await screen.findByRole("button", { name: "Copy repair command: meshdoctor full wing wing-fix-2" }))
      .toBeInTheDocument();
    expect(within(caseRow("wing")).getAllByRole("button", { name: COPY })).toHaveLength(1);
    expect(within(caseRow("pitz")).getByRole("button", { name: "Copy repair command: meshdoctor full pitz pitz-fix" }))
      .toBeInTheDocument();
    // The engine finds a case by its name only when that is a plain folder name: none for this one.
    expect(within(caseRow("my case")).queryByRole("button", { name: COPY })).toBeNull();
  });

  it("copies the command, then says it did", async () => {
    const user = userEvent.setup(); // its clipboard stands in for the browser's
    ownEngine(["wing"]);
    const button = await screen.findByRole("button", { name: "Copy repair command: meshdoctor full wing wing-fix" });
    await user.click(button);
    expect(await navigator.clipboard.readText()).toBe("meshdoctor full wing wing-fix");
    expect(await screen.findByRole("button", { name: "Copied" })).toBe(button);
  });

  it("offers no command until the runs are known, as the copy's name must be one no run has", async () => {
    ownEngine(["wing"], undefined, null); // the runs never come
    expect(await screen.findByText("1 of 1 case")).toBeInTheDocument();
    expect(screen.getAllByText("…").length).toBeGreaterThan(0); // still loading
    expect(screen.queryByRole("button", { name: COPY })).toBeNull();
  });

  it("offers no command when the runs didn't load", async () => {
    ownEngine(["wing"], undefined, "broken");
    expect(await screen.findByText("1 of 1 case")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("…")).toBeNull()); // the runs have answered
    expect(screen.queryByRole("button", { name: COPY })).toBeNull();
  });

  it("says when the repair runs didn't load, and why, rather than that no case was repaired", async () => {
    const { asked } = ownEngine(["wing"], undefined, "broken");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The engine hit an error"); // why, at the top
    expect(screen.getByText("· repair runs didn't load")).toBeInTheDocument(); // and what, next to the count
    expect(screen.getByText("1 of 1 case")).toBeInTheDocument();
    // Unknown, not none: neither "Not repaired yet" (phones) nor "none" (the Repair runs column).
    expect(screen.queryByText("Not repaired yet")).toBeNull();
    expect(screen.queryByText("none")).toBeNull();
    expect(within(caseRow("wing")).getAllByRole("cell")[1]).toHaveTextContent(/^–$/);
    // Try again asks again for the runs alone: the cases loaded.
    const count = (route: string) => asked.filter((r) => r === route).length;
    const [cases, runs] = [count("/cases"), count("/repairs")];
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(count("/repairs")).toBe(runs + 1));
    expect(count("/cases")).toBe(cases);
  });

  it("says nothing failed when the runs load, and counts them", async () => {
    ownEngine(["wing"], undefined, [run("wing-fix", "wing")]);
    expect(await screen.findByText(/^1 run · /)).toBeInTheDocument();
    expect(within(caseRow("wing")).getAllByRole("cell")[1]).toHaveTextContent(/^1$/);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/didn't load/)).toBeNull();
  });

  it("says “No verdict”, in words, for a latest run with none, where a case never repaired keeps its dash", async () => {
    ownEngine(["wing", "cyl"], undefined, [run("wing-fix", "wing")]);
    expect(await screen.findByText("No verdict")).toBeInTheDocument();
    expect(within(caseRow("wing")).getAllByRole("cell")[2]).toHaveTextContent(/^No verdict$/);
    expect(within(caseRow("wing")).queryByRole("link", { name: "Report of wing-fix" })).toBeNull(); // nothing to report
    expect(within(caseRow("cyl")).getAllByRole("cell")[2]).toHaveTextContent(/^–$/);
  });

  it("says how to repair a case: its command, or the engine's dashboard, linked in a new tab", async () => {
    ownEngine(["wing"]);
    expect(await screen.findByText(/To repair one, copy its repair command and run it in WSL, or start it from/))
      .toHaveTextContent(/start it from the engine's dashboard: the run shows up here when it finishes\.$/);
    const dashboard = screen.getByRole("link", { name: "the engine's dashboard" });
    expect(dashboard).toHaveAttribute("href", "http://localhost:8765/meshdoctor");
    expect(dashboard).toHaveAttribute("target", "_blank");
  });
});

describe("the demo's Cases screen", () => {
  it("gives each case its command too, and names the dashboard without linking it", async () => {
    open(path);
    // The demo's runs are named ahmed25-medium-fix, pitzdaily-fix and so on: other names than these.
    expect(await screen.findByRole("button", { name: "Copy repair command: meshdoctor full pitzDaily pitzDaily-fix" }))
      .toBeInTheDocument();
    expect(within(caseRow("ahmed-25-medium")).getByRole("button", { name: COPY }))
      .toHaveAccessibleName("Copy repair command: meshdoctor full ahmed-25-medium ahmed-25-medium-fix");
    expect(screen.getAllByRole("button", { name: COPY })).toHaveLength(5);
    expect(screen.getByText(/or start it from the engine's dashboard: the run shows up here/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "the engine's dashboard" })).toBeNull();
  });
});
