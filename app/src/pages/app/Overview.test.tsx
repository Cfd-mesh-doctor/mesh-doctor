// SPDX-License-Identifier: GPL-3.0-or-later
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEMO_ANSWERS, demoTransport } from "@/demo/transport";
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

describe("the Overview's running-jobs tile", () => {
  it("links the running job while one runs", async () => {
    open();
    expect(await screen.findByRole("link", { name: "Show the running job" })).toHaveAttribute("href", "/demo/jobs?show=active");
    expect(screen.queryByText(/jobs on record/)).toBeNull(); // the link has the hint's one line to itself
  });

  it("counts the jobs on record while none runs", async () => {
    open(noneRunning());
    expect(await screen.findByText("8 jobs on record")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Show the running/ })).toBeNull();
  });
});

describe("the Overview's recent jobs", () => {
  it("link each job's details on the Jobs screen", async () => {
    open();
    expect(await screen.findByRole("link", { name: "ahmed25-fine-strict" }))
      .toHaveAttribute("href", "/demo/jobs?job=20261121-130141-repair-ahmed25-fine-strict-0266");
  });
});
