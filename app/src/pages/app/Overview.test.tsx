// SPDX-License-Identifier: GPL-3.0-or-later
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_ANSWERS, demoTransport } from "@/demo/transport";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import { IDLE_POLL_MS } from "@/engine/hooks";
import { savePairing } from "@/engine/pairing";
import type { JobList, RepairList } from "@/engine/types";
import { DOCS } from "@/lib/site";
import { FIRST_RUN_SETUP } from "@/pages/install/commands";
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
 * runs never come; and with these cases and jobs, none by default: it answers with the cases as they are then);
 * `failing` lists the lists it fails to answer. */
function ownEngine(failing: string[] = [], runs: unknown[] | null = [],
  { cases = [], jobs = [] }: { cases?: string[]; jobs?: unknown[] } = {}) {
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
      if (route === "/cases") return { items: [...cases] } as T;
      if (route === "/jobs") return { items: jobs } as T;
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
  it("says how to start: Getting started gives the steps, the jobs card opens the engine's own dashboard", async () => {
    ownEngine();
    const dashboard = await screen.findByRole("link", { name: "Open the engine's dashboard" });
    expect(dashboard).toHaveAttribute("href", "http://localhost:8765/meshdoctor");
    expect(dashboard).toHaveAttribute("target", "_blank");
    expect(await screen.findByRole("region", { name: "Getting started" })).toBeInTheDocument();
    // The empty list of runs says what will show in it: Getting started, at the top, has the steps to the first.
    expect(screen.getByRole("heading", { name: "No repair runs yet" }).parentElement)
      .toHaveTextContent("Each repair shows here once its copy is made, and its verdict and report when it finishes.");
    // The empty list of jobs says a repair run in a terminal isn't a job, and shows on this page: no link to it.
    const noJobs = screen.getByRole("heading", { name: "No jobs yet" }).parentElement!;
    expect(noJobs).toHaveTextContent("A repair run in a terminal isn't a job: it shows under Repair runs on this page once its copy is made.");
    expect(within(noJobs).queryByRole("link", { name: "Overview" })).toBeNull();
    // With no case yet there is nothing to repair: no command, in the list or in a card at the bottom of the page.
    expect(screen.queryAllByRole("button", { name: /^Copy “meshdoctor full/ })).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Start a repair" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull(); // everything loaded
    expect(screen.getByText("API 1.0 · 1 job kind")).toBeInTheDocument(); // one kind of job: not "1 job kinds"
    // No cases found: the tile links the screen that says where the engine looks for them.
    expect(screen.getByRole("link", { name: "Where the engine looks" })).toHaveAttribute("href", "/app/cases");
    expect(screen.queryByText("Only ever read, never changed")).toBeNull();
    // No runs: the tile says so, rather than "0 improved, none worse".
    expect(screen.getByText("None yet")).toBeInTheDocument();
    expect(screen.queryByText(/improved/)).toBeNull();
    // No jobs at all: the Active jobs tile says so too, rather than "0 jobs on record".
    expect(within(screen.getByText("Active jobs").closest("section")!).getByText("No jobs yet")).toBeInTheDocument();
    expect(screen.queryByText(/on record/)).toBeNull();
  });

  it("without its cases, keeps the command in the empty list of runs, saying what goes in its blanks", async () => {
    ownEngine(["/cases"]);
    expect(await screen.findByRole("heading", { name: "No repair runs yet" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toBeInTheDocument(); // the cases didn't load
    // A list that didn't load isn't empty: Getting started can't say whether a case is there, so it doesn't show.
    expect(screen.queryByRole("region", { name: "Getting started" })).toBeNull();
    expect(screen.getByRole("link", { name: "your cases" })).toHaveAttribute("href", "/app/cases");
    // The command is on the page once: in the empty list, where the card at the bottom of the page gives way to it.
    expect(screen.getAllByRole("button", { name: COPY_REPAIR })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Start a repair" })).toBeNull();
    // The empty list says what goes in the command's blanks, next to it.
    expect(blanksSaid()).toHaveLength(1);
    expect(blanksSaid()[0]).toHaveTextContent(/^Repair a copy of one of your cases with this in a WSL or Linux terminal \(putting/);
    // ...and that each case has its own command on the Cases screen, which is easier.
    expect(blanksSaid()[0]).toHaveTextContent(/On the Cases screen, each case has its own, with the names filled in\.$/);
    expect(screen.getByRole("link", { name: "Cases screen" })).toHaveAttribute("href", "/app/cases");
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
    // Nor Getting started, which shows only once the engine has said it has no runs.
    expect(screen.queryByRole("region", { name: "Getting started" })).toBeNull();
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
      `From the engine's dashboard, or with this command in a WSL or Linux terminal ${BLANKS}: the run shows under Repair runs once its copy is made.`)))
      .toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "the engine's dashboard" })).toBeNull();
    // The Cases screen it points to is the demo's own.
    expect(screen.getByRole("link", { name: "Cases screen" })).toHaveAttribute("href", "/demo/cases");
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
    // ...and points to each case's own command, on the Cases screen.
    expect(within(card).getByRole("link", { name: "Cases screen" })).toHaveAttribute("href", "/app/cases");
    expect(card).toHaveTextContent("On the Cases screen, each case has its own, with the names filled in. It works on a copy");
    // With a run, the tile counts the verdicts, even when none is in yet.
    expect(screen.getByText("0 improved, none worse")).toBeInTheDocument();
    expect(screen.queryByText("None yet")).toBeNull();
  });
});

