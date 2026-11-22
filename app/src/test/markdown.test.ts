// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { markdownCode, markdownOpening, markdownSections, markdownTables } from "./markdown";

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

  it("reads a doc's opening and sections: paragraphs, lists with their indented lines, code under an item, code", () => {
    const md = [
      "# Title", "", "Opening `x`.", "", "```bash", "cp a b", "```", "",
      "## One: first", "", "Text over", "two lines:", "", "- first,", "  continued", "- second:", "", "  ```",
      "  key", "  {", "      value 1;", "  }", "  ```", "- third", "", "- another list", "", "```", "block", "```", "",
    ].join("\n");
    expect(markdownOpening(md)).toEqual([{ text: "Opening `x`." }, { code: "cp a b", lang: "bash" }]);
    expect(markdownSections(md)).toEqual([{
      id: "one-first",
      title: "One: first",
      blocks: [
        { text: "Text over two lines:" },
        { list: ["first, continued", { text: "second:", code: "key\n{\n    value 1;\n}" }, "third"] },
        { list: ["another list"] },
        { code: "block" },
      ],
    }]);
  });
});
