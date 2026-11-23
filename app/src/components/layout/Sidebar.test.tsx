// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoTransport } from "@/demo/transport";
import { renderScreen } from "@/test/render";
import { AppLayout } from "./AppLayout";

const show = () => renderScreen(<AppLayout />, { path: "/demo/*", at: "/demo/jobs", transport: demoTransport(undefined, 0) });
const sidebar = () => within(screen.getByRole("complementary"));
const fold = (where = sidebar()) => where.getByRole("button", { name: "Coming next 4 screens" });
const COMING = ["Solve", "Pictures", "Results", "Local tools"];

afterEach(() => vi.restoreAllMocks());

describe("the sidebar's Coming next list", () => {
  it("is folded away at first, saying how many screens are coming, so the six that work come first", () => {
    show();
    expect(fold()).toHaveAttribute("aria-expanded", "false");
    for (const name of COMING) expect(sidebar().getByText(name)).not.toBeVisible();
    for (const name of ["Overview", "Cases", "Repairs", "A/B tests", "Jobs", "Size estimator"]) {
      expect(sidebar().getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
    }
  });

  it("opens with a click and stays as it was left in this browser", async () => {
    const user = userEvent.setup();
    const first = show();
    await user.click(fold());
    expect(fold()).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(fold().getAttribute("aria-controls")!)).toBeVisible();
    for (const name of COMING) expect(sidebar().getByText(name)).toBeVisible();
    first.unmount();

    const again = show(); // the next visit
    expect(fold()).toHaveAttribute("aria-expanded", "true");
    await user.click(fold());
    expect(fold()).toHaveAttribute("aria-expanded", "false");
    expect(sidebar().getByText("Solve")).not.toBeVisible();
    again.unmount();

    show();
    expect(fold()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens in the phone's menu and the wide screen's sidebar alike", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    const menu = within(await screen.findByRole("dialog", { name: "Navigation" }));
    await user.click(fold(menu));
    expect(fold(menu)).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fold()).toHaveAttribute("aria-expanded", "true");
  });

  it("still opens and folds where this browser keeps nothing", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The site's data is blocked", "SecurityError");
    });
    const user = userEvent.setup();
    show();
    await user.click(fold());
    expect(fold()).toHaveAttribute("aria-expanded", "true");
    expect(sidebar().getByText("A/B tests")).toBeVisible();
    await user.click(fold());
    expect(fold()).toHaveAttribute("aria-expanded", "false");
  });
});
