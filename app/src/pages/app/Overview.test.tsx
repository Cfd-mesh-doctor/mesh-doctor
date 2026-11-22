// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DEMO_ANSWERS, demoTransport } from "@/demo/transport";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import { savePairing } from "@/engine/pairing";
import type { JobList } from "@/engine/types";
import { renderScreen } from "@/test/render";
import { Overview } from "./Overview";

/** Opens the Overview on the demo's engine: eight jobs, one of them running, unless told otherwise. */
const open = (answers = DEMO_ANSWERS) => renderScreen(<Overview />, { path: "/demo", transport: demoTransport(answers, 0) });

/** The demo's answers with its running job finished, so none runs. */
function noneRunning() {
  const answers = structuredClone(DEMO_ANSWERS);
  for (const job of (answers["/jobs"] as JobList).items) if (job.state === "running") job.state = "done";
  return answers;
}

describe("the Overview's active-jobs tile", () => {
  it("links the active job while one runs", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(await screen.findByText("Active jobs")).toBeInTheDocument(); // running or waiting: not "Jobs running"
    expect(await screen.findByRole("link", { name: "Show the active job" })).toHaveAttribute("href", "/demo/jobs?show=active");
    expect(screen.queryByText(/jobs on record/)).toBeNull(); // the link has the hint's one line to itself
  });

  it("counts the jobs on record while none runs", async () => {
    open(noneRunning());
    expect(await screen.findByText("8 jobs on record")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Show the active/ })).toBeNull();
  });

  it("says “1 job on record” for one", async () => {
    const answers = noneRunning();
    const list = answers["/jobs"] as JobList;
    list.items = list.items.slice(0, 1);
    open(answers);
    expect(await screen.findByText("1 job on record")).toBeInTheDocument();
  });
});

describe("the Overview's recent jobs", () => {
  it("link each job's details on the Jobs screen", async () => {
    open();
    expect(await screen.findByRole("link", { name: "ahmed25-fine-strict" }))
      .toHaveAttribute("href", "/demo/jobs?job=20261121-130141-repair-ahmed25-fine-strict-0266");
  });
});

/** Opens the Overview of your own engine, paired, before anything has run on it (or with these repair runs; null: the
 * runs never come); `failing` lists the lists it fails to answer. */
function ownEngine(failing: string[] = [], runs: unknown[] | null = []) {
  savePairing({ engine: "http://localhost:8765", key: "TestKey_0123456789abcdefghijklmnopqrstuvwxy", paired: "2026-11-22T12:00:00Z" });
  const asked: string[] = [];
  const transport: Transport = {
    kind: "engine",
    scope: "test",
    request: async <T,>(_method: string, path: string) => {
      const route = path.split("?")[0]!;
      asked.push(route);
      if (failing.includes(route)) throw new EngineError("unreachable", "nothing answered");
      if (route === "/") return { apiVersion: "1.0", version: "0.1.0", jobKinds: ["repair"] } as T;
      if (route === "/repairs") return runs ? ({ items: runs } as T) : new Promise<T>(() => {});
      if (route === "/jobs" || route === "/cases") return { items: [] } as T;
      throw new EngineError("not-found", `no route ${route}`, 404);
    },
  };
  return { ...renderScreen(<Overview />, { path: "/app", transport }), asked };
}
const COPY_REPAIR = "Copy “meshdoctor full <case> <name>”";
/** What the command's blanks stand for, said wherever the command is (<name> could be read as your own name). */
const BLANKS = "(putting a case's name in place of <case>, and a name for the repaired copy in place of <name>)";
/** The innermost elements that say what the blanks stand for. */
const saysBlanks = (el: Element | null): boolean => (el?.textContent ?? "").includes(BLANKS);
const blanksSaid = () => screen.queryAllByText((_, el) => saysBlanks(el) && !Array.from(el!.children).some(saysBlanks));

