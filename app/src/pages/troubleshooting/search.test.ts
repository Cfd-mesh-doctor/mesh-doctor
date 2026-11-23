// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { GROUPS } from "./problems";
import { matcher, plain } from "./search";

const ALL = GROUPS.flatMap((g) => g.table.rows);
const found = (query: string) => ALL.filter(matcher(ALL, query)).map((row) => row[0]);

describe("finding a problem", () => {
  it("shows every problem while nothing is typed", () => {
    expect(found("")).toHaveLength(ALL.length);
    expect(found("   ")).toHaveLength(ALL.length);
  });

  it("finds the words typed anywhere in a problem, in any case or order", () => {
    expect(found("patchfield")).toEqual(["`Cannot find patchField entry for procBoundary...`"]);
    expect(found("battery SLOWER")).toEqual(["The run is 2-3x slower than expected"]);
  });

  it("finds a whole message pasted from a log, with more around it than the doc writes", () => {
    expect(found("--> FOAM FATAL ERROR: Cannot find patchField entry for procBoundary0to1"))
      .toEqual(["`Cannot find patchField entry for procBoundary...`"]);
    expect(found("ModuleNotFoundError: No module named meshdoctor")).toEqual(["`No module named meshdoctor`"]);
  });

  it("reads curly and straight quotes alike", () => {
    expect(plain("“The engine isn’t answering”")).toBe("the engine isn't answering");
    expect(found("“The engine isn’t answering”")).toEqual(["\"The engine isn't answering\""]);
  });

  it("finds a web app error, and only it, by the title its error panel links with", () => {
    const quoted = GROUPS.find((g) => g.id === "web-app")!.table.rows.map((r) => r[0] ?? "").filter((s) => /^".+"$/.test(s));
    expect(quoted).toHaveLength(9);
    for (const seen of quoted) expect(found(seen.slice(1, -1))).toEqual([seen]);
    // ...though every word of one is in another problem too: a few of them typed find both.
    expect(found("with that name already exists")).toEqual([
      "\"A run with that name already exists\"", "\"An A/B test with that name already exists\""]);
  });

  it("finds nothing for words no problem has", () => {
    expect(found("quantum flux capacitor")).toEqual([]);
  });
});
