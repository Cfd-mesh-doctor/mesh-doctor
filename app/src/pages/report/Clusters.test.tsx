// SPDX-License-Identifier: GPL-3.0-or-later
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PickedFace, Shapes } from "@/components/three/shapes";
import { EngineError } from "@/engine/errors";
import type { ClusterShape } from "@/engine/types";
import type { ClusterRow } from "@/report/clusters";
import { ClustersCard, type ClusterSource } from "./Clusters";

// The 3D view needs WebGL, which the test browser hasn't: a stand-in shows its label and picks the first or last face.
vi.mock("@/components/three/ClusterScene", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({ shapes, label, onPick }: { shapes: Shapes; label: string; onPick: (f: PickedFace | null) => void }) =>
      h("div", { role: "img", "aria-label": label },
        h("button", { type: "button", onClick: () => onPick(shapes.faces[0] ?? null) }, "Pick the first face"),
        h("button", { type: "button", onClick: () => onPick(shapes.faces.at(-1) ?? null) }, "Pick the last face")),
  };
});

const row = (id: number, more: Partial<ClusterRow> = {}): ClusterRow => ({
  id, kinds: ["abrupt size change"], faces: 3, badness: 2.072, patches: [], centroid: [-0.0029, 0.12198, 0.1238], extent: 0.01, ...more,
});

const SHAPE: ClusterShape = {
  cells: [
    { cell: 3, face: 7, bad: 1.2, hot: true, xyz: [0, 0, 0, 1, 0, 0, 1, 1, 0] },
    { cell: 4, face: 7, bad: 1.2, hot: true, xyz: [0, 0, 0, 1, 0, 0, 1, 1, 0] },
    { cell: 4, face: 9, bad: 0.3, hot: false, xyz: [0, 0, 0, 1, 0, 0, 0, 0, 1] },
  ],
  ctx: [{ patch: "wing", xyz: [0, 0, -1, 1, 0, -1, 1, 1, -1] }],
};

function show(clusters: { before: ClusterRow[]; after: ClusterRow[] }, source?: ClusterSource) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ClustersCard clusters={clusters} source={source} /></QueryClientProvider>);
}

describe("ClustersCard", () => {
  it("lists the clusters worst first, and those left after the repair", async () => {
    show({ before: [row(0), row(1, { kinds: ["non-orthogonal", "skewed"], faces: 1, badness: 1.1, patches: ["wing"] })], after: [] });
    const items = within(screen.getByRole("list", { name: "Clusters before the repair" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "#1Abrupt size change3 failing faces · worst badness 2.07 · inside the mesh · at -0.003, 0.122, 0.124 m",
      "#2Non-orthogonalSkewed1 failing face · worst badness 1.1 · on wing · at -0.003, 0.122, 0.124 m",
    ]);
    await userEvent.click(screen.getByRole("radio", { name: "After it (0)" }));
    expect(screen.getByText("None left: the repair fixed every cluster.")).toBeInTheDocument();
  });

  it("shows 20 at first, then 50 more at a time", async () => {
    show({ before: Array.from({ length: 75 }, (_, i) => row(i)), after: [] });
    const count = () => screen.getAllByRole("listitem").length;
    expect(count()).toBe(20);
    await userEvent.click(screen.getByRole("button", { name: "Show 50 more of 75" }));
    expect(count()).toBe(70);
    await userEvent.click(screen.getByRole("button", { name: "Show 5 more of 75" }));
    expect(count()).toBe(75);
    expect(screen.queryByRole("button", { name: /more of/ })).not.toBeInTheDocument();
  });

  it("has no 3D view in a report file, which holds the list but not the shapes", () => {
    show({ before: [row(0)], after: [] });
    expect(screen.queryByRole("button", { name: /in 3D/ })).not.toBeInTheDocument();
    expect(screen.getByText(/A report file holds this list but not the clusters' shapes/)).toBeInTheDocument();
  });

  it("opens a cluster in 3D, says what a picked face is, steps through the list and gives the focus back", async () => {
    const load = vi.fn(async () => SHAPE);
    show({ before: [row(0), row(1)], after: [] }, { key: ["engine", "cluster", "wing-fix"], load });
    const opener = screen.getByRole("button", { name: "View cluster 1 in 3D" });
    await userEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Cluster #1, before the repair" });
    const view = await within(dialog).findByRole("img");
    expect(view).toHaveAccessibleName(
      "3D view of cluster #1: 2 faces of the cells around it (1 failing) and 1 boundary face nearby. Arrow keys turn it, + and - zoom, 0 puts it back.");
    expect(load).toHaveBeenCalledWith("before", 0, expect.any(AbortSignal));
    expect(within(dialog).getByText("Click or tap a face for its numbers.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Pick the first face" }));
    expect(within(dialog).getByText(
      "Face 7 of cells 3 and 4: badness 1.2, so it fails its limit; one of this cluster's failing faces.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Pick the last face" }));
    expect(within(dialog).getByText("A boundary face on the patch wing.")).toBeInTheDocument();

    expect(within(dialog).getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Cluster #2, before the repair" })).toBeInTheDocument();
    await waitFor(() => expect(load).toHaveBeenLastCalledWith("before", 1, expect.any(AbortSignal)));
    expect(screen.getByText("Click or tap a face for its numbers.")).toBeInTheDocument(); // a new cluster, nothing picked
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText("2 of 2")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("says why a cluster has no shapes, in the source's words when it has some", async () => {
    const missing = new EngineError("not-found", "no cluster 0 (before)", 404);
    show({ before: [row(0)], after: [] }, { key: ["demo", "cluster", "x"], load: async () => Promise.reject(missing), missing: "Only three are recorded." });
    await userEvent.click(screen.getByRole("button", { name: "View cluster 1 in 3D" }));
    expect(await screen.findByText("Only three are recorded.")).toBeInTheDocument();
  });

  it("shows the engine's other errors with a retry", async () => {
    const load = vi.fn(async (): Promise<ClusterShape> => Promise.reject(new EngineError("unreachable", "no answer", 0)));
    show({ before: [row(0)], after: [] }, { key: ["engine", "cluster", "y"], load });
    await userEvent.click(screen.getByRole("button", { name: "View cluster 1 in 3D" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });
});
