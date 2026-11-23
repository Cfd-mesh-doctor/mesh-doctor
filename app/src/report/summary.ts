// SPDX-License-Identifier: GPL-3.0-or-later
// What a report says, worked out from its documents. A report file can come from anywhere, so every
// value is checked before it is used: a missing or odd field gives "–", never a broken page.
import { clusterRows, type ClusterRow } from "./clusters";
import { mapSummary, type MapSummary } from "./map";
import type { Report } from "./read";
import { arr, num, obj, str, strs, type Obj } from "./values";

/** checkMesh's numbers, in the order the engine's pages show them. */
const CHECKMESH: [string, string][] = [
  ["nWrongPyramids", "Inverted face pyramids"],
  ["nBadTets", "Bad face tets"],
  ["maxNonOrtho", "Max non-orthogonality (°)"],
  ["avgNonOrtho", "Mean non-orthogonality (°)"],
  ["nSevereNonOrtho", "Severely non-orthogonal faces"],
  ["maxSkewness", "Max skewness"],
  ["nSkew", "Highly skewed faces"],
  ["nLowWeight", "Low-weight faces"],
  ["minWeight", "Min face weight"],
  ["nSmallDeterminant", "Small-determinant cells"],
  ["minDeterminant", "Min cell determinant"],
  ["nConcaveCells", "Concave cells"],
  ["nLowVolRatio", "Low volume-ratio faces"],
  ["minVolRatio", "Min volume ratio"],
  ["failedChecks", "Failed checkMesh checks"],
];

export function measureLabel(key: string): string {
  return CHECKMESH.find(([k]) => k === key)?.[1] ?? key;
}

export type Change = "better" | "worse" | null;

export interface CheckRow {
  key: string;
  label: string;
  before: number | null;
  after: number | null;
  change: Change;
}

export interface AbRow {
  field: string;
  original: number | null;
  repaired: number | null;
  /** repaired ÷ original mean residual: below 1 the repaired mesh converges further */
  ratio: number;
  change: Change;
}

/** One run's residual history: iteration numbers and, per field, the initial residual at each. */
export interface HistoryRun {
  x: number[];
  y: Record<string, (number | null)[]>;
}

export interface JudgeSummary {
  verdict: string;
  group: string;
  averages: { name: string; mean: number; u: number | null }[];
  flags: string[];
  window: number | null;
  transient: boolean;
  flow: string | null;
  up: string | null;
}

export interface DocumentRow {
  key: string;
  label: string;
  version: string;
  bytes: number | null;
  sha256: string;
  problem: string | null;
}

export interface ReportSummary {
  name: string;
  caseName: string | null;
  cells: number | null;
  profile: string | null;
  finished: string | null;
  improved: string[];
  regressions: string[];
  unchanged: string[];
  clustersBefore: number;
  clustersAfter: number;
  /** The clusters themselves, worst first. */
  clusters: { before: ClusterRow[]; after: ClusterRow[] };
  maxMoveMm: number | null;
  /** true: the source case's fingerprint matched before and after; null: not recorded */
  sourceUnchanged: boolean | null;
  checkMesh: CheckRow[];
  ab: {
    rows: AbRow[];
    meanRatio: number | null;
    /** how the test was run: iterations, start, processes, settings */
    meta: string[];
    finished: string | null;
    window: number | null;
    secondsPerIteration: { original: number; repaired: number } | null;
    /** residuals per iteration of both runs, for the chart; fields in the order the solver logged them */
    history: { fields: string[]; original: HistoryRun | null; repaired: HistoryRun | null };
  } | null;
  judge: JudgeSummary | null;
  /** the repair map, when the report holds one (meshdoctor map <name> before meshdoctor report) */
  map: MapSummary | null;
  sentence: string;
  about: {
    created: string | null;
    meshdoctor: string | null;
    openfoam: string | null;
    pathsReplaced: number | null;
    documents: DocumentRow[];
  };
}

export type JudgeTone = "success" | "info" | "warning" | "danger" | "neutral";

