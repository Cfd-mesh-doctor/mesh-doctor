// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { docHref } from "@/pages/docs/entries";
import { renderScreen } from "@/test/render";
import { LIMITS } from "./sections";
import { Limits } from "./Limits";

describe("Limits", () => {
  it("shows the doc's sections, with its bold, code and links", () => {
    renderScreen(<Limits />, { path: "/limits" });
    expect(screen.getByRole("heading", { level: 1, name: "Limits" })).toBeInTheDocument();
    expect(document.title).toBe("Limits · Mesh Doctor");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(LIMITS.map((s) => s.title));

    const not = within(screen.getByRole("region", { name: "What Mesh Doctor is not" }));
    expect(not.getAllByRole("listitem")).toHaveLength(3);
    expect(not.getByText("Converged is not the same as correct.").tagName).toBe("STRONG");
    expect(not.getByText("snappyHexMesh").tagName).toBe("CODE");

    const dashboard = within(screen.getByRole("region", { name: "The dashboard" }));
    expect(dashboard.getByRole("link", { name: "safety" })).toHaveAttribute("href", docHref("safety.md"));

    // The experimental tools' commands are code inside bold, and the section has paragraphs around its list.
    const tools = within(screen.getByRole("region", { name: "Experimental tools" }));
    const ratchet = tools.getByText("meshdoctor experimental ratchet <case> <name>");
    expect(ratchet.tagName).toBe("CODE");
    expect(ratchet.parentElement?.tagName).toBe("STRONG");
    expect(tools.getByText(/^These are command-line only/)).toBeInTheDocument();
    expect(tools.getByText(/^Both work on a copy/)).toBeInTheDocument();
  });
});
