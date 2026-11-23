// SPDX-License-Identifier: GPL-3.0-or-later
// A defect cluster's faces as triangles for its 3D view, without three.js, so it can be tested on its own. The
// engine lists a face once for each listed cell it belongs to; here each face comes once (the same face number and
// the same corners), split into a fan of triangles from its first corner, as the engine's own viewer does. Every
// corner is moved so the cluster's middle is at 0, 0, 0: a graphics card works in 32-bit numbers, which would make
// a cluster of 1 mm cells shake when it is a metre or more from the mesh's origin.
import type { ClusterShape } from "@/engine/types";

/** How a face is drawn: this cluster's failing faces; other faces that fail a limit (badness above 1); those near
 *  one (above 0.8); the rest; and the boundary faces nearby. */
export type FaceClass = "hot" | "fail" | "near" | "fine" | "wall";
export const FACE_CLASSES: readonly FaceClass[] = ["hot", "fail", "near", "fine", "wall"];

/** Each kind's colour (one of the app's CSS colours, so it follows light and dark) and how solid it is drawn. Kept
 *  here, not with the view, so the legend can use it without loading three.js. */
export const LOOK: Record<FaceClass, { token: string; opacity: number }> = {
  hot: { token: "--chart-5", opacity: 1 },
  fail: { token: "--danger", opacity: 1 },
  near: { token: "--warning", opacity: 1 },
  fine: { token: "--primary", opacity: 0.3 },
  wall: { token: "--muted-foreground", opacity: 0.2 },
};

export function faceClass(f: { bad: number; hot: boolean }): Exclude<FaceClass, "wall"> {
  if (f.hot) return "hot";
  if (f.bad > 1) return "fail";
  if (f.bad > 0.8) return "near";
  return "fine";
}

/** What the view says about a face when it is clicked or tapped. */
export type PickedFace =
  | { kind: "cell"; face: number; cells: number[]; bad: number; hot: boolean }
  | { kind: "wall"; patch: string };

export interface Layer {
  /** x, y, z of the three corners of each triangle. */
  positions: Float32Array;
  /** Which face (its place in `faces`) each triangle is part of. */
  owner: Int32Array;
  /** Each polygon's sides, as pairs of corners. */
  edges: Float32Array;
}

export interface Shapes {
  layers: Record<FaceClass, Layer>;
  /** Every face drawn; a layer's `owner` points into it. */
  faces: PickedFace[];
  /** Each face's corners, moved like the layers (for the outline of a picked face). */
  corners: Float32Array[];
  /** The point moved to 0, 0, 0, in metres. */
  origin: [number, number, number];
  /** How far the farthest corner is from 0, 0, 0. */
  radius: number;
  /** How many faces of the cells there are, and how many of them fail in this cluster. */
  cellFaces: number;
  failing: number;
  walls: number;
}

interface Polygon {
  cls: FaceClass;
  xyz: number[];
  info: PickedFace;
}

export function buildShapes(shape: ClusterShape, centre?: [number, number, number] | null): Shapes {
  const polys: Polygon[] = [];
  const seen = new Map<string, Polygon>();
  for (const f of shape.cells) {
    if (f.xyz.length < 9) continue;
    // A decomposed case numbers faces per processor, so the corners say whether two listings are one face.
    const key = `${f.face}:${f.xyz.join(",")}`;
    const had = seen.get(key);
    if (had && had.info.kind === "cell") {
      if (!had.info.cells.includes(f.cell)) had.info.cells.push(f.cell);
      if (f.hot && !had.info.hot) {
        had.info.hot = true;
        had.cls = "hot";
      }
      continue;
    }
    const p: Polygon = { cls: faceClass(f), xyz: f.xyz, info: { kind: "cell", face: f.face, cells: [f.cell], bad: f.bad, hot: f.hot } };
    seen.set(key, p);
    polys.push(p);
  }
  const cellFaces = polys.length;
  for (const w of shape.ctx) {
    if (w.xyz.length >= 9) polys.push({ cls: "wall", xyz: w.xyz, info: { kind: "wall", patch: w.patch } });
  }

  const origin = centre ?? mean(polys);
  const count = Object.fromEntries(FACE_CLASSES.map((c) => [c, { tris: 0, sides: 0 }])) as Record<FaceClass, { tris: number; sides: number }>;
  for (const p of polys) {
    const m = Math.floor(p.xyz.length / 3);
    count[p.cls].tris += m - 2;
    count[p.cls].sides += m;
  }
  const layers = Object.fromEntries(FACE_CLASSES.map((c) => [c, {
    positions: new Float32Array(count[c].tris * 9),
    owner: new Int32Array(count[c].tris),
    edges: new Float32Array(count[c].sides * 6),
  }])) as Record<FaceClass, Layer>;
  const at = Object.fromEntries(FACE_CLASSES.map((c) => [c, { tri: 0, side: 0 }])) as Record<FaceClass, { tri: number; side: number }>;
  const corners: Float32Array[] = [];
  let radius = 0;
  polys.forEach((p, i) => {
    const m = Math.floor(p.xyz.length / 3);
    const v = new Float32Array(m * 3);
    for (let k = 0; k < m * 3; k++) v[k] = (p.xyz[k] ?? 0) - (origin[k % 3] ?? 0);
    for (let k = 0; k < m; k++) radius = Math.max(radius, Math.hypot(v[3 * k] ?? 0, v[3 * k + 1] ?? 0, v[3 * k + 2] ?? 0));
    corners.push(v);
    const L = layers[p.cls], n = at[p.cls];
    for (let k = 1; k < m - 1; k++) {
      L.positions.set(v.subarray(0, 3), n.tri * 9);
      L.positions.set(v.subarray(3 * k, 3 * k + 6), n.tri * 9 + 3);
      L.owner[n.tri++] = i;
    }
    for (let k = 0; k < m; k++) {
      const j = (k + 1) % m;
      L.edges.set(v.subarray(3 * k, 3 * k + 3), n.side * 6);
      L.edges.set(v.subarray(3 * j, 3 * j + 3), n.side * 6 + 3);
      n.side++;
    }
  });
  return {
    layers,
    faces: polys.map((p) => p.info),
    corners,
    origin,
    radius,
    cellFaces,
    failing: polys.filter((p) => p.cls === "hot").length,
    walls: polys.length - cellFaces,
  };
}

/** The middle of every corner, or 0, 0, 0 for none. */
function mean(polys: Polygon[]): [number, number, number] {
  const s = [0, 0, 0];
  let n = 0;
  for (const p of polys) {
    for (let k = 0; k + 2 < p.xyz.length; k += 3) {
      for (let d = 0; d < 3; d++) s[d] = (s[d] ?? 0) + (p.xyz[k + d] ?? 0);
      n++;
    }
  }
  return n ? [(s[0] ?? 0) / n, (s[1] ?? 0) / n, (s[2] ?? 0) / n] : [0, 0, 0];
}
