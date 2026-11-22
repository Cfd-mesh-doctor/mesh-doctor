// SPDX-License-Identifier: GPL-3.0-or-later
// The gallery shows docs/images with the doc's captions, at each picture's real size.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { docHref } from "@/pages/docs/entries";
import { readDoc } from "@/test/markdown";
import { GALLERY } from "./pictures";

const here = dirname(fileURLToPath(import.meta.url));
const doc = readDoc("gallery.md");

describe("the gallery", () => {
  it("has the doc's sections, with the tool that made each", () => {
    const headings = [...doc.matchAll(/^## (.+?): `(.+?)`$/gm)].map((m) => [m[1], m[2]]);
    expect(GALLERY.map((s) => [s.title, s.tool])).toEqual(headings);
  });

  it("has the doc's pictures and captions, in order", () => {
    const pictures = [...doc.matchAll(/^!\[(.+?)\]\(images\/(.+?)\)$/gm)].map((m) => ({ alt: m[1], file: m[2] }));
    expect(GALLERY.flatMap((s) => s.pictures.map(({ alt, file }) => ({ alt, file })))).toEqual(pictures);
  });

  it("links where the doc's section does, to this site's page for the doc it names", () => {
    const sections = doc.split(/^## /m).slice(1).filter((b) => /^.+?: `.+?`$/.test(b.split(/\r?\n/)[0] ?? ""));
    expect(sections).toHaveLength(GALLERY.length);
    expect(GALLERY.map((s) => s.see?.page)).toEqual(sections.map((b) => {
      const target = /\]\(([^)\s]+\.md)\)/.exec(b)?.[1];
      return target && docHref(target);
    }));
  });

  it("gives each picture its real size, so the page does not jump while they load", () => {
    for (const p of GALLERY.flatMap((s) => s.pictures)) {
      const png = readFileSync(resolve(here, "../../../../docs/images", p.file));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], p.file).toEqual([p.width, p.height]);
    }
  });
});
