// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderScreen } from "@/test/render";
import { HowItWorks } from "./HowItWorks";

describe("How it works", () => {
  it("lists the seven steps, and each contents link leads to its step", async () => {
    const { router } = renderScreen(<HowItWorks />, { path: "/how-it-works" });
    expect(screen.getByRole("heading", { level: 1, name: "How Mesh Doctor works" })).toBeInTheDocument();
    expect(document.title).toBe("How it works · Mesh Doctor");
    const steps = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(steps).toEqual([
      "Each step is a command", "01Detect", "02Highlight", "03Correct", "04Did it help? The A/B test",
      "05The convergence judge", "06Hotspots and the map", "07The dashboard",
    ]);

    const links = within(screen.getByRole("navigation", { name: "On this page" })).getAllByRole("link");
    expect(links).toHaveLength(7);
    for (const a of links) {
      const id = a.getAttribute("href")?.split("#")[1] ?? "";
      const step = document.getElementById(id);
      expect(step, a.textContent ?? "").not.toBeNull();
      expect(within(step as HTMLElement).getByRole("heading", { level: 2 }).textContent).toBe(a.textContent);
    }
    await userEvent.click(screen.getByRole("link", { name: "The convergence judge" }));
    expect(router.state.location).toMatchObject({ pathname: "/how-it-works", hash: "#judge" });
  });

  it("shows the doc's tables, with its code as code", () => {
    renderScreen(<HowItWorks />, { path: "/how-it-works" });
    const commands = screen.getByRole("table", { name: "What each command needs and gives" });
    expect(within(commands).getAllByRole("row")).toHaveLength(7);
    expect(within(commands).getByText("constant/polyMesh").tagName).toBe("CODE");

    const profiles = screen.getByRole("table", { name: "The targets of each profile" });
    const strict = within(profiles).getByRole("row", { name: /strict/ });
    expect(within(strict).getAllByRole("cell").map((c) => c.textContent)).toEqual(["strict", "60°", "3", "4", "0.1", "0.05"]);

    const verdicts = screen.getByRole("table", { name: "The verdicts for a steady run" });
    expect(within(verdicts).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0]?.textContent)).toEqual([
      "converged", "statistically steady", "still converging", "not converged",
    ]);
  });
});