/** The judge's verdicts: "converged", "statistically steady (...)", "still converging", "not converged (...)", "too short", ... */
export function judgeTone(verdict: string): JudgeTone {
  const v = verdict.toLowerCase();
  if (v.startsWith("not converged")) return "danger";
  if (v.includes("but check") || /^(still|too short|collecting)/.test(v)) return "warning";
  if (v.startsWith("converged")) return "success";
  if (v.startsWith("statistically")) return "info";
  return "neutral";
}

/** Below 0.98 the repaired mesh's residuals are lower (better); above 1.02 higher. */
export function ratioChange(r: number | null): Change {
  if (r == null) return null;
  return r < 0.98 ? "better" : r > 1.02 ? "worse" : null;
}

export function geomean(xs: number[]): number | null {
  return xs.length ? Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length) : null;
}

/** The case folder's name from a (redacted) source path: cases/ahmed-25 → ahmed-25. */
function lastPart(p: unknown): string | null {
  const s = str(p);
  return s ? (s.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? null) || null : null;
}

function checkMeshRows(rep: Obj, improved: string[], regressions: string[]): CheckRow[] {
  const before = obj(rep.checkMeshBefore), after = obj(rep.checkMeshAfter);
  const known = CHECKMESH.map(([k]) => k);
  const keys = [
    ...known.filter((k) => k in before || k in after),
    ...Object.keys({ ...before, ...after }).filter((k) => !known.includes(k)),
  ];
  return keys
    .filter((k) => num(before[k]) != null || num(after[k]) != null)
    .map((k) => ({
      key: k,
      label: measureLabel(k),
      before: num(before[k]),
      after: num(after[k]),
      change: improved.includes(k) ? "better" : regressions.includes(k) ? "worse" : null,
    }));
}

function historyRun(run: unknown): HistoryRun | null {
  const h = obj(obj(run).residualHistory);
  const time = arr(h.Time);
  if (!time.length) return null;
  const y: HistoryRun["y"] = {};
  for (const [field, v] of Object.entries(h)) if (field !== "Time" && Array.isArray(v)) y[field] = v.map(num);
  return { x: time.map((t) => num(t) ?? NaN), y };
}

function abSummary(abDoc: unknown): ReportSummary["ab"] {
  if (!abDoc) return null;
  const ab = obj(abDoc), base = obj(ab.base), fixed = obj(ab.fixed);
  const rows: AbRow[] = Object.entries(obj(ab.residualRatioFixedOverBase))
    .map(([field, v]) => [field, num(v)] as const)
    .filter((e): e is readonly [string, number] => e[1] != null && e[1] > 0)
    .map(([field, ratio]) => ({
      field,
      original: num(obj(obj(base.residuals)[field]).mean),
      repaired: num(obj(obj(fixed.residuals)[field]).mean),
      ratio,
      change: ratioChange(ratio),
    }));
  const iters = num(ab.iters), procs = num(ab.nProcs), init = str(ab.init), variant = str(ab.variant);
  const extensions = arr(ab.extensions).length;
  const meta = [
    iters != null && `${iters.toLocaleString("en-US")} iterations`,
    init && `started from ${init}`,
    procs != null && `${procs} ${procs === 1 ? "process" : "processes"}`,
    variant ? `second run with ${variant} settings` : "the same settings on both meshes",
    extensions > 0 && `continued ${extensions}×`,
  ].filter((x): x is string => typeof x === "string");
  const sb = num(base.secondsPerIteration), sf = num(fixed.secondsPerIteration);
  // A continued A/B test keeps the repaired run's whole history in fixedFull.
  const original = historyRun(ab.base), repaired = historyRun(ab.fixedFull) ?? historyRun(ab.fixed);
  const fields = [...new Set([...Object.keys(original?.y ?? {}), ...Object.keys(repaired?.y ?? {})])];
  return {
    history: { fields, original, repaired },
    rows,
    meanRatio: geomean(rows.map((r) => r.ratio)),
    meta,
    finished: str(ab.finished),
    window: num(ab.window),
    secondsPerIteration: sb != null && sf != null ? { original: sb, repaired: sf } : null,
  };
}

