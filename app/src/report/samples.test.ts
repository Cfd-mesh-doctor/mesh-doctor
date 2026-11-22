// SPDX-License-Identifier: GPL-3.0-or-later
// The viewer's sample reports are real `meshdoctor report` files: they must stay readable as the format grows.
import { describe, expect, it } from "vitest";
import { checkReport } from "./read";
import a25 from "./samples/ahmed25-medium-fix.mdreport.json";
import a35 from "./samples/ahmed35-medium-fix.mdreport.json";
import { summarize } from "./summary";

describe("sample reports", () => {
  it("the 25° report holds a repair and a solver A/B test with residual histories", () => {
    const s = summarize(checkReport(a25));
    expect(s.name).toBe("ahmed25-medium-fix");
    expect(s.caseName).toBe("ahmed-25-medium");
    expect(s.ab?.rows.length).toBeGreaterThan(0);
    expect(s.ab?.history.fields).toContain("p");
    expect(s.map).toBeNull();
  });

  it("the 35° report holds a repair and its map", () => {
    const s = summarize(checkReport(a35));
    expect(s.name).toBe("ahmed35-medium-fix");
    expect(s.clustersBefore).toBe(26);
    expect(s.map?.before).toHaveLength(26);
    expect(s.map?.views.map((v) => v.name)).toEqual(["side", "top"]);
    expect(s.ab).toBeNull();
  });

  it("hold no folder paths of the computer that made them", () => {
    for (const r of [a25, a35]) {
      expect(JSON.stringify(r)).not.toMatch(/\/home\/|\/mnt\/|[A-Z]:\\\\|\\\\wsl/i);
    }
  });
});
