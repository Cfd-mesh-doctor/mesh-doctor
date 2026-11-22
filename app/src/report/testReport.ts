// SPDX-License-Identifier: GPL-3.0-or-later
// A small, made-up report for the unit and browser tests: the shape `meshdoctor report` writes, with
// invented numbers. No imports, so the browser tests (e2e/) can load it too.

/** 60 iterations of residuals falling at `rate` per iteration, with a little wobble. */
function history(rate: number) {
  const it = Array.from({ length: 60 }, (_, i) => i + 1);
  const fall = (scale: number) => it.map((i) => Number((scale * rate ** i * (1 + 0.15 * Math.sin(i))).toPrecision(4)));
  return { Time: it, p: fall(1), Ux: fall(0.4) };
}

/**
 * A density picture of a made-up model, a box standing on the ground: `body` is [u0, u1, v0, v1] in the
 * view's units; its outline is dark, its inside light, the rest empty. Rows top first, as the engine writes.
 */
function picture(nx: number, ny: number, lo: number[], hi: number[], body: number[]) {
  const [u0, u1, v0, v1] = body as [number, number, number, number];
  const bytes: number[] = [];
  for (let row = 0; row < ny; row++) {
    const v = hi[1]! - ((row + 0.5) / ny) * (hi[1]! - lo[1]!);
    for (let col = 0; col < nx; col++) {
      const u = lo[0]! + ((col + 0.5) / nx) * (hi[0]! - lo[0]!);
      const inside = u >= u0 && u <= u1 && v >= v0 && v <= v1;
      const edge = inside && Math.min(u - u0, u1 - u, v - v0, v1 - v) < 0.02;
      bytes.push(edge ? 230 : inside ? 70 : 0);
    }
  }
  return { nx, ny, lo, hi, data: btoa(String.fromCharCode(...bytes)) };
}

/** A repair map (meshdoctor map) of the made-up model: 4 defects found and repaired, 1 left, one heat layer. */
export function testMap(): Record<string, unknown> {
  const defect = (c: number[], n: number, kinds: string[], nonOrtho: number, skew: number) =>
    ({ c, n, sev: 1, kinds, patches: ["body"], nonOrtho, skew });
  return {
    schemaVersion: "1.0",
    name: "ahmed25-fine-fix",
    source: "cases/ahmed-25-fine",
    bin: 0.01,
    nCells: 1_565_115,
    axes: { side: [0, 2], top: [0, 1] },
    ground: ["ground"],
    notes: ["Made-up map for the tests."],
    side: picture(129, 51, [-0.72, -0.06], [0.57, 0.45], [-0.6, 0.45, 0.05, 0.33]),
    top: picture(129, 41, [-0.72, -0.1], [0.57, 0.31], [-0.6, 0.45, 0, 0.19]),
    defectsBefore: [1, 2, 3, 4].map((i) => defect([0.1 * i - 0.1, 0.03 * i, 0.33], 3, ["non-orthogonal"], 71.3, 1.2)),
    defectsAfter: [defect([-0.3, 0.1, 0.05], 1, ["skewed"], 40.2, 4.1)],
    hot: [{
      label: "Residual swing, last 50 iterations",
      case: "workspace/ahmed25-fine-fix_ab/fixed",
      cells: Array.from({ length: 60 }, (_, i) =>
        [0.47 + 0.0015 * i, 0.02 + 0.002 * i, 0.12 + 0.0025 * i, Number((9.5 - 0.14 * i).toFixed(2))]),
    }],
  };
}

export function testReport({ map = false }: { map?: boolean } = {}): Record<string, unknown> {
  const sha = (c: string) => c.repeat(64);
  return {
    schemaVersion: "1.0",
    kind: "meshdoctor-report",
    name: "ahmed25-fine-fix",
    created: "2026-11-21T19:20:00Z",
    generator: { meshdoctor: "0.1.0", openfoam: "14" },
    redacted: { paths: 7, note: "paths on the worker replaced by workspace/..., cases/... or the file name" },
    contents: {
      repair: { schemaVersion: "1.0", sha256: sha("a"), bytes: 48_211, problems: [] },
      abtest: { schemaVersion: "1.0", sha256: sha("b"), bytes: 96_540, problems: [] },
      ...(map ? { map: { schemaVersion: "1.0", sha256: sha("c"), bytes: 12_480, problems: [] } } : {}),
    },
    documents: {
      ...(map ? { map: testMap() } : {}),
      repair: {
        schemaVersion: "1.0",
        case: "workspace/ahmed25-fine-fix",
        source: "cases/ahmed-25-fine",
        profile: "fix",
        finished: "2026-11-21 19:01:32",
        layout: { nCells: 1_565_115, parallel: false, nProcs: 1 },
        maxDisplacement_m: 0.000412,
        checkMeshBefore: {
          meshOK: false, failedChecks: 1, nWrongPyramids: 3, nSevereNonOrtho: 12, maxNonOrtho: 71.34,
          avgNonOrtho: 7.215, maxSkewness: 3.912, minVolRatio: 0.0312,
        },
        checkMeshAfter: {
          meshOK: true, failedChecks: 0, nWrongPyramids: 0, nSevereNonOrtho: 0, maxNonOrtho: 64.91,
          avgNonOrtho: 7.207, maxSkewness: 4.105, minVolRatio: 0.0312,
        },
        verdict: {
          improved: ["failedChecks", "nWrongPyramids", "nSevereNonOrtho", "maxNonOrtho", "avgNonOrtho"],
          regressions: ["maxSkewness"],
          unchanged: ["minVolRatio"],
        },
        clustersBefore: [1, 2, 3, 4].map((id) => ({ id, centroid: [0.1 * id, 0, 0.2], kinds: ["nonOrtho"], nFaces: 3, severity: 1, worst: { badness: 2 } })),
        clustersAfter: [{ id: 1, centroid: [0.2, 0, 0.2], kinds: ["skew"], nFaces: 1, severity: 0.3, worst: { badness: 1.1 } }],
        sourceCheck: { unchanged: true },
        runs: [],
        targets: {},
      },
      abtest: {
        schemaVersion: "1.0",
        label: "ahmed25-fine-fix",
        source: "cases/ahmed-25-fine",
        started: "2026-11-21T19:02:00Z",
        finished: "2026-11-21T19:18:41Z",
        iters: 300,
        init: "0",
        nProcs: 4,
        variant: "",
        window: 50,
        base: { residuals: { p: { mean: 0.0021 }, Ux: { mean: 0.00104 } }, secondsPerIteration: 0.612, residualHistory: history(0.92) },
        fixed: { residuals: { p: { mean: 0.00105 }, Ux: { mean: 0.000936 } }, secondsPerIteration: 0.598, residualHistory: history(0.9) },
        residualRatioFixedOverBase: { p: 0.5, Ux: 0.9, k: null },
        fixedJudge: {
          schemaVersion: "1.1",
          verdict: "converged",
          group: "body",
          average: { Cd: { mean: 0.3012, u: 0.0021 }, Cl: { mean: -0.0811, u: 0.004 } },
          flags: ["lift still drifting slowly"],
          window: 100,
          axes: { flow: "x", up: "z", vertical: "lift" },
        },
      },
    },
  };
}
