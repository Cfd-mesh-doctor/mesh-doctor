// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { repairCommand } from "./commands";

describe("a case's repair command", () => {
  it("names the copy after the case, with a name no run has yet", () => {
    expect(repairCommand("wing", [])).toBe("meshdoctor full wing wing-fix");
    expect(repairCommand("wing", ["wing-fix"])).toBe("meshdoctor full wing wing-fix-2");
    expect(repairCommand("wing", ["wing-fix", "wing-fix-2", "other-fix"])).toBe("meshdoctor full wing wing-fix-3");
    expect(repairCommand("wing", ["wing-fix-2"])).toBe("meshdoctor full wing wing-fix"); // the first free name
  });

  it("keeps the copy's name within the engine's 80 characters", () => {
    const long = "c".repeat(80);
    expect(repairCommand(long, [])).toBe(`meshdoctor full ${long} ${"c".repeat(76)}-fix`);
    expect(repairCommand(long, [`${"c".repeat(76)}-fix`])).toBe(`meshdoctor full ${long} ${"c".repeat(74)}-fix-2`);
  });

  it("gives none for a case the engine can't find by its name", () => {
    for (const name of ["my case", ".hidden", "-x", "a/b", "", "c".repeat(81), "a;rm"]) {
      expect(repairCommand(name, []), name).toBeNull();
    }
    expect(repairCommand("a.b_c-7", [])).toBe("meshdoctor full a.b_c-7 a.b_c-7-fix");
  });
});
