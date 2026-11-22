// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { demoTransport } from "@/demo/transport";
import { renderScreen } from "@/test/render";
import { AppTour } from "./AppTour";
import { TOUR_STEPS } from "./tourSteps";

function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Take the tour</button>
      <AppTour open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** The tour in the demo, opened from its Jobs screen; it stays open on every screen of the demo, as in the app. */
const show = (at = "/demo/jobs") => renderScreen(<Opener />, { path: "/demo/*", at, transport: demoTransport(undefined, 0) });
const title = (i: number) => TOUR_STEPS[i]!.title;
const last = TOUR_STEPS.length - 1;

describe("the app tour", () => {
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
    for (const page of ["/demo", "/demo/cases", "/demo/jobs", "/demo/repairs/ahmed25-medium-fix/report"]) {
      await user.keyboard("{Enter}");
      await waitFor(() => expect(at()).toBe(page));
    }
    await user.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(at()).toBe("/demo/jobs"));
    await user.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(at()).toBe("/demo/jobs");
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
