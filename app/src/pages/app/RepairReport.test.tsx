// SPDX-License-Identifier: GPL-3.0-or-later
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { demoTransport } from "@/demo/transport";
import { renderScreen } from "@/test/render";
import { Overview } from "./Overview";
import { RepairReport } from "./RepairReport";

const path = "/demo/repairs/:name/report";

describe("a repair's report", () => {
  it("opens in the viewer, straight from the engine", async () => {
    renderScreen(<RepairReport />, { path, at: "/demo/repairs/ahmed25-medium-fix/report", transport: demoTransport(undefined, 0) });
    // The page names the run while it waits too, so wait for the report itself.
    expect(await screen.findByText(/from the recorded demo/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "ahmed25-medium-fix" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: /Initial residual of p per iteration/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/demo");
    expect(document.title).toBe("Report of ahmed25-medium-fix · Mesh Doctor");
  });

  it("opens the recorded report of each finished repair in the demo", async () => {
    renderScreen(<RepairReport />, { path, at: "/demo/repairs/pitzdaily-fix/report", transport: demoTransport(undefined, 0) });
    expect(await screen.findByText(/from the recorded demo/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "pitzdaily-fix" })).toBeInTheDocument();
  });

  it("says when the demo has no recording of a run's report, and offers the ones it has", async () => {
    renderScreen(<RepairReport />, { path, at: "/demo/repairs/ahmed25-fine-strict/report", transport: demoTransport(undefined, 0) });
    expect(await screen.findByText("The demo has no recorded report of ahmed25-fine-strict: only its finished repairs have one"))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "pitzDaily, OpenFOAM's tutorial" }))
      .toHaveAttribute("href", "/demo/repairs/pitzdaily-fix/report");
    expect(screen.getByRole("link", { name: "25° slant, with an A/B test" }))
      .toHaveAttribute("href", "/demo/repairs/ahmed25-medium-fix/report");
    expect(screen.getByRole("link", { name: "35° slant, with a repair map" }))
      .toHaveAttribute("href", "/demo/repairs/ahmed35-medium-fix/report");
  });
});

describe("the overview", () => {
  it("links each finished repair to its report, and not one still running", async () => {
    renderScreen(<Overview />, { path: "/demo", transport: demoTransport(undefined, 0) });
    const links = await screen.findAllByRole("link", { name: /^Report of / });
    expect(links.map((a) => a.getAttribute("href"))).toContain("/demo/repairs/ahmed35-medium-fix/report");
    expect(links).toHaveLength(5);
    expect(screen.queryByRole("link", { name: "Report of ahmed25-fine-strict" })).not.toBeInTheDocument();
  });
});
