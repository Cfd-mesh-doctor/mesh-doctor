// SPDX-License-Identifier: GPL-3.0-or-later
// A repair's defect clusters (groups of faces that fail the profile's limits, where they touch), from the repair
// document's clustersBefore and clustersAfter lists, worst first as the engine sorts them. A report file can come
// from anywhere, so every value is checked: a cluster without a usable number is left out, an odd field reads "–".
import { arr, num, obj, strs } from "./values";

export type ClusterTag = "before" | "after";

export interface ClusterRow {
  /** The engine's number for it, which GET /repairs/{name}/clusters/{id} takes; the list counts from 1. */
  id: number;
  /** What is wrong, in the engine's words ("non-orthogonal", "abrupt size change", ...). */
  kinds: string[];
  /** How many of the mesh's faces fail in it. */
  faces: number | null;
  /** Its worst face's badness: that face's worst measure divided by the measure's target, so above 1 fails. */
  badness: number | null;
  /** The patches its failing faces are on; none means inside the mesh. */
  patches: string[];
  /** Its middle, in metres. */
  centroid: [number, number, number] | null;
  /** Its largest side in metres, and at least six cell sizes: how far away its 3D view starts. */
  extent: number | null;
}

function point(v: unknown): [number, number, number] | null {
  const a = arr(v).map(num);
  const [x, y, z] = a;
  return a.length === 3 && x != null && y != null && z != null ? [x, y, z] : null;
}

export function clusterRows(list: unknown): ClusterRow[] {
  const rows: ClusterRow[] = [];
  for (const c of arr(list)) {
    const o = obj(c), id = num(o.id);
    if (id == null || !Number.isInteger(id) || id < 0) continue;
    const [lo, hi] = arr(o.bbox).map(point), h = num(o.h);
    const sides = lo && hi ? [0, 1, 2].map((k) => (hi[k] ?? 0) - (lo[k] ?? 0)) : [];
    const extent = Math.max(0, ...sides, h == null ? 0 : 6 * h);
    rows.push({
      id,
      kinds: strs(o.kinds),
      faces: num(o.nFaces),
      badness: num(obj(o.worst).badness),
      patches: strs(o.patches),
      centroid: point(o.centroid),
      extent: extent > 0 ? extent : null,
    });
  }
  return rows;
}

/** "Abrupt size change" for "abrupt size change". */
export function kindLabel(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** A place in metres, to the millimetre: "-0.003, 0.122, 0.124". */
export function placeLabel(p: [number, number, number]): string {
  return p.map((v) => String(Number(v.toFixed(3)) || 0)).join(", ");
}
