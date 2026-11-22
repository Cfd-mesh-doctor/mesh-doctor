// SPDX-License-Identifier: GPL-3.0-or-later
// A small, made-up report for the unit and browser tests: the shape `meshdoctor report` writes, with
// invented numbers. No imports, so the browser tests (e2e/) can load it too.

export function testReport(): Record<string, unknown> {
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
    },
    documents: {
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
        base: { residuals: { p: { mean: 0.0021 }, Ux: { mean: 0.00104 } }, secondsPerIteration: 0.612 },
        fixed: { residuals: { p: { mean: 0.00105 }, Ux: { mean: 0.000936 } }, secondsPerIteration: 0.598 },
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
