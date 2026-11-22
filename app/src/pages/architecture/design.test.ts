// SPDX-License-Identifier: GPL-3.0-or-later
// The Architecture page must say exactly what the doc says.
import { describe, expect, it } from "vitest";
import { docNames, markdownOpening, markdownSections, readDoc } from "@/test/markdown";
import { DESIGN, INTRO, TITLE } from "./design";

const DOC = readDoc("architecture.md");

describe("the Architecture page's text", () => {
  it("is docs/architecture.md: its title and opening, then each section's paragraphs, lists, tables and code", () => {
    expect(TITLE).toBe(/^# (.+)$/m.exec(DOC)?.[1]);
    expect(markdownOpening(DOC)).toEqual([{ text: INTRO }]);
    expect(markdownSections(DOC)).toEqual(DESIGN);
  });

  it("has each of the doc's six tables, under its own header (the diagram's \"|\" lines are no table)", () => {
    const tables = DESIGN.flatMap((s) => s.blocks).flatMap((b) => ("table" in b ? [b.table] : []));
    const heads = [...DOC.matchAll(/^\|(.+)\|\r?\n\|[-| ]+\|$/gm)].map((m) => m[1]?.split("|").map((c) => c.trim()));
    expect(heads).toHaveLength(6);
    expect(tables.map((t) => t.head)).toEqual(heads);
  });

  it("links only to docs the repository has", () => {
    for (const [, target] of JSON.stringify(DESIGN).matchAll(/\]\(([^)#\s]+)/g)) expect(docNames()).toContain(target);
  });
});
