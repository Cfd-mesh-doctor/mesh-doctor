// SPDX-License-Identifier: GPL-3.0-or-later
// The defect clusters the demo can show in 3D: the three worst of its recorded 35° Ahmed body repair, before the
// repair (it left none after). Recorded from the engine's files of that run of the public Ahmed body case, with the
// corners rounded to 0.1 µm, and loaded only when one is opened.
import type { ClusterShape } from "@/engine/types";

export const RECORDED_CLUSTERS = { run: "ahmed35-medium-fix", tag: "before", ids: [0, 1, 2] } as const;

export const DEMO_CLUSTERS_NOTE =
  "The demo recorded the shapes of three clusters only: #1 to #3 of ahmed35-medium-fix, before the repair. Connect " +
  "your own engine to see any cluster in 3D.";

/** A recorded cluster's shapes, or null for one the demo doesn't have. */
export async function recordedCluster(run: string, tag: string, id: number): Promise<ClusterShape | null> {
  const r = RECORDED_CLUSTERS;
  if (run !== r.run || tag !== r.tag || !(r.ids as readonly number[]).includes(id)) return null;
  const all = (await import("./clusters.json")).default as unknown as Record<string, ClusterShape>;
  return all[String(id)] ?? null;
}
