// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DEMO_ANSWERS, demoTransport } from "@/demo/transport";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import type { Job, RepairSummary } from "@/engine/types";
import { renderScreen } from "@/test/render";
import { Repairs } from "./Repairs";
import { jobOf, runGroup, runLink } from "./runs";

const path = "/demo/repairs";
/** The demo's six runs: three unchanged, one improved, one that made a number worse, and one cancelled. */
const open = (at = path) => renderScreen(<Repairs />, { path, at, transport: demoTransport(undefined, 0) });
const filter = () => screen.getByRole("radiogroup", { name: "Show repair runs" });
/** The table's rows, without its head. */
const rows = () => screen.getAllByRole("row").slice(1);

const run = (verdict: RepairSummary["verdict"]): RepairSummary => ({ name: "r", status: {}, verdict });

describe("a repair run's group", () => {
  it("is its verdict's, and a run that made any number worse is worse, whatever else it improved", () => {
    expect(runGroup(run({ improved: ["maxSkewness"], regressions: [], unchanged: [] }))).toBe("improved");
    expect(runGroup(run({ improved: [], regressions: [], unchanged: ["maxSkewness"] }))).toBe("unchanged");
    expect(runGroup(run({ improved: ["maxSkewness"], regressions: ["minVolRatio"], unchanged: [] }))).toBe("worse");
    expect(runGroup(run(null))).toBe("unfinished");
  });
});

describe("where a repair run leads", () => {
  const job = (state: Job["state"]) => ({ id: "j1", kind: "repair", name: "r", state }) as Job;

  it("is its report once it has a verdict, else its job: Progress while it runs, Details once it stopped", () => {
    expect(runLink(run({ improved: [], regressions: [], unchanged: [] }), job("done"))).toEqual({ path: "/repairs/r/report", label: "Report" });
    expect(runLink(run(null), job("running"))).toEqual({ path: "/jobs?job=j1", label: "Progress" });
    expect(runLink(run(null), job("failed"))).toEqual({ path: "/jobs?job=j1", label: "Details" });
    expect(runLink(run(null), undefined)).toBeNull(); // made in a terminal and not finished: nowhere to go
  });

  it("takes the run's newest repair job, and never an A/B test of the same name", () => {
    const jobs = [
      { id: "ab", kind: "abtest", name: "r", state: "running" },
      { id: "new", kind: "repair", name: "r", state: "done" },
      { id: "old", kind: "repair", name: "r", state: "failed" },
    ] as Job[];
    expect(jobOf(jobs, "r")?.id).toBe("new");
    expect(jobOf(jobs, "other")).toBeUndefined();
  });
});

describe("the Repairs screen", () => {
  it("lists every run with its case and verdict, each named link going to its report", async () => {
    open();
    const report = await screen.findByRole("link", { name: "ahmed35-medium-fix" });
    expect(report).toHaveAttribute("href", "/demo/repairs/ahmed35-medium-fix/report");
    expect(rows()).toHaveLength(6);
    const row = report.closest("tr")!;
    expect(row).toHaveTextContent("ahmed-35-medium"); // its case
    expect(within(row).getByText("Improved 4")).toBeInTheDocument();
    expect(within(row).getByText("Strict")).toBeInTheDocument(); // the limits its checkMesh used
    expect(within(row).getByRole("link", { name: "Report of ahmed35-medium-fix" })).toHaveAttribute("href", "/demo/repairs/ahmed35-medium-fix/report");
    await waitFor(() => expect(document.title).toBe("Repairs · Mesh Doctor"));
  });

  it("says what the job of a run without a verdict did, and links its details", async () => {
    open();
    const stopped = await screen.findByRole("link", { name: "ahmed25-fine-strict" }); // the demo's cancelled repair
    const details = "/demo/jobs?job=20261121-130141-repair-ahmed25-fine-strict-0266";
    expect(stopped).toHaveAttribute("href", details);
    const row = stopped.closest("tr")!;
    expect(within(row).getByText("Cancelled")).toBeInTheDocument();
    expect(row).toHaveTextContent("checkMesh (before)"); // its last step, as it has no case to name yet
    expect(within(row).getByRole("link", { name: "Details of ahmed25-fine-strict" })).toHaveAttribute("href", details);
  });

  it("keeps its filter in the address, so a reload or a link keeps it", async () => {
    const { router } = open(`${path}?show=worse`);
    expect(await screen.findByRole("link", { name: "pitzdaily-fix" })).toBeInTheDocument();
    expect(within(filter()).getByRole("radio", { checked: true })).toHaveTextContent(/^Worse/);
    expect(rows()).toHaveLength(1);
    expect(within(filter()).getByRole("radio", { name: /^Unchanged/ })).toHaveTextContent("Unchanged3");

    await userEvent.click(within(filter()).getByRole("radio", { name: /^Improved/ }));
    expect(router.state.location.search).toBe("?show=improved");
    expect(rows()).toHaveLength(1);

    await userEvent.click(within(filter()).getByRole("radio", { name: /^Not finished/ }));
    expect(rows()).toHaveLength(1);

    await userEvent.click(within(filter()).getByRole("radio", { name: /^All/ }));
    expect(router.state.location.search).toBe("");
    expect(rows()).toHaveLength(6);
  });

  it("shows every run for a filter it doesn't know", async () => {
    open(`${path}?show=everything`);
    expect(await screen.findByRole("link", { name: "pitzdaily-fix" })).toBeInTheDocument();
    expect(rows()).toHaveLength(6);
  });
});

/** An engine of your own whose /repairs answer is given (null: it doesn't answer). */
function ownEngine(repairs: RepairSummary[] | null) {
  const transport: Transport = {
    kind: "engine",
    scope: "test",
    request: async <T,>(_method: string, route: string) => {
      const at = route.split("?")[0];
      if (at === "/repairs" && repairs) return { items: repairs } as T;
      if (at === "/jobs") return { items: [] } as T;
      throw new EngineError("unreachable", "nothing answered");
    },
  };
  return renderScreen(<Repairs />, { path: "/app/repairs", transport });
}

describe("the Repairs screen before any run", () => {
  it("says where a repair starts, with a way to the cases", async () => {
    ownEngine([]);
    expect(await screen.findByRole("heading", { name: "No repair runs yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to your cases" })).toHaveAttribute("href", "/app/cases");
  });

  it("doesn't call a list that didn't load empty", async () => {
    ownEngine(null);
    expect(await screen.findByRole("heading", { name: "The repair runs didn't load" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No repair runs yet" })).toBeNull();
  });
});

it("the demo's recorded runs are the ones the screen counts", () => {
  expect((DEMO_ANSWERS["/repairs"] as { items: unknown[] }).items).toHaveLength(6);
});
