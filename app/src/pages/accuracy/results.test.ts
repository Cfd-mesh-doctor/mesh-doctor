// SPDX-License-Identifier: GPL-3.0-or-later
// The accuracy page quotes the validation run: its numbers and commands must be the doc's.
import { describe, expect, it } from "vitest";
import { markdownCode, markdownTables, readDoc } from "@/test/markdown";
import { RESULTS, RUN, cases, readable } from "./results";

describe("the accuracy check's results", () => {
  const doc = readDoc("validation.md");

  it("are the table and commands of docs/validation.md", () => {
    expect(markdownTables(doc)).toEqual([RESULTS]);
    expect(markdownCode(doc)).toEqual([RUN]);
  });

  it("read as numbers for the chart", () => {
    const [coarse, medium, , steep] = cases();
    expect(coarse).toMatchObject({ name: "Coarse mesh, 25° slant", cells: "0.48 M", cd: 0.299, tunnel: 0.285, miss: false });
    expect(medium).toMatchObject({ difference: "−1.7 %", drift: "−0.02 %", cl: 0.295, time: "27 min" });
    expect(steep).toMatchObject({ name: "35° slant, medium mesh", cd: 0.408, tunnel: 0.26, difference: "+57 %", miss: true });
  });

  it("are shown in the page's words", () => {
    expect(readable("25 deg")).toBe("25°");
    expect(readable("-0.11 %")).toBe("−0.11 %");
    expect(readable("+4.8 %")).toBe("+4.8 %");
    expect(readable("0.48 M")).toBe("0.48 M");
  });
});
