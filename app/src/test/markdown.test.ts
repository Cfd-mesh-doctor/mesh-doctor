// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { markdownCode, markdownTables } from "./markdown";

describe("reading the docs", () => {
  it("finds the tables the way the docs write them", () => {
    const md = "text\n\n| A | B |\n|---|---|\n| `x`, `y` | 1 % |\n\nmore\n| C |\n|---|\n";
    expect(markdownTables(md)).toEqual([
      { head: ["A", "B"], rows: [["`x`, `y`", "1 %"]] },
      { head: ["C"], rows: [] },
    ]);
  });

  it("finds the code blocks", () => {
    const md = "Run:\n\n```bash\n. env\n./Allrun 6   # ranks\n```\n\nThen\n```\nnext\n```\n";
    expect(markdownCode(md)).toEqual([[". env", "./Allrun 6   # ranks"], ["next"]]);
  });
});
