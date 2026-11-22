// SPDX-License-Identifier: GPL-3.0-or-later
// The "How it works" page states the engine's quality targets and verdicts: they must match the doc they come from.
import { describe, expect, it } from "vitest";
import { markdownTables, readDoc } from "@/test/markdown";
import { COMMANDS, PROFILES, VERDICTS } from "./tables";

describe("the How it works page's tables", () => {
  it("are the tables of docs/how-it-works.md, cell for cell", () => {
    expect(markdownTables(readDoc("how-it-works.md"))).toEqual([COMMANDS, PROFILES, VERDICTS]);
  });
});
