// SPDX-License-Identifier: GPL-3.0-or-later
// The report's defect clusters, before and after the repair, and the 3D view of one. The list is in the report; the
// shapes come only from the engine (GET /repairs/{name}/clusters/{id}), so a report file opened on its own shows
// the list alone. The 3D view (three.js) is loaded the first time a cluster is opened.
import { useQuery } from "@tanstack/react-query";
import { Box, ChevronLeft, ChevronRight } from "lucide-react";
import { lazy, Suspense, useMemo, useRef, useState, type ReactNode } from "react";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { buildShapes, FACE_CLASSES, LOOK, type FaceClass, type PickedFace } from "@/components/three/shapes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/misc";
import { asEngineError } from "@/engine/errors";
import type { ClusterShape } from "@/engine/types";
import { formatCount, formatInt, formatNumber } from "@/lib/format";
import { kindLabel, placeLabel, type ClusterRow, type ClusterTag } from "@/report/clusters";

const ClusterScene = lazy(() => import("@/components/three/ClusterScene"));

/** Where a run's cluster shapes come from: its engine, or the demo's recording. */
export interface ClusterSource {
  /** Where the answers are kept: the engine's scope and the run. */
  key: readonly unknown[];
  load: (tag: ClusterTag, id: number, signal?: AbortSignal) => Promise<ClusterShape>;
  /** What to say when a cluster has no shapes (not-found), instead of the general words. */
  missing?: string;
}

/** How many clusters the list shows first, and how many more at a time. */
const FIRST = 20, MORE = 50;

const LEGEND: Record<FaceClass, string> = {
  hot: "This cluster's failing faces",
  fail: "Other faces that fail a limit",
  near: "Faces near a limit (badness 0.8 to 1)",
  fine: "Faces within the limits",
  wall: "Boundary faces nearby",
};

function details(c: ClusterRow): string {
  return [
    c.faces != null && formatCount(c.faces, "failing face"),
    c.badness != null && `worst badness ${formatNumber(c.badness, 3)}`,
    c.patches.length ? `on ${c.patches.join(", ")}` : "inside the mesh",
    c.centroid && `at ${placeLabel(c.centroid)} m`,
  ].filter((x): x is string => typeof x === "string").join(" · ");
}

