// SPDX-License-Identifier: GPL-3.0-or-later
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { demoTransport } from "@/demo/transport";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import { renderScreen } from "@/test/render";
import { Cases } from "./Cases";

const path = "/demo/cases";
/** The demo's cases: ahmed-25-coarse, -fine and -medium, ahmed-35-medium and pitzDaily. */
const open = (at: string) => renderScreen(<Cases />, { path, at, transport: demoTransport(undefined, 0) });
/** The table's rows, without its head. */
const rows = () => screen.getAllByRole("row").slice(1);

describe("the Cases screen", () => {
  it("keeps what's typed in its filter box in the address, so a reload or a link keeps it", async () => {
    const { router } = open(`${path}?q=pitz`);
    expect(await screen.findByText("1 of 5 cases")).toBeInTheDocument();
    const box = screen.getByRole("searchbox", { name: "Filter cases" });
    expect(box).toHaveValue("pitz");
    expect(rows()).toHaveLength(1);

    await userEvent.clear(box);
    expect(router.state.location.search).toBe("");
    expect(rows()).toHaveLength(5);

    await userEvent.type(box, "ahmed-25");
    expect(router.state.location.search).toBe("?q=ahmed-25");
    expect(screen.getByText("3 of 5 cases")).toBeInTheDocument();
    expect(rows()).toHaveLength(3);
  });

  it("puts the cursor in its filter box on “/”, as the site's search boxes do", async () => {
    const user = userEvent.setup();
    open(path);
    expect(await screen.findByText("5 of 5 cases")).toBeInTheDocument();
    const box = screen.getByRole("searchbox", { name: "Filter cases" });
    expect(box).toHaveAttribute("aria-keyshortcuts", "/");
    await user.keyboard("/");
    expect(box).toHaveFocus();
    expect(box).toHaveValue("");
  });
});

/** Opens the Cases screen of your own engine with these cases, or whose cases don't load (null). */
function ownEngine(cases: string[] | null, at = "/app/cases") {
  const transport: Transport = {
    kind: "engine",
    scope: "test",
    request: async <T,>(_method: string, path: string) => {
      const route = path.split("?")[0];
      if (route === "/repairs") return { items: [] } as T;
      if (route === "/cases" && cases) return { items: cases } as T;
      throw new EngineError("internal", "internal error; details are in the server window", 500);
    },
  };
  return renderScreen(<Cases />, { path: "/app/cases", at, transport });
}

describe("the Cases screen of your own engine", () => {
  it("with no cases, says where the engine looks and how to point it at another folder", async () => {
    ownEngine([]);
    expect(await screen.findByRole("heading", { name: "No cases found" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy “MESHDOCTOR_CASES=~/cases meshdoctor serve”" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("whose cases didn't load says so under the message that says why, not that nothing matches the filter", async () => {
    ownEngine(null, "/app/cases?q=wing");
    expect(await screen.findByRole("heading", { name: "The cases didn't load" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The engine hit an error");
    expect(screen.queryByRole("heading", { name: "No case matches" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "No cases found" })).toBeNull();
  });

  it("counts one case as “1 of 1 case”, and none shown of it as “0 of 1 case”", async () => {
    ownEngine(["wing"]);
    expect(await screen.findByText("1 of 1 case")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox", { name: "Filter cases" }), "pitz");
    expect(screen.getByText("0 of 1 case")).toBeInTheDocument();
  });
});
