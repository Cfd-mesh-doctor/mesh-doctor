// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderScreen } from "@/test/render";
import { GROUPS } from "./problems";
import { Troubleshooting } from "./Troubleshooting";

/** The problems shown: the items of each group's list (the page's "On this page" list is a list too). */
const problems = () => screen.queryAllByRole("region").flatMap((g) => within(g).queryAllByRole("listitem"));
const contents = () => screen.queryByRole("navigation", { name: "On this page" });

describe("Troubleshooting", () => {
  it("shows every problem of the doc, group by group, with its cause and fix", () => {
    renderScreen(<Troubleshooting />, { path: "/troubleshooting" });
    expect(screen.getByRole("heading", { level: 1, name: "Troubleshooting" })).toBeInTheDocument();
    expect(document.title).toBe("Troubleshooting · Mesh Doctor");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(GROUPS.map((g) => g.title));
    expect(problems()).toHaveLength(36);
    expect(screen.getByText("36 problems, in 7 groups.")).toBeInTheDocument();

    const first = within(screen.getByRole("region", { name: "Web app" })).getAllByRole("listitem")[0];
    expect(first).toHaveTextContent("You see: \"The engine isn't answering\"");
    expect(first).toHaveTextContent("Why: meshdoctor serve isn't running");
    expect(within(first!).getByText("Try again").tagName).toBe("STRONG");
    expect(within(first!).getAllByText("meshdoctor serve").map((e) => e.tagName)).toEqual(["CODE", "CODE"]);

    // A short flag never splits at its hyphen; code too long for a phone's column may break anywhere.
    expect(screen.getByText("-copyZero")).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("#includeEtc \"caseDicts/setConstraintTypes\"")).not.toHaveClass("whitespace-nowrap");
  });

  it("narrows to the problems that match what's typed, and keeps it in the address", async () => {
    const { router } = renderScreen(<Troubleshooting />, { path: "/troubleshooting" });
    await userEvent.type(screen.getByRole("searchbox", { name: "Search for the message you see" }), "patchField");
    expect(problems()).toHaveLength(1);
    expect(screen.getByText("1 of 36 problems matches.")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["OpenFOAM runs"]);
    expect(router.state.location.search).toBe("?q=patchField");
  });

  it("opens at the problems a link names, and offers them all back when nothing matches", async () => {
    renderScreen(<Troubleshooting />, { path: "/troubleshooting", at: "/troubleshooting?q=Safari" });
    const search = screen.getByRole("searchbox", { name: "Search for the message you see" });
    expect(search).toHaveValue("Safari");
    expect(problems()).toHaveLength(1);

    await userEvent.clear(search);
    await userEvent.type(search, "quantum flux");
    expect(screen.getByText("No problem matches.")).toBeInTheDocument();
    expect(screen.getByText("Nothing here matches “quantum flux”.")).toBeInTheDocument();
    expect(problems()).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Show all problems" }));
    expect(problems()).toHaveLength(36);
    expect(search).toHaveValue("");
  });

  it("lists the groups that show beside them, each link keeping the search", async () => {
    renderScreen(<Troubleshooting />, { path: "/troubleshooting" });
    const links = () => within(contents() as HTMLElement).getAllByRole("link");
    expect(links().map((a) => a.textContent)).toEqual(GROUPS.map((g) => g.title));

    const search = screen.getByRole("searchbox", { name: "Search for the message you see" });
    await userEvent.type(search, "patchField");
    const runs = GROUPS.find((g) => g.title === "OpenFOAM runs");
    expect(links().map((a) => a.getAttribute("href"))).toEqual([`/troubleshooting?q=patchField#${runs?.id}`]);

    await userEvent.clear(search);
    await userEvent.type(search, "quantum flux");
    expect(contents()).toBeNull();
  });

  it("puts a button by each group's heading that copies its address, with the search", async () => {
    const user = userEvent.setup(); // its clipboard stands in for the browser's
    renderScreen(<Troubleshooting />, { path: "/troubleshooting", at: "/troubleshooting?q=patchField" });
    const runs = GROUPS.find((g) => g.title === "OpenFOAM runs");
    expect(screen.getAllByRole("button", { name: /^Copy a link to/ })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "OpenFOAM runs" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy a link to “OpenFOAM runs”" }));
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/troubleshooting?q=patchField#${runs?.id}`);
  });
});