describe("the Overview's Getting started", () => {
  afterEach(() => { vi.useRealTimers(); });

  /** The three steps, in order. */
  const steps = async () => {
    const list = within(await screen.findByRole("region", { name: "Getting started" })).getAllByRole("listitem");
    expect(list).toHaveLength(3);
    return list as [HTMLElement, HTMLElement, HTMLElement];
  };
  const progress = () => screen.getByRole("region", { name: "Getting started" });
  /** A repair job, waiting its turn. */
  const queued = { schemaVersion: "1.0", id: "20261123-060000-repair-wing-fix-0001", kind: "repair",
    params: { source: "wing", name: "wing-fix" }, name: "wing-fix", state: "queued", runner: "local",
    created: "2026-11-23T06:00:00Z", log: "wing-fix.log" };

  it("with no case yet, ticks off the engine and gives the README's First run set-up to copy as the step to do next", async () => {
    ownEngine();
    const [engine, aCase, repair] = await steps();
    expect(progress()).toHaveTextContent("1 of 3 done");
    expect(within(engine).getByRole("heading", { name: "Connect to the engine" })).toBeInTheDocument();
    expect(within(engine).getByText("Done")).toBeInTheDocument();
    expect(engine).toHaveTextContent("Mesh Doctor is running on this computer, and this browser is paired with it.");
    // The step to do next says so, in words and to screen readers.
    expect(aCase).toHaveAttribute("aria-current", "step");
    expect(within(aCase).getByText("Next")).toBeInTheDocument();
    expect(aCase).toHaveTextContent("None found yet. To try Mesh Doctor on OpenFOAM's motorBike tutorial, run these in a "
      + "WSL or Linux terminal: they copy the tutorial into $FOAM_RUN, where the engine looks, and mesh it, which takes a "
      + "few minutes. The README's First run has the rest.");
    // The set-up, to copy: the README's own lines (commands.test.ts keeps them so).
    const copy = within(aCase).getByRole("button", { name: "Copy the 5 lines starting “. /opt/openfoam14/etc/bashrc”" });
    expect(copy.closest("div")!.querySelector("pre")!.textContent).toBe(FIRST_RUN_SETUP.join("\n"));
    const firstRun = within(aCase).getByRole("link", { name: "First run" });
    expect(firstRun).toHaveAttribute("href", DOCS.firstRun);
    expect(firstRun).toHaveAttribute("target", "_blank");
    expect(within(aCase).getByRole("link", { name: "Cases screen" })).toHaveAttribute("href", "/app/cases");
    // The repair waits for a case: no label, and nothing to copy yet.
    expect(repair).not.toHaveAttribute("aria-current");
    expect(repair).toHaveTextContent("Then one command repairs a copy of it, never the case itself.");
    expect(within(repair).queryByText(/^(Done|Next|Running)$/)).toBeNull();
    expect(within(progress()).getAllByRole("button")).toEqual([copy]); // the set-up's alone
  });

  it("with a case, ticks that off too and gives its repair command, with the names filled in", async () => {
    ownEngine([], [], { cases: ["motorBike"] });
    const [, aCase, repair] = await steps();
    expect(progress()).toHaveTextContent("2 of 3 done");
    expect(within(aCase).getByText("Done")).toBeInTheDocument();
    expect(within(aCase).getByRole("link", { name: "1 case" })).toHaveAttribute("href", "/app/cases");
    expect(repair).toHaveAttribute("aria-current", "step");
    expect(within(repair).getByText("Next")).toBeInTheDocument();
    expect(within(repair).getByRole("button", { name: "Copy “meshdoctor full motorBike motorBike-fix”" })).toBeInTheDocument();
    expect(repair).toHaveTextContent(
      "Run this in a WSL or Linux terminal. It repairs a copy of motorBike, never the case itself. The run shows on this page once the copy is made, and its verdict when it finishes.");
    expect(within(repair).queryByRole("link", { name: "Cases screen" })).toBeNull(); // one case: no others to point to
    // The command is on the page once: the empty list of runs doesn't give it again.
    expect(screen.getAllByRole("button", { name: /^Copy “meshdoctor full/ })).toHaveLength(1);
  });

  it("with several cases, gives the first command that needs no blanks, and points to the others' on the Cases screen", async () => {
    ownEngine([], [], { cases: ["my wing", "wing", "body"] });
    const [, aCase, repair] = await steps();
    expect(within(aCase).getByRole("link", { name: "3 cases" })).toHaveAttribute("href", "/app/cases");
    // "my wing" isn't a plain folder name, so it has no command of its own: the next case's is given.
    expect(within(repair).getByRole("button", { name: "Copy “meshdoctor full wing wing-fix”" })).toBeInTheDocument();
    expect(repair).toHaveTextContent("Each other case has its own command on the Cases screen.");
    expect(within(repair).getByRole("link", { name: "Cases screen" })).toHaveAttribute("href", "/app/cases");
  });

  it("with no case the engine finds by its name alone, gives the command with its blanks, said in words", async () => {
    ownEngine([], [], { cases: ["my wing"] });
    const [, , repair] = await steps();
    expect(within(repair).getByRole("button", { name: COPY_REPAIR })).toBeInTheDocument();
    expect(blanksSaid()).toHaveLength(1);
    expect(repair).toContainElement(blanksSaid()[0]!);
  });

  it("says a repair is under way while one waits or runs, with no command to start another", async () => {
    ownEngine([], [], { cases: ["wing"], jobs: [queued] });
    const [, , repair] = await steps();
    expect(progress()).toHaveTextContent("2 of 3 done");
    expect(within(repair).getByText("Running")).toBeInTheDocument();
    expect(repair).not.toHaveAttribute("aria-current");
    expect(repair).toHaveTextContent("A repair is under way, and shows on this page once its copy is made. Its progress is on the Jobs screen.");
    expect(within(repair).getByRole("link", { name: "Jobs screen" })).toHaveAttribute("href", "/app/jobs?show=active");
    expect(within(repair).queryAllByRole("button")).toHaveLength(0);
  });

  it("ticks off a first case by itself: while the engine has none, the app asks again every 15 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const cases: string[] = [];
    ownEngine([], [], { cases });
    await steps();
    expect(progress()).toHaveTextContent("1 of 3 done");
    cases.push("motorBike"); // the README's First run, say
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_POLL_MS); });
    await waitFor(() => expect(progress()).toHaveTextContent("2 of 3 done"));
    expect(screen.getByRole("button", { name: "Copy “meshdoctor full motorBike motorBike-fix”" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Copy the 5 lines/ })).toBeNull(); // the set-up has gone with its step
  });

  it("goes once a repair run is listed", async () => {
    ownEngine([], [{ name: "wing-fix", finished: "2026-11-21 12:05:00", nCells: 1000, profile: "medium", source: "wing", status: {}, verdict: null }],
      { cases: ["wing"] });
    expect(await screen.findByText("wing-fix")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Getting started" })).toBeNull();
  });

  it("isn't in the demo, even with no runs: its engine is a recording, with no steps of yours to tick off", async () => {
    const answers = structuredClone(DEMO_ANSWERS);
    (answers["/repairs"] as RepairList).items = [];
    open(answers);
    expect(await screen.findByRole("heading", { name: "No repair runs yet" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Getting started" })).toBeNull();
  });
});
