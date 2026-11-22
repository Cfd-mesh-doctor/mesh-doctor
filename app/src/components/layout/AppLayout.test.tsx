// SPDX-License-Identifier: GPL-3.0-or-later
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOUR_SEEN } from "@/components/shared/tourSteps";
import { demoTransport } from "@/demo/transport";
import { renderScreen } from "@/test/render";
import { AppLayout } from "./AppLayout";

const show = (at: string) => renderScreen(<AppLayout />, { path: "/demo/*", at, transport: demoTransport(undefined, 0) });
const welcome = () => screen.queryByRole("dialog", { name: "Welcome to Mesh Doctor" });
/** The demo's banner, there from the first paint: the frame is up. */
const banner = () => screen.findByText(/^Demo: recorded from/);

afterEach(() => vi.restoreAllMocks());

describe("the demo's tour on a first visit", () => {
  it.each(["/demo", "/demo/"])("opens by itself on the demo's front page (%s) the first time, and this browser keeps that it has", async (at) => {
    show(at);
    expect(await screen.findByRole("dialog", { name: "Welcome to Mesh Doctor" })).toHaveTextContent("Step 1 of 5");
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
