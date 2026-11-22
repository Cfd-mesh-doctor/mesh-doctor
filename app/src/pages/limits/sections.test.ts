// SPDX-License-Identifier: GPL-3.0-or-later
// The Limits page states what Mesh Doctor can't do: it must say exactly what the doc says.
import { describe, expect, it } from "vitest";
import { docNames, markdownSections, readDoc } from "@/test/markdown";
import { LIMITS } from "./sections";

describe("the Limits page's text", () => {
  it("is docs/limits.md, section by section, paragraph by paragraph and item by item", () => {
    expect(markdownSections(readDoc("limits.md"))).toEqual(LIMITS);
  });

  it("links only to docs the repository has", () => {
    const targets = [...JSON.stringify(LIMITS).matchAll(/\]\(([^)#\s]+)/g)].map((m) => m[1]);
    expect(targets).toEqual(["safety.md"]);
    for (const target of targets) expect(docNames()).toContain(target);
  });
});
