// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { buildShapes, faceClass, type FaceClass } from "./shapes";

const quad = (z: number) => [0, 0, z, 1, 0, z, 1, 1, z, 0, 1, z];

describe("buildShapes", () => {
  it("draws each face once, in its kind's layer, as a fan of triangles around the cluster's middle", () => {
    const s = buildShapes({
      cells: [
        { cell: 3, face: 7, bad: 1.2, hot: true, xyz: quad(0) },
        { cell: 3, face: 8, bad: 0.9, hot: false, xyz: quad(1) },
        { cell: 4, face: 7, bad: 1.2, hot: true, xyz: quad(0) }, // the same face, listed for its other cell
        { cell: 4, face: 9, bad: 0.2, hot: false, xyz: [0, 0, 0, 1, 0, 0, 0, 0, -1] },
        { cell: 5, face: 10, bad: 1.5, hot: false, xyz: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0.5, 1.5, 0, 0, 1, 0] },
        { cell: 5, face: 11, bad: 3, hot: false, xyz: [0, 0, 0, 1, 0, 0] }, // two corners: not a face
      ],
      ctx: [{ patch: "wing", xyz: quad(-1) }],
    }, [0.5, 0.5, 0]);
    expect(s.faces).toEqual([
      { kind: "cell", face: 7, cells: [3, 4], bad: 1.2, hot: true },
      { kind: "cell", face: 8, cells: [3], bad: 0.9, hot: false },
      { kind: "cell", face: 9, cells: [4], bad: 0.2, hot: false },
      { kind: "cell", face: 10, cells: [5], bad: 1.5, hot: false },
      { kind: "wall", patch: "wing" },
    ]);
    expect([s.cellFaces, s.failing, s.walls]).toEqual([4, 1, 1]);
    const triangles = (c: FaceClass) => s.layers[c].owner.length;
    expect(["hot", "fail", "near", "fine", "wall"].map((c) => triangles(c as FaceClass))).toEqual([2, 3, 2, 1, 2]);
    expect([...s.layers.fail.owner]).toEqual([3, 3, 3]); // the pentagon, as three triangles
    expect([...s.layers.hot.positions.slice(0, 9)]).toEqual([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0]);
    expect(s.layers.hot.edges.length).toBe(4 * 6); // four sides, two corners each
    expect(s.radius).toBeCloseTo(Math.sqrt(1.5));
    expect(s.corners.map((c) => c.length)).toEqual([12, 12, 9, 15, 12]);
  });

  it("starts from the corners' middle when the cluster's isn't known, and a face listed as failing once fails", () => {
    const tri = [0, 0, 0, 2, 0, 0, 2, 2, 0];
    const s = buildShapes({
      cells: [{ cell: 1, face: 2, bad: 1.1, hot: false, xyz: tri }, { cell: 2, face: 2, bad: 1.1, hot: true, xyz: tri }],
      ctx: [],
    });
    expect(s.origin).toEqual([4 / 3, 2 / 3, 0]);
    expect(s.faces).toEqual([{ kind: "cell", face: 2, cells: [1, 2], bad: 1.1, hot: true }]);
    expect([s.layers.hot.owner.length, s.layers.fail.owner.length]).toEqual([1, 0]);
  });

  it("keeps two faces with one number apart when their corners differ, as in a decomposed case", () => {
    const s = buildShapes({
      cells: [{ cell: 1, face: 5, bad: 0.1, hot: false, xyz: quad(0) }, { cell: 1, face: 5, bad: 0.1, hot: false, xyz: quad(2) }],
      ctx: [],
    }, [0, 0, 0]);
    expect(s.cellFaces).toBe(2);
  });

  it("draws nothing for a cluster with no faces", () => {
    const s = buildShapes({ cells: [], ctx: [] });
    expect([s.origin, s.radius, s.faces.length, s.layers.fine.positions.length]).toEqual([[0, 0, 0], 0, 0, 0]);
  });
});

describe("faceClass", () => {
  it("goes by badness: above 1 fails, above 0.8 is near, and the cluster's own failing faces come first", () => {
    const of = (bad: number, hot = false) => faceClass({ bad, hot });
    expect([of(0.5, true), of(1.01), of(1), of(0.81), of(0.8)]).toEqual(["hot", "fail", "near", "near", "fine"]);
  });
});
