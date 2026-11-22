// SPDX-License-Identifier: GPL-3.0-or-later
// The Dashboard tour page must say exactly what the doc says, and show each of the doc's pictures at its real size.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { markdownOpening, markdownSections, readDoc } from "@/test/markdown";
import { PICTURES } from "./pictures";
import { INTRO, TITLE, TOUR } from "./tour";

const DOC = readDoc("dashboard.md");
const docs = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../docs");

describe("the Dashboard tour page", () => {
  it("is docs/dashboard.md: its title and opening, then each section's paragraphs, lists, pictures and sub-headings", () => {
    expect(TITLE).toBe(/^# (.+)$/m.exec(DOC)?.[1]);
    expect(markdownOpening(DOC)).toEqual([{ text: INTRO }]);
    expect(markdownSections(DOC)).toEqual(TOUR);
  });

  it("has a built file for each of the doc's pictures, and only those", () => {
    const shown = TOUR.flatMap((s) => s.blocks).flatMap((b) => ("picture" in b ? [b.picture] : []));
    expect(shown).toEqual(["images/meshdoctor.png", "images/cluster.png", "images/ab.png", "images/meshmap.png", "images/run.png"]);
    expect(Object.keys(PICTURES).sort()).toEqual([...shown].sort());
  });

  it("gives each picture its real size, so the page does not jump while they load", () => {
    for (const [path, p] of Object.entries(PICTURES)) {
      const png = readFileSync(resolve(docs, path));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], path).toEqual([p.width, p.height]);
    }
  });
});
