// SPDX-License-Identifier: GPL-3.0-or-later
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Progress } from "./misc";

describe("a progress bar", () => {
  it("fills to its value, and says it", () => {
    render(<Progress value={0.62} label="wing-fix progress" />);
    const bar = screen.getByRole("progressbar", { name: "wing-fix progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "62");
    expect(bar.firstElementChild).toHaveStyle({ width: "62%" });
  });

  it("with no value yet, fills the track faintly rather than a third of it, which would read as 33 %", () => {
    render(<Progress value={null} label="wing-fix progress" />);
    const bar = screen.getByRole("progressbar", { name: "wing-fix progress" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar.firstElementChild).toHaveClass("w-full", "opacity-30");
    expect(bar.firstElementChild).not.toHaveClass("w-1/3");
  });
});
