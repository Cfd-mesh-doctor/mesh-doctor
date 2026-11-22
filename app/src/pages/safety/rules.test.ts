// SPDX-License-Identifier: GPL-3.0-or-later
// The Safety model page states what Mesh Doctor promises: it must say exactly what the doc says.
import { describe, expect, it } from "vitest";
import { docNames, markdownSections, readDoc } from "@/test/markdown";
import { INTRO, SAFETY } from "./rules";

const DOC = readDoc("safety.md");

describe("the Safety model page's text", () => {
  it("is docs/safety.md: its opening paragraph, then each section's paragraphs and list items", () => {
    const opening = (DOC.split(/\r?\n## /)[0] ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("# "));
    expect(INTRO).toBe(opening.join(" "));
    expect(markdownSections(DOC)).toEqual(SAFETY);
  });

  it("links only to docs the repository has", () => {
    const targets = [...JSON.stringify(SAFETY).matchAll(/\]\(([^)#\s]+)/g)].map((m) => m[1]);
    expect(targets).toEqual(["how-it-works.md", "limits.md"]);
    for (const target of targets) expect(docNames()).toContain(target);
  });
});
