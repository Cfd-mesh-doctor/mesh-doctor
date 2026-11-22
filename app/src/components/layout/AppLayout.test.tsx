// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOUR_SEEN } from "@/components/shared/tourSteps";
import { demoTransport } from "@/demo/transport";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import { renderScreen } from "@/test/render";
import { AppLayout } from "./AppLayout";

const show = (at: string) => renderScreen(<AppLayout />, { path: "/demo/*", at, transport: demoTransport(undefined, 0) });
const welcome = () => screen.queryByRole("dialog", { name: "Welcome to Mesh Doctor" });
/** The demo's banner, there from the first paint: the frame is up. */
const banner = () => screen.findByText(/^Demo: recorded from/);

/** Your own engine, with these repair runs and no jobs; `asked` keeps what the app asked it for. */
function engine(runs: { name: string; finished: string | null }[]) {
  const asked: string[] = [];
  const transport: Transport = {
    kind: "engine",
    scope: "test",
    request: async <T,>(_method: string, path: string) => {
      const route = path.split("?")[0]!;
      asked.push(route);
      if (route === "/repairs") {
        return { items: runs.map((r) => ({ ...r, nCells: null, profile: null, source: null, status: {}, verdict: null })) } as T;
      }
      if (route === "/jobs") return { items: [] } as T;
      throw new EngineError("not-found", `no route ${route}`, 404);
    },
  };
  return { transport, asked };
}
const showApp = (e: ReturnType<typeof engine>, at = "/app/jobs") =>
  renderScreen(<AppLayout />, { path: "/app/*", at, transport: e.transport });

afterEach(() => vi.restoreAllMocks());

describe("the demo's tour on a first visit", () => {
  it.each(["/demo", "/demo/"])("opens by itself on the demo's front page (%s) the first time, and this browser keeps that it has", async (at) => {
    show(at);
    expect(await screen.findByRole("dialog", { name: "Welcome to Mesh Doctor" }))
      .toHaveTextContent(/Step 1 of 5.*This demo replays a real run/);
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
    expect(localStorage.getItem(TOUR_SEEN)).toBe("1");
  });

  it("stays shut once this browser has seen it", async () => {
    localStorage.setItem(TOUR_SEEN, "1");
    show("/demo");
    await banner();
    expect(welcome()).toBeNull();
  });

  it("stays shut on a link straight to another screen, which doesn't count as seen", async () => {
    show("/demo/repairs/ahmed35-medium-fix/report");
    await banner();
    expect(welcome()).toBeNull();
    expect(localStorage.getItem(TOUR_SEEN)).toBeNull();
  });

  it("stays shut where the browser can't keep the note, rather than open on every visit", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Site data is blocked", "SecurityError");
    });
    show("/demo");
    await banner();
    expect(welcome()).toBeNull();
  });

  it("counts a tour opened by hand as seen", async () => {
    const user = userEvent.setup();
    show("/demo/jobs");
    await banner();
    expect(localStorage.getItem(TOUR_SEEN)).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "Take the tour" })[0]!);
    expect(await screen.findByRole("dialog", { name: "Welcome to Mesh Doctor" })).toBeInTheDocument();
    expect(localStorage.getItem(TOUR_SEEN)).toBe("1");
  });
});

describe("your own app's tour", () => {
  it("opens from the sidebar with its own welcome, and ends on the report of your latest finished repair", async () => {
    const user = userEvent.setup();
    const e = engine([
      { name: "older-fix", finished: "2026-11-20 09:00:00" },
      { name: "latest-fix", finished: "2026-11-21 08:00:00" },
      { name: "running-fix", finished: null },
    ]);
    const { router } = showApp(e);
    // The runs are asked for with the tour open, not all the time by the frame around every screen.
    await waitFor(() => expect(e.asked).toContain("/jobs"));
    expect(e.asked).not.toContain("/repairs");
    await user.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(await screen.findByRole("dialog", { name: "Welcome to Mesh Doctor" }))
      .toHaveTextContent("This browser is paired with the Mesh Doctor engine on your computer");
    await waitFor(() => expect(e.asked).toContain("/repairs"));
    for (let i = 0; i < 4; i++) await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Reports: did the repair help?" })).toHaveTextContent("A report opens with its verdict.");
    expect(router.state.location.pathname).toBe("/app/repairs/latest-fix/report");
  });

  it("stays on Jobs at its report step before a repair has finished, and says where reports open", async () => {
    const user = userEvent.setup();
    const { router } = showApp(engine([{ name: "running-fix", finished: null }]));
    await user.click(screen.getByRole("button", { name: "Take the tour" }));
    for (let i = 0; i < 4; i++) await user.click(await screen.findByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Reports: did the repair help?" }))
      .toHaveTextContent("No repair has finished yet. When one has, Report on the Jobs screen opens its report");
    expect(router.state.location.pathname).toBe("/app/jobs");
  });

  it("doesn't open by itself on your app's front page", async () => {
    const e = engine([]);
    showApp(e, "/app");
    await waitFor(() => expect(e.asked).toContain("/jobs"));
    expect(welcome()).toBeNull();
    expect(screen.getByRole("button", { name: "Take the tour" })).toBeInTheDocument();
  });
});
