// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SEARCH_INDEX } from "@/pages/docs/searchIndex";
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

  it("is found by the Docs page's search by the words each section shows, at its heading", () => {
    renderScreen(<Gallery />, { path: "/gallery" });
    const found = SEARCH_INDEX.filter((e) => e.page === "/gallery");
    expect(found.map((e) => e.title)).toEqual(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent));
    for (const e of found) {
      const section = screen.getByRole("region", { name: e.title });
      expect(section).toHaveAttribute("id", e.id);
      for (const el of section.querySelectorAll("p, figcaption")) {
        expect(e.text, e.id).toContain(el.textContent?.replace(/\s+/g, " ").trim());
      }
    }
    expect(found.find((e) => e.id === "dashboard")?.text).toContain("See the dashboard tour.");
  });
});
