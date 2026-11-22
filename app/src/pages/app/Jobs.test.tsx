// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { demoTransport } from "@/demo/transport";
import { renderScreen } from "@/test/render";
import { Jobs } from "./Jobs";

const path = "/demo/jobs";
/** The demo's jobs: one running, six done and one cancelled. */
const open = (at: string) => renderScreen(<Jobs />, { path, at, transport: demoTransport(undefined, 0) });
const filter = () => screen.getByRole("radiogroup", { name: "Show jobs" });
/** The table's rows, without its head. */
const rows = () => screen.getAllByRole("row").slice(1);

describe("the Jobs screen", () => {
  it("keeps its filter in the address, so a reload or a link keeps it", async () => {
    const { router } = open(`${path}?show=cancelled`);
    expect(await screen.findByRole("button", { name: "ahmed25-fine-strict" })).toBeInTheDocument();
    expect(within(filter()).getByRole("radio", { checked: true })).toHaveTextContent(/^Cancelled/);
    expect(rows()).toHaveLength(1);

    await userEvent.click(within(filter()).getByRole("radio", { name: /^Done/ }));
    expect(router.state.location.search).toBe("?show=done");
    expect(rows()).toHaveLength(6);

    await userEvent.click(within(filter()).getByRole("radio", { name: /^All/ }));
    expect(router.state.location.search).toBe("");
    expect(rows()).toHaveLength(8);
  });

  it("shows every job when the address names a filter it doesn't know", async () => {
    open(`${path}?show=nonsense`);
    expect(await screen.findAllByRole("button", { name: "ahmed25-medium-fix" })).toHaveLength(2);
    expect(within(filter()).getByRole("radio", { checked: true })).toHaveTextContent(/^All/);
    expect(rows()).toHaveLength(8);
  });
});
