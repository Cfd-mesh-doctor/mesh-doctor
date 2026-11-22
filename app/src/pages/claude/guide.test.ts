// SPDX-License-Identifier: GPL-3.0-or-later
// The Claude Code page tells you how to install and use the repository's plugin: it must say exactly what the doc says.
import { describe, expect, it } from "vitest";
import { docNames, markdownOpening, markdownSections, readDoc } from "@/test/markdown";
import { GUIDE, INTRO, TITLE } from "./guide";

const DOC = readDoc("claude.md");

describe("the Claude Code page's text", () => {
  it("is docs/claude.md: its title and opening, then each section's paragraphs, lists and code", () => {
    expect(TITLE).toBe(/^# (.+)$/m.exec(DOC)?.[1]);
    expect(markdownOpening(DOC)).toEqual([{ text: INTRO }]);
    expect(markdownSections(DOC)).toEqual(GUIDE);
  });

  it("shows the commands that install the plugin", () => {
    const code = GUIDE.flatMap((s) => s.blocks).flatMap((b) => ("code" in b ? [b.code] : []));
    expect(code.join("\n")).toContain("/plugin marketplace add Cfd-mesh-doctor/mesh-doctor");
  });

  it("links only to docs the repository has", () => {
    for (const [, target] of JSON.stringify(GUIDE).matchAll(/\]\(([^)#\s]+)/g)) expect(docNames()).toContain(target);
  });
});
