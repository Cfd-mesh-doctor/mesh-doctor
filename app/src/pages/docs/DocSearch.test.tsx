// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderScreen } from "@/test/render";
import { Docs } from "./Docs";
import { SHOWN } from "./DocSearch";
import { SEARCHED } from "./searchIndex";

const box = () => screen.getByRole("searchbox", { name: "Search all the docs" });
const results = () => screen.findByRole("region", { name: "Search results" });

describe("the Docs page's search", () => {
  it("lists the sections that hold the words typed, each a link to its heading, with the words marked", async () => {
    const user = userEvent.setup();
    renderScreen(<Docs />, { path: "/docs" });
    expect(screen.queryByRole("region", { name: "Search results" })).toBeNull();

    await user.type(box(), "sigkill");
    const jobs = within(await results()).getByRole("link", { name: "Jobs" });
    expect(jobs).toHaveAttribute("href", "/architecture#jobs");
    const item = jobs.closest("li") as HTMLElement;
    expect(item.firstElementChild).toHaveTextContent("Architecture");
    expect(within(item).getByText("SIGKILL").tagName).toBe("MARK");
    expect(screen.getByText(/^\d+ match(es)?\.$/)).toBeInTheDocument();

    // The page's own lists stay below.
    expect(screen.getByRole("region", { name: "On this site" })).toBeInTheDocument();
  });

  it("opens at the search the address holds; a Troubleshooting group opens at the problems that match", async () => {
    renderScreen(<Docs />, { path: "/docs", at: "/docs?q=patchField" });
    expect(box()).toHaveValue("patchField");
    const group = within(await results()).getByRole("link", { name: "OpenFOAM runs" });
    expect(group).toHaveAttribute("href", "/troubleshooting?q=patchField#openfoam-runs");
  });

  it(`lists the first ${SHOWN} and says how many more there are`, async () => {
    renderScreen(<Docs />, { path: "/docs", at: "/docs?q=the" });
    const region = await results();
    expect(within(region).getAllByRole("listitem")).toHaveLength(SHOWN);
    expect(within(region).getByText(new RegExp(`^The first ${SHOWN} of \\d+\\. Add a word to find fewer\\.$`))).toBeInTheDocument();
  });

  it("says where it looked when no section holds the words, and clears with the box", async () => {
    const user = userEvent.setup();
    renderScreen(<Docs />, { path: "/docs" });
    await user.type(box(), "quantumflux");
    expect(await screen.findByText("Nothing in the docs holds “quantumflux”.")).toBeInTheDocument();
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(
      `looks in the text of ${SEARCHED[0]}, .+ and ${SEARCHED.at(-1)}, and in what this page says about the others\\.$`,
    ))).toBeInTheDocument();

    await user.clear(box());
    expect(screen.queryByText(/^Nothing/)).toBeNull();
    expect(screen.queryByRole("region", { name: "Search results" })).toBeNull();
  });
});
