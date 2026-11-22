// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DOCS, REPO_URL } from "@/lib/site";
import { renderScreen } from "@/test/render";
import { Docs } from "./Docs";
import { ON_GITHUB, ON_SITE } from "./entries";

describe("Docs", () => {
  it("lists the site's own pages, then the docs on GitHub, each with a line about it", () => {
    renderScreen(<Docs />, { path: "/docs" });
    expect(screen.getByRole("heading", { level: 1, name: "Docs" })).toBeInTheDocument();
    expect(document.title).toBe("Docs · Mesh Doctor");

    const here = within(screen.getByRole("region", { name: "On this site" }));
    expect(here.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]))
      .toEqual(ON_SITE.map((d) => [d.title, d.page]));
    expect(here.getByText(/what a repair changed in the mesh/)).toBeInTheDocument();

    const github = within(screen.getByRole("region", { name: "On GitHub" }));
    const links = github.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["README", ...ON_GITHUB.map((d) => d.title)]);
    expect(github.getByRole("link", { name: "README" })).toHaveAttribute("href", DOCS.readme);
    expect(github.getByRole("link", { name: "Limits" })).toHaveAttribute("href", `${REPO_URL}/blob/main/docs/limits.md`);
    expect(github.getByText(/What Mesh Doctor is not/)).toBeInTheDocument();
    for (const a of links) expect(a).toHaveAttribute("target", "_blank");
  });
});
