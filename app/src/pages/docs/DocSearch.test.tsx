// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderScreen } from "@/test/render";
import { Docs } from "./Docs";
import { SHOWN } from "./DocSearch";

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
    expect(screen.getByText(/^(1 match\. Enter opens it|\d+ matches\. Enter opens the first)\.$/)).toBeInTheDocument();

    // The page's own lists stay below.
    expect(screen.getByRole("region", { name: "On this site" })).toBeInTheDocument();
  });

  it("puts the cursor in the box on “/”, and a “/” typed in it stays", async () => {
    const user = userEvent.setup();
    renderScreen(<Docs />, { path: "/docs" });
    expect(box()).toHaveAttribute("aria-keyshortcuts", "/");
    expect(within(screen.getByRole("search")).getByText("/").tagName).toBe("KBD");
    expect(box()).not.toHaveFocus();
    await user.keyboard("/");
    expect(box()).toHaveFocus();
    expect(box()).toHaveValue("");
    await user.keyboard("a/b");
    expect(box()).toHaveValue("a/b");
    expect(within(screen.getByRole("search")).queryByText("/")).toBeNull();
  });

  it("opens the first match on Enter, and stays when nothing matches", async () => {
    const user = userEvent.setup();
    const { router } = renderScreen(<Docs />, { path: "/docs" });
    await user.type(box(), "qqqzzz");
    expect(await screen.findByText("Nothing matches.")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(router.state.location.pathname).toBe("/docs");

    await user.clear(box());
    await user.type(box(), "sigkill");
    const first = within(await results()).getAllByRole("link")[0];
    expect(screen.getByText(/Enter opens/)).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("elsewhere")).toBeInTheDocument();
    const { pathname, search, hash } = router.state.location;
    expect(pathname + search + hash).toBe(first?.getAttribute("href"));
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
    expect(screen.getByText(
      "Try one distinctive word, such as a file or utility name. The search reads every page listed below except " +
      "Report viewer and Size estimator, which it finds by what this page says about them.",
    )).toBeInTheDocument();

    await user.clear(box());
    expect(screen.queryByText(/^Nothing/)).toBeNull();
    expect(screen.queryByRole("region", { name: "Search results" })).toBeNull();
  });
});
