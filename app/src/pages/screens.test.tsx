// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoTransport } from "@/demo/transport";
import { loadPairing, savePairing } from "@/engine/pairing";
import type { Job } from "@/engine/types";
import { BROWSERS } from "@/lib/site";
import { renderScreen } from "@/test/render";
import { Connect } from "./Connect";
import { Cases } from "./app/Cases";
import { Jobs } from "./app/Jobs";

const KEY = "TestKey_0123456789abcdefghijklmnopqrstuvwxy";
const OTHER = "Zz9".repeat(15);

afterEach(() => vi.unstubAllGlobals());

describe("Connect", () => {
  it("saves a first pairing and takes the key out of the address bar", async () => {
    const { router } = renderScreen(<Connect />, {
      path: "/connect",
      at: `/connect#key=${KEY}&engine=http%3A%2F%2Flocalhost%3A8768`,
    });
    expect(await screen.findByText("Connect to your engine")).toBeInTheDocument();
    expect(loadPairing()).toMatchObject({ engine: "http://localhost:8768", key: KEY });
    await waitFor(() => expect(router.state.location.hash).toBe(""));
  });

  it("connects when asked, and says which engine answered", async () => {
    savePairing({ engine: "http://localhost:8768", key: KEY, paired: "" });
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ apiVersion: "1.0", version: "0.1.0", schemas: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);
    renderScreen(<Connect />, { path: "/connect" });
    expect(fetch).not.toHaveBeenCalled(); // nothing goes out before the user presses Connect
    await userEvent.click(screen.getByRole("button", { name: /^connect$/i }));
    expect(await screen.findByText(/Mesh Doctor v0\.1\.0 answered/)).toBeInTheDocument();
    expect(fetch.mock.calls[0]?.[0]).toBe("http://localhost:8768/api/v1/");
  });

  it("explains a refused connection", async () => {
    savePairing({ engine: "http://localhost:8768", key: KEY, paired: "" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderScreen(<Connect />, { path: "/connect" });
    await userEvent.click(screen.getByRole("button", { name: /^connect$/i }));
    expect(await screen.findByText("The engine isn't answering")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("tells a Safari user which browsers can reach the engine", async () => {
    const safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue(safari);
    savePairing({ engine: "http://localhost:8768", key: KEY, paired: "" });
    renderScreen(<Connect />, { path: "/connect" });
    expect(await screen.findByText(`Safari doesn't let websites reach apps on your computer. Use ${BROWSERS} for Mesh Doctor.`))
      .toBeInTheDocument();
    ua.mockRestore();
  });

  it("asks before replacing a different pairing", async () => {
    savePairing({ engine: "http://localhost:8765", key: OTHER, paired: "" });
    renderScreen(<Connect />, { path: "/connect", at: `/connect#key=${KEY}` });
    expect(await screen.findByText("Replace this browser's pairing?")).toBeInTheDocument();
    expect(loadPairing()?.key).toBe(OTHER);
    await userEvent.click(screen.getByRole("button", { name: /keep the current one/i }));
    expect(loadPairing()?.key).toBe(OTHER);
  });

  it("refuses a link that points away from this computer", async () => {
    renderScreen(<Connect />, { path: "/connect", at: `/connect#key=${KEY}&engine=http%3A%2F%2Fevil.test%3A8765` });
    expect(await screen.findByText(/isn't on this computer/)).toBeInTheDocument();
    expect(loadPairing()).toBeNull();
  });
});

const job = (id: string, name: string, state: Job["state"], extra: Partial<Job> = {}): Job => ({
  schemaVersion: "1.0", id, kind: "repair", params: { source: "ahmed-25-fine", name }, name, state, runner: "local",
  created: "2026-11-21T19:00:00Z", started: "2026-11-21T19:00:00Z", log: `${name}.log`, ...extra,
});

describe("Jobs", () => {
  const data = () => ({
    "/jobs": {
      items: [
        job("20261121-130141-repair-ahmed25-fine-strict-0266", "ahmed25-fine-strict", "running", {
          progress: { step: "checkMesh (before)", fraction: 0.4, updated: null },
        }),
        job("20261121-130031-repair-ahmed25-fine-fix-0fa7", "ahmed25-fine-fix", "done", { finished: "2026-11-21T19:01:34Z" }),
        job("20261121-120000-abtest-broken-0001", "broken", "failed", { kind: "abtest", error: "foamRun failed", exitCode: 1 }),
      ],
    },
  });

  it("lists jobs with live progress and filters them", async () => {
    renderScreen(<Jobs />, { transport: demoTransport(data(), 0) });
    expect(await screen.findByText("ahmed25-fine-strict")).toBeInTheDocument();
    // Twice in jsdom (no CSS): the wide-screen Progress column and the phone line under the name.
    expect(screen.getAllByText("checkMesh (before)")).toHaveLength(2);
    expect(screen.getByText("foamRun failed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /failed/i }));
    expect(screen.queryByText("ahmed25-fine-fix")).not.toBeInTheDocument();
    expect(screen.getByText("broken")).toBeInTheDocument();
  });

  it("cancels only after confirming", async () => {
    renderScreen(<Jobs />, { transport: demoTransport(data(), 0) });
    const row = (await screen.findByText("ahmed25-fine-strict")).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Cancel ahmed25-fine-strict?")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /cancel job/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await within(row).findByText("Cancelled")).toBeInTheDocument();
  });

  it("opens a job's details", async () => {
    renderScreen(<Jobs />, { transport: demoTransport(data(), 0) });
    await userEvent.click(await screen.findByRole("button", { name: "ahmed25-fine-fix" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("20261121-130031-repair-ahmed25-fine-fix-0fa7")).toBeInTheDocument();
    expect(within(dialog).getByText('"ahmed-25-fine"')).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open report" }))
      .toHaveAttribute("href", expect.stringMatching(/\/repairs\/ahmed25-fine-fix\/report$/));
  });

  it("links each finished job to its run's report, and no other job", async () => {
    renderScreen(<Jobs />, { transport: demoTransport(data(), 0) });
    await screen.findByText("ahmed25-fine-strict");
    const links = screen.getAllByRole("link", { name: /^Report of / });
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual(["Report of ahmed25-fine-fix"]);
    expect(links[0]).toHaveAttribute("href", expect.stringMatching(/\/repairs\/ahmed25-fine-fix\/report$/));
    // a failed job has no report to open
    await userEvent.click(screen.getByRole("button", { name: "broken" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("link", { name: "Open report" })).not.toBeInTheDocument();
  });
});

describe("Cases", () => {
  const verdict = { improved: ["maxSkewness"], regressions: [], unchanged: [] };
  const data = () => ({
    "/cases": { items: ["wing", "bracket"] },
    "/repairs": {
      items: [
        { name: "wing-old", source: "~/cases/wing", finished: "2026-11-20T10:00:00Z", verdict },
        { name: "wing-new", source: "~/cases/wing", finished: "2026-11-21T10:00:00Z", verdict },
        { name: "wing-running", source: "~/cases/wing", finished: null, verdict: null },
      ],
    },
  });

  it("links a case to the report of its latest finished repair, and a case never repaired to none", async () => {
    renderScreen(<Cases />, { transport: demoTransport(data(), 0) });
    const wing = (await screen.findByText("wing")).closest("tr") as HTMLElement;
    // Beside the verdict, or under it on phones: one link either way.
    const links = await within(wing).findAllByRole("link", { name: "Report of wing-new" });
    expect(links).toHaveLength(1);
    for (const link of links) expect(link).toHaveAttribute("href", expect.stringMatching(/\/repairs\/wing-new\/report$/));
    const bracket = screen.getByText("bracket").closest("tr") as HTMLElement;
    expect(within(bracket).queryByRole("link")).not.toBeInTheDocument();
  });

  const row = async (name: string) => (await screen.findByText(name)).closest("tr") as HTMLElement;
  const estimates = (tr: HTMLElement) => within(tr).queryAllByRole("link", { name: /^Size estimate for / })
    .map((l) => l.getAttribute("href"));

  it("links each case to the size estimate for its mesh, from the size the engine gives", async () => {
    const sized = {
      "/cases": { items: ["wing", "car", "cavity", "odd"], cells: { wing: 12_225, car: 31_100_000, cavity: 400, odd: null } },
      "/repairs": { items: [] },
    };
    renderScreen(<Cases />, { transport: demoTransport(sized, 0) });
    // Twice in jsdom (no CSS): the Cells column, and under the name below md.
    expect(estimates(await row("wing"))).toEqual(Array(2).fill("/demo/estimate?cells=0.012225"));
    expect(estimates(await row("car"))).toEqual(Array(2).fill("/demo/estimate?cells=31.1"));
    // too small for the estimator (under 1,000 cells): the size, but no link
    const cavity = await row("cavity");
    expect(within(cavity).getAllByText(/^400/)).toHaveLength(2);
    expect(estimates(cavity)).toEqual([]);
    // a mesh whose header doesn't say, never repaired: no size and no link
    const odd = await row("odd");
    expect(estimates(odd)).toEqual([]);
    expect(within(odd).queryByText(/ cells$/)).not.toBeInTheDocument();
  });

  it("takes the size its repairs counted from an engine older than API 1.2", async () => {
    const older = {
      "/cases": { items: ["wing"] },
      "/repairs": { items: [
        { name: "wing-running", source: "~/cases/wing", finished: null, verdict: null, nCells: null },
        { name: "wing-fix", source: "~/cases/wing", finished: "2026-11-21T10:00:00Z", verdict, nCells: 478_901 },
      ] },
    };
    renderScreen(<Cases />, { transport: demoTransport(older, 0) });
    expect(estimates(await row("wing"))).toEqual(Array(2).fill("/demo/estimate?cells=0.478901"));
    expect(screen.getAllByText(/^479 k/)).toHaveLength(2);
  });
});
