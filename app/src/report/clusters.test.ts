// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { clusterRows, kindLabel, placeLabel } from "./clusters";
import { checkReport } from "./read";
import sample from "./samples/ahmed35-medium-fix.mdreport.json";
import { summarize } from "./summary";

describe("clusterRows", () => {
  it("reads each cluster, sized by its box or six cells across, whichever is bigger", () => {
    const rows = clusterRows([
      { id: 0, kinds: ["non-orthogonal"], nFaces: 3, severity: 1, worst: { badness: 1.5 }, centroid: [1, 2, 3],
        bbox: [[0.9, 1.95, 2.99], [1.1, 2.05, 3.01]], h: 0.01, patches: ["wing"] },
      { id: 1, kinds: ["skewed"], nFaces: 1, worst: {}, centroid: [0, 0], h: 0.1 },
    ]);
    expect(rows).toEqual([
      { id: 0, kinds: ["non-orthogonal"], faces: 3, badness: 1.5, patches: ["wing"], centroid: [1, 2, 3], extent: expect.closeTo(0.2, 9) },
      { id: 1, kinds: ["skewed"], faces: 1, badness: null, patches: [], centroid: null, extent: expect.closeTo(0.6, 9) },
    ]);
  });

  it("leaves out a cluster without a usable number, and finds none in what isn't a list", () => {
    const rows = clusterRows([{ id: -1 }, { id: 1.5 }, { id: "2" }, null, { id: 3, h: "x", bbox: [[0, 0]] }]);
    expect(rows.map((r) => [r.id, r.faces, r.extent, r.kinds])).toEqual([[3, null, null, []]]);
    expect(clusterRows({ id: 0 })).toEqual([]);
  });

  it("finds the recorded 35° repair's 26 clusters before it, worst first, and none after", () => {
    const { clusters } = summarize(checkReport(sample));
    expect([clusters.before.length, clusters.after.length]).toEqual([26, 0]);
    const [first] = clusters.before;
    expect(first).toMatchObject({ id: 0, kinds: ["abrupt size change"], faces: 3, patches: [] });
    expect(first?.badness).toBeCloseTo(2.072, 3);
    expect(placeLabel(first?.centroid ?? [0, 0, 0])).toBe("-0.003, 0.122, 0.124");
    expect(clusters.before.map((c) => c.id)).toEqual([...Array(26).keys()]);
  });

  it("words a kind and a place", () => {
    expect(kindLabel("abrupt size change")).toBe("Abrupt size change");
    expect(placeLabel([0.00012, -0.0004, 1.23456])).toBe("0, 0, 1.235");
  });
});
