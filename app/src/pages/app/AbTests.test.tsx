// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { demoTransport } from "@/demo/transport";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import { renderScreen } from "@/test/render";
import { AbTest } from "./AbTest";
import { AbTests } from "./AbTests";

const demo = () => demoTransport(undefined, 0);
/** The table's rows, without its head. */
const rows = () => screen.getAllByRole("row").slice(1);

/** An engine with these A/B tests and jobs, and nothing else. */
function engine(abtests: unknown, jobs: unknown[] = []): Transport {
  return {
    kind: "engine",
    scope: "test",
    async request<T>(_m: string, path: string): Promise<T> {
      if (path === "/abtests") return structuredClone(abtests) as T;
      if (path.startsWith("/jobs")) return { items: jobs } as T;
      if (path === "/repairs") return { items: [] } as T;
      throw new EngineError("not-found", "not here", 404);
    },
  };
}

describe("the A/B tests list", () => {
  it("shows the test that runs first, at its step, then the finished one with its outcome", async () => {
    renderScreen(<AbTests />, { path: "/demo/abtests", transport: demo() });
    expect(await screen.findByRole("link", { name: "ahmed25-medium-fix" })).toHaveAttribute("href", "/demo/abtests/ahmed25-medium-fix");
    const [going, done] = rows();
    expect(within(going!).getByText("Running")).toBeInTheDocument();
    expect(within(going!).getByText(/Solving on the repaired mesh/)).toBeInTheDocument();
    expect(within(going!).getByRole("link", { name: "Follow the A/B test of ahmed25-medium-fix" })).toBeInTheDocument();
    expect(within(done!).getByText("Finished")).toBeInTheDocument();
    expect(within(done!).getByText("about the same")).toBeInTheDocument();
    expect(within(done!).getByRole("link", { name: "Open the A/B test of ahmed25-coarse-fix" })).toBeInTheDocument();
    expect(document.title).toBe("A/B tests · Mesh Doctor");
  });

  it("says where a first test starts when there is none", async () => {
    renderScreen(<AbTests />, { path: "/app/abtests", transport: engine({ items: [], tests: {} }) });
    expect(await screen.findByRole("heading", { name: "No A/B tests yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go to your repairs/ })).toHaveAttribute("href", "/app/repairs");
  });

  it("names the tests of an engine older than API 1.3, with their jobs' states", async () => {
    const job = { id: "j1", kind: "abtest", name: "wing-fix", state: "failed", params: {}, created: "2026-11-23T10:00:00Z" };
    renderScreen(<AbTests />, { path: "/app/abtests", transport: engine({ items: ["wing-fix"] }, [job]) });
    expect(await screen.findByRole("link", { name: "wing-fix" })).toBeInTheDocument();
    expect(screen.getByText(/too old to say how each went/)).toBeInTheDocument();
    expect(within(rows()[0]!).getByText("Failed")).toBeInTheDocument();
  });
});

describe("one A/B test", () => {
  const path = "/demo/abtests/:name";

  it("says how a finished test came out, with the table, the residual chart and the judge on each run", async () => {
    renderScreen(<AbTest />, { path, at: "/demo/abtests/ahmed25-coarse-fix", transport: demo() });
    expect(await screen.findByText("About the same on both meshes")).toBeInTheDocument();
    expect(screen.getByText(/residuals end at 1\.00× those on the original mesh \(the geometric mean over 6 fields\)/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "ahmed25-coarse-fix" })).toBeInTheDocument();
    expect(screen.getByText("Did it help the solver?")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Initial residual of p per iteration/ })).toBeInTheDocument();
    expect(await screen.findByText("Is the original-mesh run converged?")).toBeInTheDocument();
    expect(await screen.findByText("Is the repaired-mesh run converged?")).toBeInTheDocument();
    expect(screen.getAllByText("still converging")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "A/B tests" })).toHaveAttribute("href", "/demo/abtests");
    expect(document.title).toBe("A/B test of ahmed25-coarse-fix · Mesh Doctor");
  });

  it("follows a test while it runs: its step, its progress and the first run's residuals", async () => {
    renderScreen(<AbTest />, { path, at: "/demo/abtests/ahmed25-medium-fix", transport: demo() });
    expect(await screen.findByText("Solving on the repaired mesh")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    expect(screen.queryByText("Did it help the solver?")).not.toBeInTheDocument(); // nothing to compare yet
    expect(screen.getByRole("img", { name: /on the original and the repaired mesh/ })).toBeInTheDocument();
    expect(await screen.findByText(/The demo recorded no live solver data/)).toBeInTheDocument();
    expect(await screen.findByText("Is the original-mesh run converged?")).toBeInTheDocument();
    expect(screen.queryByText(/Is the repaired-mesh run converged/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Job details" })).toHaveAttribute("href", expect.stringMatching(/^\/demo\/jobs\?job=.*abtest-ahmed25-medium-fix/));
  });

  it("says when the engine has no test of that name", async () => {
    renderScreen(<AbTest />, { path, at: "/demo/abtests/nothing-fix", transport: demo() });
    expect(await screen.findByText(/The engine has no A\/B test of this name/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the A/B tests it has" })).toHaveAttribute("href", "/demo/abtests");
  });
});
