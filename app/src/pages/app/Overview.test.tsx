// SPDX-License-Identifier: GPL-3.0-or-later
import { screen } from "@testing-library/react";
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
});

describe("the Overview's recent jobs", () => {
  it("link each job's details on the Jobs screen", async () => {
    open();
    expect(await screen.findByRole("link", { name: "ahmed25-fine-strict" }))
      .toHaveAttribute("href", "/demo/jobs?job=20261121-130141-repair-ahmed25-fine-strict-0266");
  });
});

/** Opens the Overview of your own engine, paired, before anything has run on it; `failing` lists the lists it fails
 * to answer. */
function ownEngine(failing: string[] = []) {
  savePairing({ engine: "http://localhost:8765", key: "TestKey_0123456789abcdefghijklmnopqrstuvwxy", paired: "2026-11-22T12:00:00Z" });
  const transport: Transport = {
    kind: "engine",
    scope: "test",
    request: async <T,>(_method: string, path: string) => {
      const route = path.split("?")[0]!;
      if (failing.includes(route)) throw new EngineError("unreachable", "nothing answered");
      if (route === "/") return { apiVersion: "1.0", version: "0.1.0", jobKinds: ["repair"] } as T;
      if (route === "/jobs" || route === "/repairs" || route === "/cases") return { items: [] } as T;
      throw new EngineError("not-found", `no route ${route}`, 404);
    },
  };
  return renderScreen(<Overview />, { path: "/app", transport });
}
const COPY_REPAIR = "Copy “meshdoctor full <case> <name>”";

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
    expect(screen.queryByText("Starting repairs from the app comes next")).toBeNull();
  });

  it("doesn't call a list that didn't load empty, or offer first steps for it", async () => {
    ownEngine(["/jobs", "/repairs"]);
    expect(await screen.findByRole("heading", { name: "The jobs didn't load" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "The repair runs didn't load" })).toBeInTheDocument();
    expect(screen.queryByText(/^No (jobs|repair runs) yet$/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Open the engine's dashboard" })).toBeNull();
    // The command stays in its card at the bottom of the page.
    expect(screen.getByText("Starting repairs from the app comes next")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: COPY_REPAIR })).toHaveLength(1);
  });

  it("keeps the command in its card at the bottom once there are repair runs", async () => {
    open();
    expect(await screen.findByText("Starting repairs from the app comes next")).toBeInTheDocument();
    expect((await screen.findAllByRole("link", { name: /^Report of / })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: COPY_REPAIR })).toHaveLength(1);
  });
});
