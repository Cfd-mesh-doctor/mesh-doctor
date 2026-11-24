// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderScreen } from "@/test/render";
import { SAFETY } from "./rules";
import { Safety } from "./Safety";

describe("Safety model", () => {
  it("shows the doc's opening and sections, and its links open this site's pages", () => {
    renderScreen(<Safety />, { path: "/safety" });
    expect(screen.getByRole("heading", { level: 1, name: "Safety model" })).toBeInTheDocument();
    expect(document.title).toBe("Safety model · Mesh Doctor");
    expect(screen.getByText(/^Mesh Doctor is built so that it cannot damage a case you care about/)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(SAFETY.map((s) => s.title));
    expect(within(screen.getByRole("region", { name: "The dashboard answers only you" })).getAllByRole("listitem"))
      .toHaveLength(12);
    expect(screen.getByRole("link", { name: "limits" })).toHaveAttribute("href", "/limits");
    expect(screen.getByRole("link", { name: "how it works" })).toHaveAttribute("href", "/how-it-works");
  });
});
