// SPDX-License-Identifier: GPL-3.0-or-later
// The Troubleshooting page states the doc's problems and fixes: they must match the doc they come from.
import { describe, expect, it } from "vitest";
import { column } from "@/lib/docTable";
import { markdownTables, readDoc, readRepo } from "@/test/markdown";
import { GROUPS } from "./problems";

const DOC = readDoc("troubleshooting.md");

describe("the Troubleshooting page's problems", () => {
  it("are the tables of docs/troubleshooting.md, cell for cell, under its headings", () => {
    expect(markdownTables(DOC)).toEqual(GROUPS.map((g) => g.table));
    expect([...DOC.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(GROUPS.map((g) => g.title));
  });

  it("use the anchors GitHub gives the doc's headings, so a link to a group works on both", () => {
    const github = (title: string) => title.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s/g, "-");
    expect(GROUPS.map((g) => g.id)).toEqual(GROUPS.map((g) => github(g.title)));
  });

  it("quote the web app's messages as the app words them, so searching for what's on screen finds them", () => {
    const web = GROUPS.find((g) => g.id === "web-app");
    const quoted = column(web!.table, "You see").flatMap((seen) => /^"(.+)"$/.exec(seen)?.slice(1) ?? []);
    expect(quoted).toHaveLength(4);
    const errors = readRepo("app/src/engine/errors.ts");
    for (const message of quoted) expect(errors, message).toContain(`title: "${message}"`);
  });
});
