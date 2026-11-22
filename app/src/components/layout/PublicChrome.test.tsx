// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderScreen } from "@/test/render";
import { PublicFooter, PublicHeader } from "./PublicChrome";

describe("public header", () => {
  it("has a menu with every link for small screens, which closes when one is picked", async () => {
    renderScreen(<PublicHeader />, { path: "/report" });
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = within(screen.getByRole("dialog", { name: "Menu" }));
    expect(menu.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Mesh Doctor", "How it works", "Accuracy check", "Gallery", "Privacy", "Get started", "Install", "Report viewer",
      "Size estimator", "Demo", "Docs",
    ]);
    expect(menu.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/how-it-works");
    expect(menu.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/#privacy");
    expect(menu.getByRole("link", { name: "Size estimator" })).toHaveAttribute("href", "/estimate");
    expect(menu.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    const here = menu.getByRole("link", { name: "Report viewer" });
    expect(here).toHaveAttribute("aria-current", "page");
    await userEvent.click(here);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("links the site's Docs page, as the footer does", () => {
    renderScreen(<><PublicHeader /><PublicFooter /></>, { path: "/" });
    const site = within(screen.getByRole("navigation", { name: "Site" }));
    expect(site.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    const footer = within(screen.getByRole("navigation", { name: "Footer" }));
    expect(footer.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
  });
});
