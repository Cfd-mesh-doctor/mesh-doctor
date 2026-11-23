// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderScreen } from "@/test/render";
import { DOCKER, LINUX, SETUP, WSL_INSTALL } from "./commands";
import { Install } from "./Install";

describe("Install", () => {
  it("gives the one-command set-ups first, then every step by hand, each with a copy button", () => {
    renderScreen(<Install />, { path: "/install" });
    expect(screen.getByRole("heading", { level: 1, name: "Install" })).toBeInTheDocument();
    expect(document.title).toBe("Install · Mesh Doctor");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["One command", "By hand", "Then"]);

    const one = within(screen.getByRole("region", { name: "One command" }));
    expect(one.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      `Copy “${SETUP.windows}”`, `Copy “${SETUP.linux}”`,
    ]);
    const byHand = within(screen.getByRole("region", { name: "By hand" }));
    const commands = [WSL_INSTALL, ...LINUX.flatMap((g) => g.commands.map((c) => c.command)), ...DOCKER];
    expect(byHand.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(commands.map((c) => `Copy “${c}”`));
    expect(byHand.getByText("builds foamMeshDoctor and foamResidualHotspots")).toBeInTheDocument();

    const main = within(screen.getByRole("main"));
    expect(main.getByRole("link", { name: "Linux" })).toHaveAttribute("href", "/install#linux");
    expect(main.getByRole("link", { name: "Connect" })).toHaveAttribute("href", "/connect");
    expect(main.getByRole("link", { name: "Size estimator" })).toHaveAttribute("href", "/estimate");
  });

  it("says the one-command set-up puts the meshdoctor command in every new terminal", () => {
    renderScreen(<Install />, { path: "/install" });
    const one = within(screen.getByRole("region", { name: "One command" }));
    expect(one.getByText(/^Puts the/)).toHaveTextContent(
      "Puts the meshdoctor command in every new terminal too: a link in ~/.local/bin.",
    );
  });
});
