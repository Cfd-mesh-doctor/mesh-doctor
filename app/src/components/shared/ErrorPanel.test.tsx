// SPDX-License-Identifier: GPL-3.0-or-later
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EngineError, NOT_THE_ENGINE } from "@/engine/errors";
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

  it("links an answer that isn't the engine's (another program on its port), and no other unexpected answer", () => {
    const { unmount } = render(<ErrorPanel error={new EngineError("bad-response", `HTTP 200 ${NOT_THE_ENGINE}`, 200)} />);
    expect(screen.getByRole("link", { name: "How to fix this" }))
      .toHaveAttribute("href", "/troubleshooting?q=Unexpected+answer");
    unmount();
    render(<ErrorPanel error={new EngineError("bad-response", "a newer engine's words", 400)} />);
    expect(screen.getByText("Unexpected answer")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "How to fix this" })).not.toBeInTheDocument();
  });

  it("shows the commands a hint names as code, a short one on one line, and no backticks", () => {
    render(<ErrorPanel compact error={new EngineError("forbidden", "forbidden: missing or wrong pairing key", 403)} />);
    // A command split over two lines ("meshdoctor pair", then "--new") wouldn't read as one.
    const code = screen.getByText("meshdoctor pair --new", { selector: "code" });
    expect(code).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("meshdoctor serve", { selector: "code" })).toHaveClass("whitespace-nowrap");
    const hint = code.closest("p");
    expect(hint).toHaveTextContent(/^The engine has a different pairing key, or none was sent\. Ran meshdoctor pair --new /);
    expect(hint?.textContent).not.toContain("`");
  });

  it("shows an engine's own words as they are", () => {
    render(<ErrorPanel error={new EngineError("not-found", "no case named motorBike2")} />);
    expect(screen.getByText("no case named motorBike2")).toBeInTheDocument();
    expect(screen.getByRole("alert").querySelector("p code")).toBeNull();
  });

  it("has no link for a problem Troubleshooting doesn't have", () => {
    render(<ErrorPanel error={new EngineError("busy", "another job is running", 409)} />);
    expect(screen.getByText("Another OpenFOAM job is running")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
