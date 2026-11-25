// SPDX-License-Identifier: GPL-3.0-or-later
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { demoTransport } from "@/demo/transport";
import { renderScreen } from "@/test/render";
import { AppTour } from "./AppTour";
import { TOUR_STEPS, engineTourSteps } from "./tourSteps";

const PARTS = ["tiles", "cases", "new-case", "repairs", "abtests", "pictures", "results", "jobs", "verdict"];

/** The tour's button, and stand-ins for the parts of the screens it rings. */
function Opener({ parts }: { parts: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {parts.map((p) => <div key={p} data-tour={p} />)}
      <button type="button" onClick={() => setOpen(true)}>Take the tour</button>
      <AppTour open={open} onClose={() => setOpen(false)} steps={TOUR_STEPS} />
    </>
  );
}

/** The tour in the demo, opened from its Jobs screen; it stays open on every screen of the demo, as in the app. */
const show = (at = "/demo/jobs", parts = PARTS) =>
  renderScreen(<Opener parts={parts} />, { path: "/demo/*", at, transport: demoTransport(undefined, 0) });
const title = (i: number) => TOUR_STEPS[i]!.title;
const last = TOUR_STEPS.length - 1;
const ringed = () => [...document.querySelectorAll("[data-tour-spot]")].map((el) => el.getAttribute("data-tour"));

