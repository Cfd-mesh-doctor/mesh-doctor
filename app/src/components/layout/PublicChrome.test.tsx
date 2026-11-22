// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderScreen } from "@/test/render";
import { PublicHeader } from "./PublicChrome";

describe("public header", () => {
  it("has a menu with every link for small screens, which closes when one is picked", async () => {
    renderScreen(<PublicHeader />, { path: "/report" });
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = within(screen.getByRole("dialog", { name: "Menu" }));
    expect(menu.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Mesh Doctor", "How it works", "Privacy", "Get started", "Report viewer", "Size estimator", "Demo", "Docs",
    ]);
    expect(menu.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/#privacy");
    expect(menu.getByRole("link", { name: "Size estimator" })).toHaveAttribute("href", "/estimate");
    const here = menu.getByRole("link", { name: "Report viewer" });
    expect(here).toHaveAttribute("aria-current", "page");
    await userEvent.click(here);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
