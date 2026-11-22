// SPDX-License-Identifier: GPL-3.0-or-later
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EngineError } from "@/engine/errors";
import { ErrorPanel } from "./ErrorPanel";

describe("the error panel", () => {
  it("links a problem Troubleshooting has to that problem, in a new tab, beside Try again", () => {
    render(<ErrorPanel error={new EngineError("unreachable", "Failed to fetch")} onRetry={vi.fn()} />);
    const panel = within(screen.getByRole("alert"));
    expect(panel.getByText("The engine isn't answering")).toBeInTheDocument();
    const link = panel.getByRole("link", { name: "How to fix this" });
    expect(link).toHaveAttribute("href", "/troubleshooting?q=The+engine+isn%27t+answering");
    expect(link).toHaveAttribute("target", "_blank");
    expect(panel.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("links the pairing problem too, where there is nothing to try again", () => {
    render(<ErrorPanel compact error={new EngineError("forbidden", "forbidden: missing or wrong pairing key", 403)} />);
    expect(screen.getByRole("link", { name: "How to fix this" }))
      .toHaveAttribute("href", "/troubleshooting?q=This+browser+needs+pairing+again");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("has no link for a problem Troubleshooting doesn't have", () => {
    render(<ErrorPanel error={new EngineError("busy", "another job is running", 409)} />);
    expect(screen.getByText("Another OpenFOAM job is running")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