describe("the app tour", () => {
  it("says, at the Cases screen, how to repair a case: its Repair button, or its command in a WSL or Linux terminal", () => {
    const cases = TOUR_STEPS.find((s) => s.spot === "cases")!;
    expect(cases.text).toMatch(/To repair one, press Repair under its name, or copy its repair command and run it in a WSL or Linux terminal\.$/);
  });

  it("says, at a report, that your own engine's report offers to start the solver test when it has none", () => {
    const reports = TOUR_STEPS.find((s) => s.spot === "verdict")!;
    expect(reports.text).toMatch(/if not, your own engine's report offers to start that test\.$/);
  });

  it("opens Solve after Cases, as the sidebar lists them, and rings New case there, the way to a first case to solve", () => {
    const at = TOUR_STEPS.findIndex((s) => s.page === "/solve");
    expect(TOUR_STEPS[at - 1]!.page).toBe("/cases");
    expect(TOUR_STEPS[at]!.spot).toBe("new-case");
    expect(TOUR_STEPS[at]!.text).toMatch(/New case makes a ready-made case from a template, such as the Ahmed body, and meshes it/);
    // ...and where the first run, step by step, is kept: the sidebar's foot (the phone's menu).
    expect(TOUR_STEPS[at]!.text).toMatch(/ For a first run step by step, open Try it on the Ahmed body, at the foot of the menu\.$/);
  });

  it("opens Pictures and Results after A/B tests and before Jobs, as the sidebar lists them, ringing each screen's list", () => {
    const at = TOUR_STEPS.findIndex((s) => s.page === "/pictures");
    expect(TOUR_STEPS.slice(at - 1, at + 3).map((s) => [s.page, s.spot])).toEqual([
      ["/abtests", "abtests"], ["/pictures", "pictures"], ["/results", "results"], ["/jobs", "jobs"],
    ]);
    expect(TOUR_STEPS[at]!.text).toMatch(/^Pictures has ParaView draw a solved case's flow on the engine's computer: /);
    expect(TOUR_STEPS[at + 1]!.text).toMatch(/ Compare puts two cases, or an A\/B test's two runs, side by side /);
  });

  it("is your own app's tour too, from Cases to Jobs, between its own welcome, Overview and report", () => {
    const steps = engineTourSteps("a-fix");
    expect(steps).toHaveLength(TOUR_STEPS.length);
    expect(steps.slice(2, -1)).toEqual(TOUR_STEPS.slice(2, -1));
    expect(steps[0]!.text).toMatch(/your own cases, solves, repair runs, A\/B tests, pictures, results and jobs/);
    expect(steps.at(-1)!.page).toBe("/repairs/a-fix/report");
    // Before a repair has finished: Getting started on the Overview, and a last step with nothing to ring.
    expect(engineTourSteps(null, true).map((s) => s.spot)).toEqual(
      [undefined, "start", "cases", "new-case", "repairs", "abtests", "pictures", "results", "jobs", undefined],
    );
  });

  it("steps through with Enter and back again, then hands the focus back when done", async () => {
    const user = userEvent.setup();
    show();
    const opener = screen.getByRole("button", { name: "Take the tour" });
    await user.click(opener);
    expect(screen.getByRole("dialog", { name: title(0) })).toHaveAccessibleDescription(TOUR_STEPS[0]!.text);
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();

    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: title(1) })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: title(0) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus(); // not lost with the Back button

    for (let i = 0; i < last; i++) await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: title(last) })).toBeInTheDocument();
    expect(screen.getByText(`Step ${last + 1} of ${TOUR_STEPS.length}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("opens the screen each step describes; Back opens the one before, and skipping stays put", async () => {
    const user = userEvent.setup();
    const { router } = show("/demo/jobs");
    const at = () => router.state.location.pathname;
    await user.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(at()).toBe("/demo/jobs"); // the welcome stays where the tour was opened
    for (const page of ["/demo", "/demo/cases", "/demo/solve", "/demo/repairs", "/demo/abtests", "/demo/pictures",
      "/demo/results", "/demo/jobs", "/demo/repairs/ahmed35-medium-fix/report"]) {
      await user.keyboard("{Enter}");
      await waitFor(() => expect(at()).toBe(page));
    }
    await user.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(at()).toBe("/demo/jobs"));
    await user.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(at()).toBe("/demo/jobs");
  });

  it("rings the part of the screen each step means, one at a time, and lets go when the tour closes", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(ringed()).toEqual([]); // the welcome means no part
    for (const part of PARTS) {
      await user.keyboard("{Enter}");
      await waitFor(() => expect(ringed()).toEqual([part]));
    }
    await user.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(ringed()).toEqual(["jobs"]));
    await user.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(ringed()).toEqual([]);
  });

  it("rings a part that shows up after its step opened, as a screen shows its data after it opens", async () => {
    const user = userEvent.setup();
    show("/demo/jobs", []);
    await user.click(screen.getByRole("button", { name: "Take the tour" }));
    await user.keyboard("{Enter}"); // the Overview, whose tiles aren't there yet
    expect(ringed()).toEqual([]);
    const tiles = document.createElement("div");
    tiles.setAttribute("data-tour", "tiles");
    document.body.append(tiles);
    await waitFor(() => expect(ringed()).toEqual(["tiles"]));
    tiles.remove();
  });

  it("brings the part it rings into view again as the cards above it fill in and push it down, for two seconds", async () => {
    const user = userEvent.setup();
    show();
    const part = document.querySelector<HTMLElement>('[data-tour="tiles"]')!;
    let top = 100; // high on the screen, where it stays put
    part.getBoundingClientRect = () => ({ top, bottom: top + 120 }) as DOMRect;
    const scroll = vi.fn();
    part.scrollIntoView = scroll;
    await user.click(screen.getByRole("button", { name: "Take the tour" }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
      const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
      fireEvent.click(screen.getByRole("button", { name: "Next" })); // the Overview, whose tiles it rings
      await wait(400);
      expect(ringed()).toEqual(["tiles"]);
      expect(scroll).not.toHaveBeenCalled();
      top = 600; // the cards above it filled in: low on the screen, where the tour stands
      await wait(400);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll).toHaveBeenLastCalledWith({ block: "start", behavior: "smooth" });
      top = 300; // it moved again while that scroll may still be on its way, to where it was
      await wait(400);
      expect(scroll).toHaveBeenCalledTimes(2);
      await wait(1500); // two seconds on, it's left where it is
      top = 700;
      await wait(400);
      expect(scroll).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("can be skipped, or closed with Escape, at any step, and starts again from the beginning", async () => {
    const user = userEvent.setup();
    show();
    const opener = screen.getByRole("button", { name: "Take the tour" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(opener).toHaveFocus());

    await user.click(opener);
    expect(screen.getByRole("dialog", { name: title(0) })).toBeInTheDocument();
    await user.keyboard("{Enter}{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(opener).toHaveFocus());
    await user.click(opener);
    expect(screen.getByRole("dialog", { name: title(0) })).toBeInTheDocument();
  });

  it("reads each step out, as the focus stays on Next while the words change", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Take the tour" }));
    const live = screen.getByText(`Step 1 of ${TOUR_STEPS.length}`).parentElement!;
    expect(live).toHaveAttribute("aria-live", "polite");
    await user.keyboard("{Enter}");
    expect(live).toHaveTextContent(TOUR_STEPS[1]!.text);
  });
});
