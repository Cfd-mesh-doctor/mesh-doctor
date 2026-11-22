// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderScreen } from "@/test/render";
import { Accuracy } from "./Accuracy";

describe("Accuracy check", () => {
  it("sums up the validation run, charts each case against the wind tunnel and reads one out", async () => {
    const { container } = renderScreen(<Accuracy />, { path: "/accuracy" });
    expect(screen.getByRole("heading", { level: 1, name: "Accuracy check" })).toBeInTheDocument();
    expect(document.title).toBe("Accuracy check · Mesh Doctor");

    const chart = screen.getByRole("img", { name: /^Drag coefficient of each case/ });
    expect(chart).toHaveAccessibleName(expect.stringContaining("Medium mesh, 25° slant, 0.280 against 0.285 (−1.7 %)"));
    expect(chart).toHaveAccessibleName(expect.stringContaining("35° slant, medium mesh, 0.408 against 0.26 (+57 %)"));

    expect(screen.getByText("Point at a case, or tap it, for all its numbers.")).toBeInTheDocument();
    await userEvent.hover(container.querySelector('[data-row="3"]') as Element);
    expect(screen.getByText(/Steady RANS keeps the flow on the slant here/)).toBeInTheDocument();
    await userEvent.hover(container.querySelector('[data-row="1"]') as Element);
    expect(screen.getByText(/Cd 0\.280 against 0\.285 in the wind tunnel, −1\.7 %\. Lift Cl 0\.295/)).toBeInTheDocument();
    expect(screen.queryByText(/Steady RANS keeps the flow/)).not.toBeInTheDocument();
  });

  it("shows the doc's table in the page's words, and the commands to run it", () => {
    renderScreen(<Accuracy />, { path: "/accuracy" });
    const table = screen.getByRole("table", { name: "Results of the accuracy check" });
    const steep = within(table).getAllByRole("row")[4] as HTMLElement;
    // (a number keeps its "%" on the same line: the space before it is a no-break space, which \s matches)
    expect(within(steep).getAllByRole("cell").map((c) => c.textContent?.replace(/\s/g, " "))).toEqual([
      "35°", "35°", "0.84 M", "0.408", "−0.15 %", "0.445", "0.26", "+57 %", "24 min",
    ]);
    expect(screen.getAllByRole("button", { name: /^Copy “/ })).toHaveLength(3);
    expect(screen.getByRole("button", { name: /^Copy “\.\/Allvalidate 6 2000/ })).toBeInTheDocument();
  });
});