export function ClustersCard({ clusters, source }: {
  clusters: { before: ClusterRow[]; after: ClusterRow[] };
  /** The run's engine; without one (a report file) the list has no 3D view. */
  source?: ClusterSource | null;
}) {
  const [tag, setTag] = useState<ClusterTag>("before");
  const [shown, setShown] = useState(FIRST);
  const [open, setOpen] = useState<number | null>(null);
  const rows = clusters[tag];
  return (
    <Card className="mt-4">
      <CardHeader>
        <div>
          <CardTitle>Problem clusters</CardTitle>
          <CardDescription>
            Faces that fail the profile's limits, grouped where they touch, worst first. A face's badness is its worst
            measure divided by that measure's limit, so above 1 fails.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Segmented
          label="Which clusters"
          value={tag}
          onChange={(t) => {
            setTag(t);
            setShown(FIRST);
          }}
          options={[
            { value: "before", label: `Before the repair (${formatInt(clusters.before.length)})` },
            { value: "after", label: `After it (${formatInt(clusters.after.length)})` },
          ]}
        />
        {rows.length ? (
          <ol aria-label={`Clusters ${tag === "before" ? "before" : "after"} the repair`}
            className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border">
            {rows.slice(0, shown).map((c, i) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-4">
                {/* At least 14rem wide, so on a phone the button goes under the words rather than squeezing them. */}
                <div className="min-w-56 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    <span className="tabular-nums">#{formatInt(c.id + 1)}</span>
                    {c.kinds.map((k) => <Badge key={k}>{kindLabel(k)}</Badge>)}
                  </p>
                  <p className="mt-1 text-[13px] break-words text-muted-foreground">{details(c)}</p>
                </div>
                {source && (
                  <Button variant="secondary" size="sm" aria-label={`View cluster ${c.id + 1} in 3D`} onClick={() => setOpen(i)}>
                    <Box />View in 3D
                  </Button>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            {tag === "before" ? "None: every face met the limits before the repair." : "None left: the repair fixed every cluster."}
          </p>
        )}
        {rows.length > shown && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShown((n) => n + MORE)}>
            Show {formatInt(Math.min(MORE, rows.length - shown))} more of {formatInt(rows.length)}
          </Button>
        )}
        {!source && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            A report file holds this list but not the clusters' shapes, so there is no 3D view here. Open the run on
            the app's Repairs screen, connected to its engine, to see each cluster in 3D.
          </p>
        )}
      </CardContent>
      {source && open != null && (
        <ClusterDialog rows={rows} index={open} tag={tag} source={source} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </Card>
  );
}

function ClusterDialog({ rows, index, tag, source, onIndex, onClose }: {
  rows: ClusterRow[];
  index: number;
  tag: ClusterTag;
  source: ClusterSource;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  // Opened from a list, not by a dialog trigger, so it gives the focus back to the button that opened it itself.
  const opener = useRef<HTMLElement | null>(null);
  const c = rows[index];
  if (!c) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-3xl p-4 sm:p-6"
        onOpenAutoFocus={() => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(e) => {
          if (opener.current?.isConnected) {
            e.preventDefault();
            opener.current.focus();
          }
        }}
      >
        <DialogTitle>Cluster #{formatInt(c.id + 1)}, {tag === "before" ? "before the repair" : "after the repair"}</DialogTitle>
        <DialogDescription>{[c.kinds.map(kindLabel).join(", "), details(c)].filter(Boolean).join(". ")}</DialogDescription>
        <ClusterBody key={`${tag}-${c.id}`} row={c} tag={tag} source={source} />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-muted-foreground">{formatInt(index + 1)} of {formatInt(rows.length)}</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={index === 0} onClick={() => onIndex(index - 1)}>
              <ChevronLeft />Previous
            </Button>
            <Button variant="secondary" size="sm" disabled={index >= rows.length - 1} onClick={() => onIndex(index + 1)}>
              Next<ChevronRight />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="mt-4 flex h-[min(55dvh,420px)] items-center justify-center rounded-lg border border-border bg-surface-2 p-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** What a picked face is, in words. Face and cell numbers are names, so they keep no thousands commas. */
function pickedText(p: PickedFace | null): string {
  if (!p) return "Click or tap a face for its numbers.";
  if (p.kind === "wall") return `A boundary face on the patch ${p.patch}.`;
  const state = p.bad > 1 ? "fails its limit" : p.bad > 0.8 ? "is near its limit" : "is within its limits";
  return `Face ${p.face} of ${p.cells.length > 1 ? "cells" : "cell"} ${p.cells.join(" and ")}: badness ${formatNumber(p.bad, 3)}, so it ${state}${
    p.hot ? "; one of this cluster's failing faces" : ""}.`;
}

function ClusterBody({ row, tag, source }: { row: ClusterRow; tag: ClusterTag; source: ClusterSource }) {
  const q = useQuery({
    queryKey: [...source.key, tag, row.id],
    queryFn: ({ signal }) => source.load(tag, row.id, signal),
    staleTime: Infinity, // a finished repair's clusters don't change
  });
  const shapes = useMemo(() => (q.data ? buildShapes(q.data, row.centroid) : null), [q.data, row.centroid]);
  const [picked, setPicked] = useState<PickedFace | null>(null);

  if (q.isError) {
    if (asEngineError(q.error).code === "not-found") {
      return (
        <p role="status" className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {source.missing ?? "The engine has no shapes for this cluster. The repair writes them for every cluster it lists, so this run may have been stopped part way, or made by an older Mesh Doctor."}
        </p>
      );
    }
    return <ErrorPanel className="mt-4" compact error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />;
  }
  if (!shapes) return <Waiting>Asking the engine for the cluster's shapes…</Waiting>;
  const what = `${formatCount(shapes.cellFaces, "face")} of the cells around it (${formatInt(shapes.failing)} failing) and ${
    formatCount(shapes.walls, "boundary face")} nearby`;
  return (
    <>
      <div className="mt-4">
        <Suspense fallback={<Waiting>Loading the 3D view…</Waiting>}>
          <ClusterScene shapes={shapes} extent={row.extent} onPick={setPicked}
            label={`3D view of cluster #${row.id + 1}: ${what}. Arrow keys turn it, + and - zoom, 0 puts it back.`} />
        </Suspense>
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">Shows {what}.</p>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm break-words">{pickedText(picked)}</p>
      <ul aria-label="Colours" className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
        {FACE_CLASSES.map((cls) => (
          <li key={cls} className="flex items-center gap-1.5">
            <span aria-hidden className="size-3 shrink-0 rounded-sm border border-border"
              style={{ background: `var(${LOOK[cls].token})`, opacity: Math.max(LOOK[cls].opacity, 0.45) }} />
            {LEGEND[cls]}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-muted-foreground">
        Drag to turn it, scroll or pinch to zoom, and right-drag or drag with two fingers to move it. With the view
        selected, the arrow keys turn it, + and - zoom, and 0 puts it back.
      </p>
    </>
  );
}
