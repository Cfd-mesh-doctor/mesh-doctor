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
import { Jobs } from "./Jobs";

const path = "/demo/jobs";
/** The demo's jobs: one running, six done and one cancelled. */
const open = (at: string) => renderScreen(<Jobs />, { path, at, transport: demoTransport(undefined, 0) });
const filter = () => screen.getByRole("radiogroup", { name: "Show jobs" });
/** The table's rows, without its head. */
const rows = () => screen.getAllByRole("row").slice(1);

describe("the Jobs screen", () => {
  it("keeps its filter in the address, so a reload or a link keeps it", async () => {
    const { router } = open(`${path}?show=cancelled`);
    expect(await screen.findByRole("button", { name: "ahmed25-fine-strict" })).toBeInTheDocument();
    expect(within(filter()).getByRole("radio", { checked: true })).toHaveTextContent(/^Cancelled/);
    expect(rows()).toHaveLength(1);

    await userEvent.click(within(filter()).getByRole("radio", { name: /^Done/ }));
    expect(router.state.location.search).toBe("?show=done");
    expect(rows()).toHaveLength(6);

    await userEvent.click(within(filter()).getByRole("radio", { name: /^All/ }));
    expect(router.state.location.search).toBe("");
    expect(rows()).toHaveLength(8);
  });

  it("keeps the open job's details in the address too, so a reload or a link opens them", async () => {
    const strict = "20261121-130141-repair-ahmed25-fine-strict-0266"; // the demo's cancelled job
    const { router } = open(`${path}?show=cancelled&job=${strict}`);
    expect(await screen.findByRole("dialog", { name: "ahmed25-fine-strict" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("ahmed25-fine-strict · Jobs · Mesh Doctor")); // the tab names the job

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(router.state.location.search).toBe("?show=cancelled"); // closing keeps the filter
    await waitFor(() => expect(document.title).toBe("Jobs · Mesh Doctor"));

    await userEvent.click(screen.getByRole("button", { name: "ahmed25-fine-strict" }));
    expect(router.state.location.search).toBe(`?show=cancelled&job=${strict}`);
    expect(screen.getByRole("dialog", { name: "ahmed25-fine-strict" })).toBeInTheDocument();
  });

  it("opens nothing when the address names a job that isn't on record", async () => {
    open(`${path}?job=no-such-job`);
    expect(await screen.findByRole("button", { name: "ahmed25-fine-strict" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says plainly when no job is running or waiting, as after the Overview's link once the job is over", async () => {
    const answers = structuredClone(DEMO_ANSWERS);
    for (const job of (answers["/jobs"] as JobList).items) if (job.state === "running") job.state = "done";
    renderScreen(<Jobs />, { path, at: `${path}?show=active`, transport: demoTransport(answers, 0) });
    expect(await screen.findByRole("heading", { name: "No job is running or waiting" })).toBeInTheDocument();
  });

  it("says to pick another filter when one has nothing in it (the demo has no failed job)", async () => {
    open(`${path}?show=failed`);
    expect(await screen.findByRole("heading", { name: "No jobs in this view" })).toBeInTheDocument();
    expect(screen.getByText("Pick another filter to see the rest.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open the engine's dashboard" })).toBeNull();
  });

  it("shows no start time for a queued job, which hasn't started", async () => {
    const answers = structuredClone(DEMO_ANSWERS);
    for (const job of (answers["/jobs"] as JobList).items) {
      if (job.state === "running") Object.assign(job, { state: "queued", started: null, progress: null });
    }
    renderScreen(<Jobs />, { path, transport: demoTransport(answers, 0) });
    await screen.findAllByRole("button", { name: "ahmed25-medium-fix" });
    const queued = rows().find((r) => r.textContent?.includes("Queued"))!;
    expect(queued).toBeDefined();
    expect(within(queued).queryByText(/ago$|just now/)).toBeNull();
  });

  it("says how long a queued job has waited, not how long it has run", async () => {
    const answers = structuredClone(DEMO_ANSWERS);
    for (const job of (answers["/jobs"] as JobList).items) {
      if (job.state === "running") Object.assign(job, { state: "queued", started: null, progress: null });
    }
    renderScreen(<Jobs />, { path, at: `${path}?job=20261121-130610-abtest-ahmed25-medium-fix-13c2`, transport: demoTransport(answers, 0) });
    const details = await screen.findByRole("dialog", { name: "ahmed25-medium-fix" });
    expect(within(details).getByText("Waiting for")).toBeInTheDocument();
    expect(within(details).queryByText("Running for")).toBeNull();
  });

  it("opens an active job's details on Close, not on the red Cancel job", async () => {
    open(`${path}?job=20261121-130610-abtest-ahmed25-medium-fix-13c2`); // the demo's running job
    const details = await screen.findByRole("dialog", { name: "ahmed25-medium-fix" });
    const [close] = within(details).getAllByRole("button", { name: "Close" }); // the footer's, before the corner's
    await waitFor(() => expect(close).toHaveFocus());
    expect(within(details).getByRole("button", { name: /Cancel job/ })).not.toHaveFocus();
  });

  it("hands the focus back to the job's name when its details close, even when they opened from the address", async () => {
    open(`${path}?job=20261121-130141-repair-ahmed25-fine-strict-0266`); // the demo's cancelled job
    await screen.findByRole("dialog", { name: "ahmed25-fine-strict" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: "ahmed25-fine-strict" })).toHaveFocus());
  });

  it("leaves the focus in the cancel confirmation that replaces an active job's details, then hands it to the job's name", async () => {
    open(`${path}?job=20261121-130610-abtest-ahmed25-medium-fix-13c2`); // the demo's running job
    const details = await screen.findByRole("dialog", { name: "ahmed25-medium-fix" });
    await userEvent.click(within(details).getByRole("button", { name: /Cancel job/ }));
    const confirm = await screen.findByRole("dialog", { name: "Cancel ahmed25-medium-fix?" });
    const keep = within(confirm).getByRole("button", { name: "Keep running" });
    await waitFor(() => expect(keep).toHaveFocus());
    await new Promise((r) => setTimeout(r, 50)); // the details hand the focus back a moment after they close
    expect(keep).toHaveFocus();

    await userEvent.click(keep); // the details' Cancel job that asked has gone with them
    await waitFor(() => {
      const running = rows().find((r) => r.textContent?.includes("Running"));
      expect(within(running!).getByRole("button", { name: "ahmed25-medium-fix" })).toHaveFocus();
    });
  });

  it("hands the focus back to the row's Cancel button when its confirmation is dismissed", async () => {
    open(path);
    await screen.findAllByRole("button", { name: "ahmed25-medium-fix" });
    const running = rows().find((r) => r.textContent?.includes("Running"))!;
    const ask = within(running).getByRole("button", { name: "Cancel" });
    await userEvent.click(ask);
    const confirm = await screen.findByRole("dialog", { name: "Cancel ahmed25-medium-fix?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Keep running" }));
    await waitFor(() => expect(ask).toHaveFocus());
  });

  it("hands the focus to the job's name once the job is cancelled, as its Cancel button has gone", async () => {
    open(path);
    await screen.findAllByRole("button", { name: "ahmed25-medium-fix" });
    const running = rows().find((r) => r.textContent?.includes("Running"))!;
    const name = within(running).getByRole("button", { name: "ahmed25-medium-fix" });
    await userEvent.click(within(running).getByRole("button", { name: "Cancel" }));
    const confirm = await screen.findByRole("dialog", { name: "Cancel ahmed25-medium-fix?" });
    await userEvent.click(within(confirm).getByRole("button", { name: /Cancel job/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(name).toHaveFocus());
    expect(within(running).queryByRole("button", { name: "Cancel" })).toBeNull(); // the button that asked has gone
  });

  it("heads the jobs' times Duration, not Took, as a running job's time is so far", async () => {
    open(path);
    await screen.findAllByRole("button", { name: "ahmed25-medium-fix" });
    expect(screen.getByRole("columnheader", { name: "Duration" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Took" })).toBeNull();
  });

  it("words the step of a test of solver settings by its settings, a continuation's too, from the test's job", async () => {
    const answers = structuredClone(DEMO_ANSWERS);
    const items = (answers["/jobs"] as JobList).items;
    const running = items.find((j) => j.state === "running")!; // the demo's running A/B job
    items.unshift(
      { ...running, id: "20261123-120000-abextend-wing_lts-0001", kind: "abextend", name: "wing_lts", params: { name: "wing_lts", to: 400 },
        progress: { step: "extending fixed 200 -> 400", fraction: 0.5, updated: null } },
      { ...running, id: "20261123-110000-abtest-wing_lts-0002", kind: "abtest", name: "wing_lts", state: "done",
        params: { name: "wing-fix", iters: 200, init: "auto", variant: "lts" }, progress: null },
    );
    renderScreen(<Jobs />, { path, at: path, transport: demoTransport(answers, 0) });
    expect(await screen.findAllByText("Continuing the run with lts settings from iteration 200 to 400")).not.toHaveLength(0);
    expect(screen.getAllByText("Solving on the repaired mesh")).not.toHaveLength(0); // the demo's own test is of a repair
  });

  it("links an A/B job to its test's page, to follow it while it runs, and a finished repair to its report", async () => {
    open(path);
    const follow = await screen.findByRole("link", { name: "Follow the A/B test of ahmed25-medium-fix" });
    expect(follow).toHaveAttribute("href", "/demo/abtests/ahmed25-medium-fix");
    expect(follow.parentElement).toContainElement(screen.getByRole("button", { name: "Cancel" })); // the running test's row still cancels it
    expect(screen.getByRole("link", { name: "Open the A/B test of ahmed25-coarse-fix" })).toHaveAttribute("href", "/demo/abtests/ahmed25-coarse-fix");
    // The repairs of the same names have their reports, as before.
    expect(screen.getByRole("link", { name: "Report of ahmed25-coarse-fix" })).toHaveAttribute("href", "/demo/repairs/ahmed25-coarse-fix/report");
    expect(screen.queryByRole("link", { name: /^Report of ahmed25-fine-strict/ })).toBeNull(); // cancelled: no report
  });

  it("opens an A/B job's test page from its details, running or not, where a repair's details open its report", async () => {
    for (const [id, name] of [["20261121-130610-abtest-ahmed25-medium-fix-13c2", "ahmed25-medium-fix"], ["20261121-130250-abtest-ahmed25-coarse-fix-13d0", "ahmed25-coarse-fix"]]) {
      const { unmount } = open(`${path}?job=${id}`);
      const details = await screen.findByRole("dialog", { name: name! });
      expect(within(details).getByRole("link", { name: "Open A/B test" })).toHaveAttribute("href", `/demo/abtests/${name}`);
      expect(within(details).queryByRole("link", { name: "Open report" })).toBeNull();
      unmount();
    }
    open(`${path}?job=20261121-130031-repair-ahmed25-fine-fix-0fa7`);
    const details = await screen.findByRole("dialog", { name: "ahmed25-fine-fix" });
    expect(within(details).getByRole("link", { name: "Open report" })).toHaveAttribute("href", "/demo/repairs/ahmed25-fine-fix/report");
  });

  it("shows every job when the address names a filter it doesn't know", async () => {
    open(`${path}?show=nonsense`);
    expect(await screen.findAllByRole("button", { name: "ahmed25-medium-fix" })).toHaveLength(2);
    expect(within(filter()).getByRole("radio", { checked: true })).toHaveTextContent(/^All/);
    expect(rows()).toHaveLength(8);
  });
});

/** Opens the Jobs screen of your own engine, paired, before any job has run on it (or with these jobs); null: its jobs
 * don't load. */
function ownEngine(jobs: unknown[] | null = []) {
  savePairing({ engine: "http://localhost:8765", key: "TestKey_0123456789abcdefghijklmnopqrstuvwxy", paired: "2026-11-22T12:00:00Z" });
  const transport: Transport = {
    kind: "engine",
    scope: "test",
    request: async <T,>(_method: string, route: string) => {
      if (route.split("?")[0] === "/jobs" && jobs) return { items: jobs } as T;
      throw new EngineError("unreachable", "nothing answered");
    },
  };
  return renderScreen(<Jobs />, { path: "/app/jobs", transport });
}

describe("the Jobs screen before any job has run", () => {
  it("says where jobs start, and opens the engine's own dashboard in a new tab", async () => {
    ownEngine();
    expect(await screen.findByRole("heading", { name: "No jobs yet" })).toBeInTheDocument();
    expect(screen.getByText(/^Repairs started with a case's Repair button, and A\/B tests started from a finished repair, show here while they run, with their progress, as do those started from the engine's own dashboard\./))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to your cases" })).toHaveAttribute("href", "/app/cases");
    // A repair run in a terminal (as Getting started says to) isn't a job: the list says where it shows instead.
    const empty = screen.getByRole("heading", { name: "No jobs yet" }).parentElement!;
    expect(empty).toHaveTextContent("A repair run in a terminal isn't a job: it shows under Repair runs on the Overview once its copy is made.");
    expect(within(empty).getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/app");
    const dashboard = screen.getByRole("link", { name: "Open the engine's dashboard" });
    expect(dashboard).toHaveAttribute("href", "http://localhost:8765/meshdoctor");
    expect(dashboard).toHaveAttribute("target", "_blank");
    expect(dashboard).toHaveAttribute("rel", "noreferrer");
  });

  it("doesn't call a list that didn't load empty: the message above says why", async () => {
    ownEngine(null);
    expect(await screen.findByRole("heading", { name: "The jobs didn't load" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No jobs yet" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open the engine's dashboard" })).toBeNull();
  });
});

describe("the Jobs screen once jobs have run", () => {
  it("still says where they start: its description links the engine's dashboard, in a new tab", async () => {
    ownEngine((DEMO_ANSWERS["/jobs"] as JobList).items.filter((j) => j.state === "done").slice(0, 1));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.queryByRole("heading", { name: "No jobs yet" })).toBeNull(); // nor its button
    const dashboard = screen.getByRole("link", { name: "the engine's dashboard" });
    expect(dashboard).toHaveAttribute("href", "http://localhost:8765/meshdoctor");
    expect(dashboard).toHaveAttribute("target", "_blank");
    expect(dashboard).toHaveAttribute("rel", "noreferrer");
  });

  it("names the dashboard without linking it in the demo, which has no engine of its own", async () => {
    open(path);
    // The description, with the Overview's link in it.
    expect(await screen.findByText((_, el) => el?.tagName === "P" && /started here or from the engine's dashboard\. Repairs start from the Cases and Repairs screens, A\/B tests from the A\/B tests screen and a finished repair's report; a repair run in a terminal shows on the Overview instead\. Only one big job runs at a time/.test(el.textContent ?? ""))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/demo"); // the demo's own
    expect(screen.queryByRole("link", { name: "the engine's dashboard" })).toBeNull();
  });
});
