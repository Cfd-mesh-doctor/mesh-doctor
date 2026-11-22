// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderScreen } from "@/test/render";
import { Gallery } from "./Gallery";

describe("Gallery", () => {
  it("shows each section's pictures with their captions, sized to avoid a jump while they load", () => {
    renderScreen(<Gallery />, { path: "/gallery" });
    expect(screen.getByRole("heading", { level: 1, name: "Gallery" })).toBeInTheDocument();
    expect(document.title).toBe("Gallery · Mesh Doctor");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Vortices", "Cut planes", "Convergence charts", "Dashboard",
    ]);
    const cuts = within(screen.getByRole("region", { name: "Cut planes" }));
    expect(cuts.getByText("cut_views.py").tagName).toBe("CODE");
    const pictures = cuts.getAllByRole("img");
    expect(pictures.map((i) => i.getAttribute("alt"))).toEqual([
      "Speed on the centreline", "Total pressure on the centreline", "Cross cut 0.2 m behind the base",
    ]);
    for (const img of screen.getAllByRole("img")) {
      expect(img).toHaveAttribute("width");
      expect(img).toHaveAttribute("height");
      expect(img.closest("a")).toHaveAttribute("href", img.getAttribute("src"));
    }
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("link", { name: "Accuracy check" })).toHaveAttribute("href", "/accuracy");
  });
});
