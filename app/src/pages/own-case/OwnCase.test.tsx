// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderScreen } from "@/test/render";
import { COPY, GUIDE, TITLE } from "./guide";
import { OwnCase } from "./OwnCase";

describe("Your own case", () => {
  it("shows the doc's title, the copy command and the sections, with the wheel's settings under their list item", () => {
    renderScreen(<OwnCase />, { path: "/your-own-case" });
    expect(screen.getByRole("heading", { level: 1, name: TITLE })).toBeInTheDocument();
    expect(document.title).toBe("Your own case · Mesh Doctor");
    expect(screen.getByText(/^is a complete, tested external-aero case/)).toBeInTheDocument();
    expect(screen.getByText(COPY)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(GUIDE.map((s) => s.title));
    const variant = screen.getByRole("region", { name: /^Variant: wheel and wing/ });
    const wheel = within(variant).getAllByRole("listitem").find((li) => li.textContent?.startsWith("Rotating wheel"));
    expect(wheel?.querySelector("pre")?.textContent).toMatch(/^model_wheel\n\{\n {4}type +rotatingWallVelocity;/);
  });
});