describe("the Overview before anything has run", () => {
  it("says how to start: the jobs card opens the engine's own dashboard, the repair runs card gives the command", async () => {
    ownEngine();
    const dashboard = await screen.findByRole("link", { name: "Open the engine's dashboard" });
    expect(dashboard).toHaveAttribute("href", "http://localhost:8765/meshdoctor");
    expect(dashboard).toHaveAttribute("target", "_blank");
    expect(await screen.findByRole("heading", { name: "No repair runs yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "your cases" })).toHaveAttribute("href", "/app/cases");
    // The command is on the page once: in the empty list, where the card at the bottom of the page gives way to it.
    expect(screen.getAllByRole("button", { name: COPY_REPAIR })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Start a repair" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull(); // everything loaded
    expect(screen.getByText("API 1.0 · 1 job kind")).toBeInTheDocument(); // one kind of job: not "1 job kinds"
    // No cases found: the tile links the screen that says where the engine looks for them.
    expect(screen.getByRole("link", { name: "Where the engine looks" })).toHaveAttribute("href", "/app/cases");
    expect(screen.queryByText("Only ever read, never changed")).toBeNull();
    // No runs: the tile says so, rather than "0 improved, none worse".
    expect(screen.getByText("None yet")).toBeInTheDocument();
    expect(screen.queryByText(/improved/)).toBeNull();
    // The empty list says what goes in the command's blanks, next to it.
    expect(blanksSaid()).toHaveLength(1);
    expect(blanksSaid()[0]).toHaveTextContent(/^Repair a copy of one of your cases with this in WSL \(putting/);
    // No jobs at all: the Active jobs tile says so too, rather than "0 jobs on record".
    expect(within(screen.getByText("Active jobs").closest("section")!).getByText("No jobs yet")).toBeInTheDocument();
    expect(screen.queryByText(/on record/)).toBeNull();
  });

  it("doesn't call a list that didn't load empty, or offer first steps for it", async () => {
    ownEngine(["/jobs", "/repairs"]);
    expect(await screen.findByRole("heading", { name: "The jobs didn't load" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "The repair runs didn't load" })).toBeInTheDocument();
    expect(screen.queryByText(/^No (jobs|repair runs) yet$/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Open the engine's dashboard" })).toBeNull();
    // The command stays in its card at the bottom of the page.
    expect(screen.getByRole("heading", { name: "Start a repair" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: COPY_REPAIR })).toHaveLength(1);
  });

  it("says why at the top when only a list didn't load, and Try again asks again for that list alone", async () => {
    const { asked } = ownEngine(["/jobs"]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The engine isn't answering");
    expect(await screen.findByRole("heading", { name: "The jobs didn't load" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "No repair runs yet" })).toBeInTheDocument(); // that one loaded
    const count = (route: string) => asked.filter((r) => r === route).length;
    const [jobs, repairs] = [count("/jobs"), count("/repairs")];
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(count("/jobs")).toBe(jobs + 1));
    expect(count("/repairs")).toBe(repairs);
  });

  it("waits for the repair runs before showing the Start a repair card, so an engine with none doesn't flash it", async () => {
    ownEngine([], null);
    expect(await screen.findByRole("heading", { name: "No jobs yet" })).toBeInTheDocument(); // the jobs have loaded
    expect(await screen.findByText("API 1.0 · 1 job kind")).toBeInTheDocument(); // and the engine's own answer
    // While the runs load, neither the card nor the empty list's command shows: one of them will, once they're known.
    expect(screen.queryByRole("heading", { name: "Start a repair" })).toBeNull();
    expect(screen.queryAllByRole("button", { name: COPY_REPAIR })).toHaveLength(0);
  });

  it("says “No verdict”, in words, for a run with no verdict and no step under way", async () => {
    ownEngine([], [{ name: "wing-fix", finished: "2026-11-21 12:05:00", nCells: 1000, profile: "medium", source: "wing", status: {}, verdict: null }]);
    const run = (await screen.findByText("wing-fix")).closest("li")!;
    expect(within(run).getByText("No verdict")).toBeInTheDocument();
    expect(within(run).queryByText("–")).toBeNull(); // not a bare dash
    expect(within(run).queryByRole("link", { name: "Report of wing-fix" })).toBeNull(); // nothing to report
  });

  it("keeps the command in its card at the bottom once there are repair runs", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "Start a repair" })).toBeInTheDocument();
    expect((await screen.findAllByRole("link", { name: /^Report of / })).length).toBeGreaterThan(0);
    expect(screen.getByText("Only ever read, never changed")).toBeInTheDocument(); // the demo has cases
    expect(screen.queryByRole("link", { name: "Where the engine looks" })).toBeNull();
    expect(screen.getAllByRole("button", { name: COPY_REPAIR })).toHaveLength(1);
    // The demo has no engine of its own: the card names the dashboard without linking it.
    expect(screen.getByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").startsWith(
      `From the engine's dashboard, or with this command in WSL ${BLANKS}: the run shows up here`))).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "the engine's dashboard" })).toBeNull();
  });
});

describe("the Overview once something has run", () => {
  it("says how to start a repair: from the engine's dashboard, linked in a new tab, or with the command", async () => {
    ownEngine([], [{ name: "wing-fix", finished: "2026-11-21 12:05:00", nCells: 1000, profile: "medium", source: "wing", status: {}, verdict: null }]);
    expect(await screen.findByText("wing-fix")).toBeInTheDocument();
    // Once the empty lists that first offer it have gone, this card keeps the engine's dashboard linked.
    const card = screen.getByRole("heading", { name: "Start a repair" }).closest("div")!;
    const dashboard = within(card).getByRole("link", { name: "the engine's dashboard" });
    expect(dashboard).toHaveAttribute("href", "http://localhost:8765/meshdoctor");
    expect(dashboard).toHaveAttribute("target", "_blank");
    expect(dashboard).toHaveAttribute("rel", "noreferrer");
    expect(screen.getAllByRole("button", { name: COPY_REPAIR })).toHaveLength(1);
    // The card says what goes in the command's blanks.
    expect(blanksSaid()).toHaveLength(1);
    expect(card).toContainElement(blanksSaid()[0]!);
    // With a run, the tile counts the verdicts, even when none is in yet.
    expect(screen.getByText("0 improved, none worse")).toBeInTheDocument();
    expect(screen.queryByText("None yet")).toBeNull();
  });
});
