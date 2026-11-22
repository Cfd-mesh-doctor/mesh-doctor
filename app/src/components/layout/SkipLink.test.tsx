// SPDX-License-Identifier: GPL-3.0-or-later
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SkipLink } from "./SkipLink";

function Page() {
  return (
    <>
      <SkipLink />
      <header><a href="/one">One</a><a href="/two">Two</a></header>
      <main><h1>A page</h1><a href="/three">Three</a></main>
    </>
  );
}

describe("the skip link", () => {
  it("is the first thing Tab reaches, and moves the focus past the header to the main content", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to the content" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("main")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Three" })).toHaveFocus();
  });

  it("leaves the address alone, and the main content takes the focus only until it loses it", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("link", { name: "Skip to the content" }));
    expect(window.location.hash).toBe("");
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("tabindex", "-1");
    await user.tab();
    expect(main).not.toHaveAttribute("tabindex");
  });
});
