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
/** How many problems the doc has (problems.test.ts holds the page's list to the doc). */
const ALL = GROUPS.flatMap((g) => g.table.rows).length;

describe("Troubleshooting", () => {
  it("shows every problem of the doc, group by group, with its cause and fix", () => {
    renderScreen(<Troubleshooting />, { path: "/troubleshooting" });
    expect(screen.getByRole("heading", { level: 1, name: "Troubleshooting" })).toBeInTheDocument();
    expect(document.title).toBe("Troubleshooting · Mesh Doctor");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(GROUPS.map((g) => g.title));
    expect(problems()).toHaveLength(ALL);
    expect(screen.getByText(`${ALL} problems, in ${GROUPS.length} groups.`)).toBeInTheDocument();

    const first = within(screen.getByRole("region", { name: "Web app" })).getAllByRole("listitem")[0];
    expect(first).toHaveTextContent("You see: \"The engine isn't answering\"");
    expect(first).toHaveTextContent("Why: meshdoctor serve isn't running");
    expect(within(first!).getByText("Try again").tagName).toBe("STRONG");
    expect(within(first!).getAllByText("meshdoctor serve").map((e) => e.tagName)).toEqual(["CODE", "CODE"]);

    // A short flag never splits at its hyphen; code too long for a phone's column may break anywhere.
    expect(screen.getByText("-copyZero")).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("#includeEtc \"caseDicts/setConstraintTypes\"")).not.toHaveClass("whitespace-nowrap");
  });

  it("puts the cursor in its search box on “/”, as the Docs page does", async () => {
    const user = userEvent.setup();
    renderScreen(<Troubleshooting />, { path: "/troubleshooting" });
    const box = screen.getByRole("searchbox", { name: "Search for the message you see" });
    expect(box).toHaveAttribute("aria-keyshortcuts", "/");
    await user.keyboard("/");
    expect(box).toHaveFocus();
    expect(box).toHaveValue("");
  });

  it("narrows to the problems that match what's typed, and keeps it in the address", async () => {
    const { router } = renderScreen(<Troubleshooting />, { path: "/troubleshooting" });
    await userEvent.type(screen.getByRole("searchbox", { name: "Search for the message you see" }), "patchField");
    expect(problems()).toHaveLength(1);
    expect(screen.getByText(`1 of ${ALL} problems matches. Enter goes to it.`)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["OpenFOAM runs"]);
    expect(router.state.location.search).toBe("?q=patchField");
  });

  it("goes to the first problem that matches on Enter: its group in sight, the focus on the problem", async () => {
    const scrolled: Element[] = []; // jsdom has no scrolling: note what would have scrolled into view
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value(this: Element) { scrolled.push(this); },
    });
    try {
      const user = userEvent.setup();
      renderScreen(<Troubleshooting />, { path: "/troubleshooting" });
      const box = screen.getByRole("searchbox", { name: "Search for the message you see" });
      await user.click(box);
      await user.keyboard("{Enter}"); // nothing typed: nothing to go to
      expect(box).toHaveFocus();

      await user.type(box, "meshdoctor serve");
      expect(screen.getByText(new RegExp(`^\\d+ of ${ALL} problems match\\. Enter goes to the first\\.$`))).toBeInTheDocument();
      await user.keyboard("{Enter}");
      const group = screen.getAllByRole("region")[0]!;
      const first = within(group).getAllByRole("listitem")[0]!;
      expect(first).toHaveFocus();
      expect(scrolled).toEqual([group]);
      await user.tab(); // it takes the focus only until it loses it
      expect(first).not.toHaveAttribute("tabindex");
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
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
    expect(problems()).toHaveLength(ALL);
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
