// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { demoTransport } from "@/demo/transport";
import { renderScreen } from "@/test/render";
import { AppTour } from "./AppTour";
import { TOUR_STEPS } from "./tourSteps";

const PARTS = ["tiles", "cases", "jobs", "verdict"];

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
  it("says, at the Cases screen, how to repair a case: copy its command and run it in a WSL or Linux terminal", () => {
    const cases = TOUR_STEPS.find((s) => s.spot === "cases")!;
    expect(cases.text).toMatch(/To repair one, copy its repair command and run it in a WSL or Linux terminal\.$/);
  });

  it("says, at a report, that your own engine's report gives the solver test's command when it has none", () => {
    const reports = TOUR_STEPS.find((s) => s.spot === "verdict")!;
    expect(reports.text).toMatch(/if not, your own engine's report gives the command for that test\.$/);
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
    for (const page of ["/demo", "/demo/cases", "/demo/jobs", "/demo/repairs/ahmed35-medium-fix/report"]) {
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
