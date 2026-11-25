// SPDX-License-Identifier: GPL-3.0-or-later
// The Results screens' words and numbers (Results.tsx and CaseResults.tsx): a force and how sure its mean is, a drift,
// the span a case's forces cover and the window they are averaged over, in plain words. Kept apart from the screens:
// on Windows, TypeScript leaves Results.tsx out when a results.ts sits beside it.
import type { CaseResults, ResultForce, ResultGroup, ResultsWindow } from "@/engine/types";
import { formatCount, formatInt, formatNumber, formatPercent } from "@/lib/format";

/** A drift over 1 % says to run longer before comparing, as the engine says it (results.DRIFT_WARN). */
export const DRIFT_WARN = 0.01;

/** A case's results page: /results/{case}, with a window's from and to where one is asked for. */
export function resultsPagePath(name: string, w: ResultsWindow = { from: null, to: null }): string {
  const q = new URLSearchParams();
  if (w.from != null) q.set("from", String(w.from));
  if (w.to != null) q.set("to", String(w.to));
  const s = q.toString();
  return `/results/${encodeURIComponent(name)}${s ? `?${s}` : ""}`;
}

/** A number the window can start or end at: 0 or more; null for an empty field or anything else. */
export function windowNumber(v: string | null | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? x : null;
}

/** The window a page's address asks for (?from=&to=); the judge's where it names none. */
export function windowOf(params: URLSearchParams): ResultsWindow {
  return { from: windowNumber(params.get("from")), to: windowNumber(params.get("to")) };
}

/** What is wrong with a window typed in, or null: each a number of 0 or more, from before to. */
export function windowProblem(from: string, to: string): string | null {
  const [f, t] = [windowNumber(from), windowNumber(to)];
  if (from.trim() !== "" && f == null) return "From must be a number of 0 or more.";
  if (to.trim() !== "" && t == null) return "To must be a number of 0 or more.";
  if (f != null && t != null && f >= t) return "From must come before To.";
  return null;
}

/** The total group (the one with the most drag), else the first. */
export function totalGroup(doc: CaseResults): ResultGroup | undefined {
  return doc.groups.find((g) => g.total) ?? doc.groups[0];
}

/** What its vertical force is: "Downforce" or "Lift". */
export const verticalWord = (doc: CaseResults) => (doc.axes.vertical === "downforce" ? "Downforce" : "Lift");

/** A force's mean, in N: "16.12". */
export const newtons = (f: ResultForce | null | undefined) => formatNumber(f?.mean);

/** How sure a mean is, "± 0.0097", or "" where it can't say (fewer than 25 values). */
export const plusMinus = (f: ResultForce | null | undefined) => (f?.u == null ? "" : `± ${formatNumber(f.u, 2)}`);

/** A drift as a share, "0.8 %"; "–" where it can't say. */
export const driftText = (x: number | null | undefined) => formatPercent(x, 1);

/** A force under 1 % of the total group's drag is too small for its drift to be judged (results.SMALL). */
export const SMALL = 0.01;

/** Whether force `f`'s drift is judged: it is at least 1 % of the total group's drag. */
function judged(f: ResultForce | null | undefined, doc: CaseResults): f is ResultForce {
  const ref = Math.abs(totalGroup(doc)?.drag?.mean ?? 0);
  return f != null && f.drift != null && Math.abs(f.mean) >= SMALL * ref;
}

/** Whether force `f` still drifts over 1 %, as the engine warns of it: a force too small to judge never does. */
export const driftWarns = (f: ResultForce | null | undefined, doc: CaseResults) =>
  judged(f, doc) && (f.drift ?? 0) > DRIFT_WARN;

/** The larger of the total group's drag and vertical drift, of those large enough to judge: the case's headline
 * drift; null where neither can say. */
export function headlineDrift(doc: CaseResults): number | null {
  const g = totalGroup(doc);
  const d = [g?.drag, g?.vertical].filter((f) => judged(f, doc)).map((f) => f!.drift!);
  return d.length ? Math.max(...d) : null;
}

/** An iteration ("2,000") or, for a transient run, a time of its flow ("0.21 s"). */
export function at(doc: CaseResults, x: number | null | undefined): string {
  return doc.transient ? `${formatNumber(x)} s` : formatInt(x);
}

/** The span its forces cover: "iterations 0 to 2,000", or "0.001 s to 0.3 s of flow". */
export function spanText(doc: CaseResults): string {
  return doc.transient
    ? `${at(doc, doc.start)} to ${at(doc, doc.end)} of flow`
    : `iterations ${at(doc, doc.start)} to ${at(doc, doc.end)}`;
}

const HOW = {
  given: "Averaged over the window asked for",
  settled: "Averaged from when its forces settled",
  judge: "Averaged over the judge's window",
} as const;

/** The window in words: "Averaged over the judge's window: after iteration 1,600, up to 2,000 (400 values)". */
export function windowText(doc: CaseResults): string {
  const w = doc.window;
  return `${HOW[w.how]}: after ${doc.transient ? "" : "iteration "}${at(doc, w.from)}, up to ${at(doc, w.to)} ` +
    `(${formatCount(w.n, "value")})`;
}

/** A waiting case's why, split after its name so the name can stand out: ["run1", " has too few forces…"]; a why that
 * doesn't start with the name gets ": " before it. */
export function waitingParts(w: { case: string; why: string }): [string, string] {
  const named = w.why.startsWith(`${w.case} `) || w.why.startsWith(`${w.case}'`);
  return [w.case, named ? w.why.slice(w.case.length) : `: ${w.why}`];
}

/** How many orders of ten a residual fell: "1.9 orders"; "–" where it can't say. */
export const ordersText = (x: number | null | undefined) => (x == null ? "–" : `${x.toFixed(1)} orders`);
