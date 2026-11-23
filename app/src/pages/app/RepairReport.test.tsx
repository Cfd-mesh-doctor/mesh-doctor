// SPDX-License-Identifier: GPL-3.0-or-later
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { demoTransport } from "@/demo/transport";
import type { Transport } from "@/engine/client";
import { checkReport } from "@/report/read";
import { catchDownloads } from "@/test/downloads";
import { renderScreen } from "@/test/render";
import { Overview } from "./Overview";
import { RepairReport } from "./RepairReport";

const path = "/demo/repairs/:name/report";

describe("a repair's report", () => {
  it("opens in the viewer, straight from the engine", async () => {
    renderScreen(<RepairReport />, { path, at: "/demo/repairs/ahmed25-coarse-fix/report", transport: demoTransport(undefined, 0) });
    // The page names the run while it waits too, so wait for the report itself.
    expect(await screen.findByText(/from the recorded demo/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "ahmed25-coarse-fix" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: /Initial residual of p per iteration/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/demo");
    expect(document.title).toBe("Report of ahmed25-coarse-fix · Mesh Doctor");
  });

  it("leaves out an A/B test that the demo's job list still has running", async () => {
    renderScreen(<RepairReport />, { path, at: "/demo/repairs/ahmed25-medium-fix/report", transport: demoTransport(undefined, 0) });
    expect(await screen.findByText(/There is no solver A\/B test in this report\./)).toBeInTheDocument();
    expect(screen.queryByText("Did it help the solver?")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Initial residual of/ })).not.toBeInTheDocument();
  });

  it("saves the report as the file meshdoctor report makes", async () => {
    const downloads = catchDownloads();
    try {
      renderScreen(<RepairReport />, { path, at: "/demo/repairs/pitzdaily-fix/report", transport: demoTransport(undefined, 0) });
      await userEvent.click(await screen.findByRole("button", { name: "Save report" }));
      expect(downloads.saved.map((f) => f.name)).toEqual(["pitzdaily-fix.mdreport.json"]);
      const doc = checkReport(JSON.parse(await downloads.saved[0]!.text()));
      expect(doc.name).toBe("pitzdaily-fix");
    } finally {
      downloads.restore();
    }
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
    expect(screen.getByRole("link", { name: "25° slant, coarse mesh, with an A/B test" }))
      .toHaveAttribute("href", "/demo/repairs/ahmed25-coarse-fix/report");
    // its A/B test is still running in the demo's job list, so the demo's report of it has none to show
    expect(screen.getByRole("link", { name: "25° slant, medium mesh" }))
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

/** Opens a run's report on your own engine: the demo's recorded answers, as an engine of your own would give them. */
function ownEngine(name: string) {
  const transport: Transport = { ...demoTransport(undefined, 0), kind: "engine" };
  return renderScreen(<RepairReport />, { path: "/app/repairs/:name/report", at: `/app/repairs/${name}/report`, transport });
}

describe("a repair's report on your own engine", () => {
  it("offers the A/B test's command, with the names filled in, for a run that has none", async () => {
    ownEngine("ahmed25-medium-fix");
    expect(await screen.findByText(/from your engine/)).toBeInTheDocument();
    expect(screen.getByText("Did it help the solver?")).toBeInTheDocument();
    expect(screen.getByText("Not tested yet")).toBeInTheDocument();
    expect(screen.getByText(/Run it in a WSL or Linux terminal: its result shows up in this report\.$/)).toBeInTheDocument();
    // The source case by its folder's name, which the engine finds in the cases folder, then the run.
    expect(screen.getByRole("button", { name: "Copy “meshdoctor ab ahmed-25-medium ahmed25-medium-fix”" })).toBeInTheDocument();
  });

  it("doesn't offer it for a run that has an A/B test: the test's result is there instead", async () => {
    ownEngine("ahmed25-coarse-fix");
    expect(await screen.findByRole("img", { name: /Initial residual of p per iteration/ })).toBeInTheDocument();
    expect(screen.getByText("Did it help the solver?")).toBeInTheDocument();
    expect(screen.queryByText("Not tested yet")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Copy “meshdoctor ab / })).toBeNull();
  });
});
