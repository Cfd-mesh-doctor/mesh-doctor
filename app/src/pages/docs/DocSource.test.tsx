// SPDX-License-Identifier: GPL-3.0-or-later
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { docNames } from "@/test/markdown";
import { pageAt } from "@/test/pages";
import { renderScreen } from "@/test/render";
import { DocSource } from "./DocSource";
import { ON_GITHUB, ON_SITE, githubDoc } from "./entries";

describe("the line saying which doc a page follows", () => {
  it("names the doc and links to it on GitHub, in a new tab", () => {
    render(<DocSource file="limits.md" />);
    expect(screen.getByText(/^This page follows/)).toHaveTextContent("This page follows docs/limits.md in the source.");
    const doc = screen.getByRole("link", { name: "docs/limits.md" });
    expect(doc).toHaveAttribute("href", githubDoc("limits.md"));
    expect(doc).toHaveAttribute("target", "_blank");
    expect(doc).toHaveAttribute("rel", "noreferrer");
  });

  // Every page the Docs page lists for a doc in docs/ says which one, so a reader can check it against the source
  // (Accuracy, Gallery and How it works in their own words).
  const shown = ON_SITE.flatMap((d) => (d.file && d.page ? [[d.title, d.page, d.file] as const] : []));
  it.each(shown)("%s (%s) says it follows docs/%s", async (_, path, file) => {
    const Page = await pageAt(path);
    renderScreen(<Page />, { path });
    const doc = screen.getByRole("link", { name: `docs/${file}` });
    expect(doc).toHaveAttribute("href", githubDoc(file));
    expect(doc.closest("p")?.textContent?.replace(/\s+/g, " ")).toContain(`This page follows docs/${file} in the source.`);
  });

  it("is checked on every doc in docs/ that has a page", () => {
    const onGithub = ON_GITHUB.map((d) => d.file);
    expect(shown.map(([, , file]) => file).sort()).toEqual(docNames().filter((f) => !onGithub.includes(f)));
  });
});
