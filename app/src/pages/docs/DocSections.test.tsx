// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { copyBlockLabel } from "@/components/shared/CopyBlock";
import { githubAnchor } from "@/lib/docSections";
import { DESIGN } from "@/pages/architecture/design";
import { GUIDE as CLAUDE } from "@/pages/claude/guide";
import { TOUR } from "@/pages/dashboard/tour";
import { renderScreen } from "@/test/render";
import { CONTENTS_FROM, DocSectionsView } from "./DocSections";

const contents = () => screen.queryByRole("navigation", { name: "On this page" });

describe("a page that shows a doc", () => {
  it("lists a long doc's sections, each a link to its heading", () => {
    renderScreen(<DocSectionsView sections={DESIGN} />, { path: "/architecture" });
    const links = within(contents() as HTMLElement).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(DESIGN.map((s) => s.title));
    expect(links.map((l) => l.getAttribute("href"))).toEqual(DESIGN.map((s) => `/architecture#${s.id}`));
    for (const s of DESIGN) expect(document.getElementById(s.id)).toBe(screen.getByRole("region", { name: s.title }));
  });

  it("shows a heading's code as code in the list, not its backticks", () => {
    renderScreen(<DocSectionsView sections={TOUR} />, { path: "/dashboard-tour" });
    const first = within(contents() as HTMLElement).getAllByRole("link")[0] as HTMLElement;
    expect(first).toHaveTextContent("Mesh Doctor: /meshdoctor");
    expect(within(first).getByText("/meshdoctor").tagName).toBe("CODE");
  });

  it(`lists nothing for a doc of fewer than ${CONTENTS_FROM} sections`, () => {
    renderScreen(<DocSectionsView sections={DESIGN.slice(0, CONTENTS_FROM - 1)} />, { path: "/architecture" });
    expect(contents()).toBeNull();
    expect(screen.getAllByRole("region")).toHaveLength(CONTENTS_FROM - 1);
  });

  it("ends with the line saying which doc it follows, under the doc's last section and not in the list", () => {
    renderScreen(<DocSectionsView sections={DESIGN} source="architecture.md" />, { path: "/architecture" });
    const line = screen.getByText(/^This page follows/);
    const last = screen.getByRole("region", { name: DESIGN[DESIGN.length - 1]?.title });
    expect(last.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.parentElement).toBe(last.parentElement?.parentElement);
    expect(contents()?.contains(line)).toBe(false);
  });

  it("puts a button by each heading and sub-heading that copies the address of its section", async () => {
    const user = userEvent.setup(); // its clipboard stands in for the browser's
    renderScreen(<DocSectionsView sections={TOUR} />, { path: "/dashboard-tour" });
    const sub = "Solver A/B test (same page, below the result)";
    expect(screen.getAllByRole("button", { name: /^Copy a link to/ })).toHaveLength(TOUR.length + 1);

    // Beside the heading, not in it: the heading, and the section it names, keep their own names.
    expect(screen.getByRole("heading", { level: 2, name: "Mesh Doctor: /meshdoctor" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Mesh Doctor: /meshdoctor" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy a link to “Mesh Doctor: /meshdoctor”" }));
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/dashboard-tour#${TOUR[0]?.id}`);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: `Copy a link to “${sub}”` }));
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/dashboard-tour#${githubAnchor(sub)}`);
    expect(document.getElementById(githubAnchor(sub))?.tagName).toBe("H3");
  });

  it("puts a button on each code block that copies it as the doc writes it", async () => {
    const user = userEvent.setup(); // its clipboard stands in for the browser's
    renderScreen(<DocSectionsView sections={DESIGN} />, { path: "/architecture" });
    const blocks = DESIGN.flatMap((s) => s.blocks).flatMap((b) => ("code" in b ? [b.code] : []));
    expect(blocks.length).toBeGreaterThan(1);
    expect(screen.getAllByRole("button", { name: /^Copy (the \d+ lines starting )?“/ })).toHaveLength(blocks.length);

    const install = CLAUDE.flatMap((s) => s.blocks).flatMap((b) => ("code" in b ? [b.code] : [])).find((c) => c.includes("/plugin install"));
    renderScreen(<DocSectionsView sections={CLAUDE} />, { path: "/claude-code" });
    await user.click(screen.getByRole("button", { name: copyBlockLabel(install ?? "") }));
    expect(await navigator.clipboard.readText()).toBe(install);
  });
});
