// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  HEAT, decodeDensity, defectRadius, defectText, frame, heatStyle, heatText, mapLabel, mapSummary, nearestMark,
  viewHeading, type MapView,
} from "./map";
import { summarize } from "./summary";
import { testMap, testReport } from "./testReport";
import { checkReport } from "./read";

const bytes = (...b: number[]) => btoa(String.fromCharCode(...b));
const view = (over: Partial<MapView> = {}): MapView =>
  ({ name: "side", axes: [0, 2], lo: [0, 0], hi: [2, 1], nx: 0, ny: 0, data: "", ...over });

describe("repair map", () => {
  it("reads the map document of a report", () => {
    const m = mapSummary(testMap())!;
    expect(m.views.map((v) => v.name)).toEqual(["side", "top"]);
    expect(m.views[0]).toMatchObject({ axes: [0, 2], lo: [-0.72, -0.06], hi: [0.57, 0.45], nx: 129, ny: 51 });
    expect(m.before).toHaveLength(4);
    expect(m.after[0]).toMatchObject({ c: [-0.3, 0.1, 0.05], n: 1, kinds: ["skewed"], patches: ["body"], nonOrtho: 40.2 });
    expect(m.layers).toHaveLength(1);
    expect(m.layers[0]!.cells).toHaveLength(60);
    expect(m.layers[0]!.cells[0]).toEqual({ at: [0.47, 0.02, 0.12], change: 9.5 });
    expect(m.notes).toEqual(["Made-up map for the tests."]);
    expect(summarize(checkReport(testReport({ map: true }))).map?.before).toHaveLength(4);
    expect(summarize(checkReport(testReport())).map).toBeNull();
  });

  it("copes with odd map documents", () => {
    expect(mapSummary(undefined)).toBeNull();
    expect(mapSummary("map")).toBeNull();
    expect(mapSummary({ side: { lo: [0, 0], hi: [0, 1] } })).toBeNull(); // no width
    const m = mapSummary({
      axes: { side: [0, 7] },
      side: { lo: [0, 0], hi: [1, 1], nx: 2.5, ny: -1, data: 3 },
      defectsBefore: [{ c: [1, 2] }, { c: [1, 2, 3], n: -4 }, "x"],
      hot: [{ cells: [[1, 2, 3, "big"], [1, 2]] }, { label: "empty", cells: [] }],
    })!;
    expect(m.views).toEqual([view({ lo: [0, 0], hi: [1, 1] })]);
    expect(m.before).toEqual([{ c: [1, 2, 3], n: 1, kinds: [], patches: [], nonOrtho: null, skew: null }]);
    expect(m.after).toEqual([]);
    expect(m.layers).toEqual([{ label: "Layer 1", cells: [{ at: [1, 2, 3], change: null }] }]);
  });

  it("decodes the wall-face picture: blurred, lifted, at most 55 % dark", () => {
    const a = decodeDensity({ nx: 3, ny: 2, data: bytes(255, 0, 0, 0, 0, 0) })!;
    expect(Array.from(a).map((x) => Number(x.toFixed(4)))).toEqual([0.3174, 0.2489, 0, 0.3174, 0.2489, 0]);
    expect(Array.from(decodeDensity({ nx: 2, ny: 1, data: bytes(255, 255) })!)).toEqual([0.55, 0.55].map(Math.fround));
    expect(decodeDensity({ nx: 3, ny: 1, data: bytes(1, 2) })).toBeNull(); // wrong length
    expect(decodeDensity({ nx: 1, ny: 1, data: "**" })).toBeNull(); // not base64
    expect(decodeDensity({ nx: 5000, ny: 1000, data: bytes(1) })).toBeNull(); // too big to draw
    expect(decodeDensity({ nx: 0, ny: 0, data: "" })).toBeNull();
  });

  it("keeps the model's proportions on the canvas", () => {
    const f = frame(view(), 400, 560);
    expect([f.ox, f.w, f.h]).toEqual([0, 400, 200]);
    expect([f.X(0), f.X(2), f.Y(1), f.Y(0)]).toEqual([0, 400, 0, 200]);
    const g = frame(view(), 400, 100); // too tall: narrower, centred
    expect([g.ox, g.w, g.h, g.X(0), g.X(2)]).toEqual([100, 200, 100, 100, 300]);
  });

  it("ranks heat cells and words the read-outs", () => {
    expect(heatStyle(0, 100)).toEqual({ color: HEAT[3], alpha: 0.95, radius: 3.4000000000000004 });
    expect(heatStyle(99, 100).color).toBe(HEAT[0]);
    const m = mapSummary(testMap())!;
    expect(heatText(m.layers[0]!, 0)).toEqual(["Residual swing, last 50 iterations", "rank 1 of 60 · change 9.5× RMS"]);
    const d = { c: [0.1234, 0, 0.5] as [number, number, number], n: 3, kinds: ["skewed"], patches: ["body"], nonOrtho: 71.3, skew: 1.2 };
    expect(defectText(d, false)).toEqual([
      "Defect found and repaired", "3 faces: skewed", "non-ortho 71.3° · skew 1.2", "on body", "at (0.123, 0.000, 0.500) m",
    ]);
    expect(defectText({ ...d, n: 1, kinds: [], patches: [], nonOrtho: null, skew: null }, true)).toEqual([
      "Defect left after the repair", "1 face", "at (0.123, 0.000, 0.500) m",
    ]);
    expect([defectRadius({ ...d, n: 1 }), defectRadius({ ...d, n: 100 })]).toEqual([2.5, 8]);
    expect(viewHeading(m.views[0]!)).toBe("x along the flow, z up");
    expect(viewHeading(m.views[1]!)).toBe("x along the flow, y across");
    expect(mapLabel(m, m.views[0]!, null)).toBe(
      "Side view of the model's wall faces (x along the flow, z up), with 4 defects found and repaired and 1 defect left");
    expect(mapLabel({ ...m, after: [] }, m.views[1]!, m.layers[0]!)).toMatch(/and no defects left, and the 60 strongest cells/);
  });

  it("finds the mark under the pointer", () => {
    const marks = [{ px: 10, py: 10, lines: ["a"] }, { px: 15, py: 10, lines: ["b"] }];
    expect(nearestMark(marks, 14, 10)?.lines).toEqual(["b"]);
    expect(nearestMark(marks, 40, 40)).toBeNull();
    expect(nearestMark(marks, 30, 10, 16)?.lines).toEqual(["b"]);
  });
});
