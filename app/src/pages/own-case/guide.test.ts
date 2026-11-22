// SPDX-License-Identifier: GPL-3.0-or-later
// The Your own case page tells you how to turn the tested example into your case: it must say exactly what the doc says.
import { describe, expect, it } from "vitest";
import { docNames, markdownOpening, markdownSections, readDoc } from "@/test/markdown";
import { COPY, GUIDE, INTRO, TITLE } from "./guide";

const DOC = readDoc("templates.md");

describe("the Your own case page's text", () => {
  it("is docs/templates.md: its title, opening and copy command, then each section's paragraphs, lists and code", () => {
    expect(TITLE).toBe(/^# (.+)$/m.exec(DOC)?.[1]);
    expect(markdownOpening(DOC)).toEqual([{ text: INTRO }, { code: COPY, lang: "bash" }]);
    expect(markdownSections(DOC)).toEqual(GUIDE);
  });

  it("keeps the wheel's boundary condition with the list item that introduces it", () => {
    const variant = GUIDE.find((s) => s.title.startsWith("Variant: wheel and wing"));
    const items = variant?.blocks.flatMap((b) => ("list" in b ? b.list : [])) ?? [];
    expect(items.filter((item) => typeof item !== "string")).toEqual([
      { text: expect.stringMatching(/^Rotating wheel, in `initial\/U`/), code: expect.stringMatching(/^model_wheel\n\{\n {4}type/) },
    ]);
  });

  it("links only to docs the repository has", () => {
    for (const [, target] of JSON.stringify(GUIDE).matchAll(/\]\(([^)#\s]+)/g)) expect(docNames()).toContain(target);
  });
});
