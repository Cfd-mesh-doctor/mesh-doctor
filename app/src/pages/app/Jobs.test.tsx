// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DEMO_ANSWERS, demoTransport } from "@/demo/transport";
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

  it("shows every job when the address names a filter it doesn't know", async () => {
    open(`${path}?show=nonsense`);
    expect(await screen.findAllByRole("button", { name: "ahmed25-medium-fix" })).toHaveLength(2);
    expect(within(filter()).getByRole("radio", { checked: true })).toHaveTextContent(/^All/);
    expect(rows()).toHaveLength(8);
  });
});