function judgeSummary(abDoc: unknown): JudgeSummary | null {
  const j = obj(obj(abDoc).fixedJudge);
  if (!Object.keys(j).length) return null;
  const axes = obj(j.axes);
  return {
    verdict: str(j.verdict) ?? "–",
    group: str(j.group) ?? "all",
    averages: Object.entries(obj(j.average)).flatMap(([name, v]) => {
      const mean = num(obj(v).mean);
      return mean == null ? [] : [{ name, mean, u: num(obj(v).u) }];
    }),
    flags: strs(j.flags),
    window: num(j.window),
    transient: j.transient === true,
    flow: str(axes.flow),
    up: str(axes.up),
  };
}

const DOCUMENT_LABEL: Record<string, string> = { repair: "Repair result", map: "Repair map", abtest: "Solver A/B test" };

function sentence(s: Pick<ReportSummary, "improved" | "regressions" | "clustersBefore" | "clustersAfter" | "ab">): string {
  const n = (k: number, word: string) => `${k} ${word}${k === 1 ? "" : "s"}`;
  const better = s.improved.length, worse = s.regressions.length;
  const cb = s.clustersBefore.toLocaleString("en-US"), ca = s.clustersAfter.toLocaleString("en-US");
  let t = worse
    ? `The repair improved ${n(better, "checkMesh number")} but made ${worse} worse (${s.regressions.map(measureLabel).join(", ")}).`
    : better
      ? `The repair improved ${n(better, "checkMesh number")} and made none worse.`
      : "No checkMesh number changed: nothing in this mesh needed this repair.";
  t += s.clustersBefore !== s.clustersAfter
    ? ` Problem clusters went from ${cb} to ${ca}.`
    : s.clustersBefore === 0 ? " There were no problem clusters." : ` Problem clusters stayed at ${cb}.`;
  if (!s.ab) return `${t} There is no solver A/B test in this report.`;
  if (!s.ab.rows.length || s.ab.meanRatio == null) return `${t} The solver A/B test has no residuals to compare yet.`;
  const rs = s.ab.rows.map((r) => r.ratio), lo = Math.min(...rs).toFixed(2), hi = Math.max(...rs).toFixed(2);
  const change = ratioChange(s.ab.meanRatio);
  const range = lo === hi ? `${lo}×` : `${lo}–${hi}×`;
  return `${t} In the solver test, the repaired mesh's residuals are ${range} those of the original mesh, ${
    change === "better" ? "so the repair helped the solver." : change === "worse" ? "so the solver did not benefit." : "about the same."
  }`;
}

export function summarize(report: Report): ReportSummary {
  const d = obj(report.documents), rep = obj(d.repair), v = obj(rep.verdict), layout = obj(rep.layout);
  const improved = strs(v.improved), regressions = strs(v.regressions), unchanged = strs(v.unchanged);
  const move = num(rep.maxDisplacement_m);
  const check = obj(rep.sourceCheck).unchanged;
  const ab = abSummary(d.abtest);
  const gen = obj(report.generator), red = obj(report.redacted);
  const base = {
    improved,
    regressions,
    clustersBefore: arr(rep.clustersBefore).length,
    clustersAfter: arr(rep.clustersAfter).length,
    ab,
  };
  return {
    ...base,
    name: str(report.name) ?? "Unnamed run",
    caseName: lastPart(rep.source),
    cells: num(layout.nCells),
    profile: str(rep.profile),
    finished: str(rep.finished),
    unchanged,
    clusters: { before: clusterRows(rep.clustersBefore), after: clusterRows(rep.clustersAfter) },
    maxMoveMm: move == null ? null : move * 1000,
    sourceUnchanged: typeof check === "boolean" ? check : null,
    checkMesh: checkMeshRows(rep, improved, regressions),
    judge: judgeSummary(d.abtest),
    map: mapSummary(d.map),
    sentence: sentence(base),
    about: {
      created: str(report.created),
      meshdoctor: str(gen.meshdoctor),
      openfoam: str(gen.openfoam),
      pathsReplaced: num(red.paths),
      documents: Object.entries(obj(report.contents)).map(([key, c]) => {
        const o = obj(c);
        return {
          key,
          label: DOCUMENT_LABEL[key] ?? key,
          version: str(o.schemaVersion) ?? "–",
          bytes: num(o.bytes),
          sha256: str(o.sha256) ?? "",
          problem: strs(o.problems)[0] ?? null,
        };
      }),
    },
  };
}
