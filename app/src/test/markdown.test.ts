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

  it("reads numbered lists, with their items' indented lines, apart from the lists next to them", () => {
    const md = ["## Steps", "", "1. first,", "   continued", "2. second", "- other", "", "Text", "3. third"].join("\n");
    expect(markdownSections(md)).toEqual([{
      id: "steps",
      title: "Steps",
      blocks: [
        { list: ["first, continued", "second"], numbered: true },
        { list: ["other"] },
        { text: "Text" },
        { list: ["third"], numbered: true },
      ],
    }]);
  });

  it("reads pictures, sub-headings, and lists under a list item", () => {
    const md = [
      "## Two", "", "![A page](images/page.png)", "", "- top:", "  - one,", "    continued;", "  - two.", "- next",
      "", "### Below it", "", "Text", "![After text](images/b.png)",
    ].join("\n");
    expect(markdownSections(md)).toEqual([{
      id: "two",
      title: "Two",
      blocks: [
        { picture: "images/page.png", alt: "A page" },
        { list: [{ text: "top:", list: ["one, continued;", "two."] }, "next"] },
        { heading: "Below it" },
        { text: "Text" },
        { picture: "images/b.png", alt: "After text" },
      ],
    }]);
  });
});
