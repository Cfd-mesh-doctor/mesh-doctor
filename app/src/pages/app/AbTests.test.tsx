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

/** The innermost element whose words are `text`, across the elements in it (a variant's name is in one of its own). */
const whole = (text: string) => (_: string, el: Element | null) =>
  !!el && el.textContent === text && ![...el.children].some((c) => c.textContent === text);

/** A finished A/B test of solver settings on case wing: the original mesh with the case's settings, then with lts'. */
const settingsTest = (over: Record<string, unknown> = {}) => ({
  status: { step: "done", time: "2026-11-23 12:00:00" },
  result: {
    schemaVersion: "1.0", source: "cases/wing", fixedName: null, variant: "lts", label: "wing_lts", iters: 200, nProcs: 4,
    init: "0", window: 50, started: "2026-11-23 11:00:00", finished: "2026-11-23 12:00:00",
    base: { residuals: { p: { mean: 0.02, median: 0.02 } }, secondsPerIteration: 0.5 },
    fixed: { residuals: { p: { mean: 0.01, median: 0.01 } }, secondsPerIteration: 0.6 },
    residualRatioFixedOverBase: { p: 0.5 },
  },
  live: { base: { cols: ["Time", "p"], rows: [[1, 0.1], [2, 0.02]] }, fixed: { cols: ["Time", "p"], rows: [[1, 0.1], [2, 0.01]] } },
  modes: [],
  ...over,
});

/** An engine with test wing_lts (`detail`), the lts variant and these jobs. */
function settingsEngine(detail: unknown, jobs: unknown[] = []): Transport {
  return {
    kind: "engine",
    scope: "test",
    async request<T>(_m: string, path: string): Promise<T> {
      if (path === "/abtests") {
        const brief = { step: "done", updated: "2026-11-23 12:00:00", finished: "2026-11-23 12:00:00", ratios: { p: 0.5 }, verdict: null };
        return { items: ["wing_lts"], tests: { wing_lts: brief } } as T;
      }
      if (path === "/abtests/wing_lts") return structuredClone(detail) as T;
      if (path.startsWith("/abtests/wing_lts/judge")) return { verdict: "converged", window: 50 } as T;
      if (path === "/variants") return { items: [{ name: "lts", label: "pseudo-transient local time stepping (localEuler)" }] } as T;
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

  it("lists a test of solver settings by its case and settings, under the second run's ratio", async () => {
    renderScreen(<AbTests />, { path: "/app/abtests", transport: settingsEngine(settingsTest()) });
    const row = (await screen.findByRole("link", { name: "wing_lts" })).closest("tr")!;
    // (The row's line goes on with the ratio on a phone.)
    expect(await within(row).findByText((_, el) => el?.tagName === "DIV" && (el.textContent ?? "").startsWith("wing · lts settings")))
      .toBeInTheDocument();
    expect(within(row).getByText("lts", { selector: "code" })).toBeInTheDocument(); // in the mono font: not "Its"
    expect(screen.getByRole("columnheader", { name: "Second run ÷ first" })).toBeInTheDocument();
    expect(within(row).getByText("helped")).toBeInTheDocument();
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

  it("words a test of solver settings as the case's settings against the variant's, on the original mesh", async () => {
    renderScreen(<AbTest />, { path: "/app/abtests/:name", at: "/app/abtests/wing_lts", transport: settingsEngine(settingsTest()) });
    const status = await screen.findByText(whole("The lts settings helped the solver"));
    expect(status.querySelector("code")).toHaveTextContent(/^lts$/); // in the mono font: not "Its"
    expect(screen.getByText(whole("With lts settings the residuals end at 0.50× those with the case's settings, so the lts settings helped the solver.")))
      .toBeInTheDocument();
    expect(screen.getByText(whole("A/B test of solver settings · case wing · 200 iterations a run · second run with lts settings"))).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Field", "Case's settings", "lts settings", "lts ÷ case's"]);
    // The variant is in the mono font wherever the page writes it: in the app's font, lts reads as "Its".
    const card = screen.getByRole("heading", { name: "Did it help the solver?" }).parentElement!;
    expect(within(card).getByText("lts", { selector: "code" })).toBeInTheDocument(); // its description
    expect(screen.getAllByRole("columnheader").filter((h) => h.querySelector("code")?.textContent === "lts")).toHaveLength(2);
    expect(screen.getByText((_, el) => el?.tagName === "P" && /the same case, mesh and start for both settings\. Below 1× the lts settings converge further\. Time per iteration: 0\.50 s with the case's settings, 0\.60 s with lts\./.test(el.textContent ?? "")))
      .toBeInTheDocument();
    expect(screen.getAllByText(whole("Residuals, the case's settings vs lts")).length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: "Initial residual of p per iteration with the case's settings and with lts, log scale" })).toBeInTheDocument();
    expect(await screen.findByText("Is the run with the case's settings converged?")).toBeInTheDocument();
    expect(await screen.findByText(whole("Is the run with lts settings converged?"))).toBeInTheDocument();
    expect(screen.queryByText(/repaired/i)).not.toBeInTheDocument();
  });

  it("words a running test of solver settings' step by its settings, from its job, before it has a result", async () => {
    const job = {
      id: "20261123-110000-abtest-wing_lts-0001", kind: "abtest", name: "wing_lts", state: "running", created: "2026-11-23T11:00:00Z",
      params: { name: "wing-fix", iters: 200, init: "auto", variant: "lts" }, progress: { step: "solving base", fraction: 0.25 },
    };
    const detail = settingsTest({ status: { step: "solving base", time: "2026-11-23 11:00:00" }, result: null });
    renderScreen(<AbTest />, { path: "/app/abtests/:name", at: "/app/abtests/wing_lts", transport: settingsEngine(detail, [job]) });
    expect(await screen.findByText("Solving with the case's settings")).toBeInTheDocument();
    expect(screen.getByText(whole("A/B test of solver settings · second run with lts settings"))).toBeInTheDocument();
    expect(screen.getAllByText(whole("Residuals, the case's settings vs lts")).length).toBeGreaterThan(0);
  });

  it("says when the engine has no test of that name", async () => {
    renderScreen(<AbTest />, { path, at: "/demo/abtests/nothing-fix", transport: demo() });
    expect(await screen.findByText(/The engine has no A\/B test of this name/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the A/B tests it has" })).toHaveAttribute("href", "/demo/abtests");
  });
});
