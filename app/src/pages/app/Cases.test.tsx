// SPDX-License-Identifier: GPL-3.0-or-later
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { demoTransport } from "@/demo/transport";
import { renderScreen } from "@/test/render";
import { Cases } from "./Cases";

const path = "/demo/cases";
/** The demo's cases: ahmed-25-coarse, -fine and -medium, ahmed-35-medium and pitzDaily. */
const open = (at: string) => renderScreen(<Cases />, { path, at, transport: demoTransport(undefined, 0) });
/** The table's rows, without its head. */
const rows = () => screen.getAllByRole("row").slice(1);

describe("the Cases screen", () => {
  it("keeps what's typed in its filter box in the address, so a reload or a link keeps it", async () => {
    const { router } = open(`${path}?q=pitz`);
    expect(await screen.findByText("1 of 5 cases")).toBeInTheDocument();
    const box = screen.getByRole("textbox", { name: "Filter cases" });
    expect(box).toHaveValue("pitz");
    expect(rows()).toHaveLength(1);

    await userEvent.clear(box);
    expect(router.state.location.search).toBe("");
    expect(rows()).toHaveLength(5);

    await userEvent.type(box, "ahmed-25");
    expect(router.state.location.search).toBe("?q=ahmed-25");
    expect(screen.getByText("3 of 5 cases")).toBeInTheDocument();
    expect(rows()).toHaveLength(3);
  });
});
