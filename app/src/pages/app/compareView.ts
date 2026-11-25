// SPDX-License-Identifier: GPL-3.0-or-later
// The Compare screen's words and numbers (Compare.tsx): its address, what kind of comparison it is, a difference and
// its verdict, the window both runs are averaged over, in plain words, and the sets and pictures it puts side by side
// (ComparePictures.tsx).
import type { BadgeTone } from "@/components/ui/badge";
import type {
  CompareAsk, Compared, Comparison, ComparedSide, Picture, PictureSet, PictureSetBrief,
} from "@/engine/types";
import { formatCount, formatInt, formatNumber } from "@/lib/format";
import { windowNumber } from "./resultsView";

/** The Compare screen: /compare?a=&b= (with mesh=true for a mesh study) or ?abtest=, with a window's from and to
 *  where one is asked for. */
export function comparePagePath(ask: Partial<CompareAsk> = {}): string {
  const q = new URLSearchParams();
  if (ask.abtest != null) q.set("abtest", ask.abtest);
  else {
    if (ask.a != null) q.set("a", ask.a);
    if (ask.b != null) q.set("b", ask.b);
    if (ask.mesh) q.set("mesh", "true");
  }
  if (ask.from != null) q.set("from", String(ask.from));
  if (ask.to != null) q.set("to", String(ask.to));
  const s = q.toString();
  return `/compare${s ? `?${s}` : ""}`;
}

/** What a Compare screen's address asks for; an empty name is none. */
export function askOf(params: URLSearchParams): CompareAsk {
  const name = (k: string) => {
    const v = params.get(k);
    return v == null || v === "" ? null : v;
  };
  return {
    a: name("a"), b: name("b"), abtest: name("abtest"), mesh: params.get("mesh") === "true",
    from: windowNumber(params.get("from")), to: windowNumber(params.get("to")),
  };
}

/** Whether it names two cases, or an A/B test, to compare. */
export const named = (ask: CompareAsk) => ask.abtest != null || (ask.a != null && ask.b != null);

/** What kind of comparison it is, in words. */
export const KIND_TEXT: Record<Comparison["kind"], string> = {
  design: "Two designs",
  mesh: "A mesh study: one design at two mesh sizes",
  abtest: "An A/B test's two runs",
};

/** A number with its sign: "+6.89", "−0.994", "0". */
export function signed(x: number | null | undefined, digits = 3): string {
  if (x == null || !Number.isFinite(x)) return "–";
  if (x === 0) return "0";
  return `${x > 0 ? "+" : "−"}${formatNumber(Math.abs(x), digits)}`;
}

/** A difference in % of a's, with its sign, to a tenth: "−6.2 %"; "–" where a's is 0. */
export function signedPercent(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "–";
  const r = Math.round(x * 10) / 10;
  return r === 0 ? "0 %" : `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)} %`;
}

/** A difference's verdict: real (larger than its noise), inside the noise, or too few values to judge. */
export function verdictOf(x: Compared): { text: string; tone: BadgeTone } {
  if (x.real == null) return { text: "Too few values", tone: "neutral" };
  return x.real ? { text: "Real", tone: "primary" } : { text: "Inside the noise", tone: "neutral" };
}

/** A mesh study's check of a force: whether it moves less between the two meshes than it swings; null if it isn't one. */
export function meshCheck(x: Compared): { text: string; tone: BadgeTone } | null {
  if (x.meshOk == null) return null;
  return x.meshOk
    ? { text: "Moves less than it swings", tone: "success" }
    : { text: "Moves more than it swings", tone: "warning" };
}

/** An iteration ("1,600") or, of a transient run, a time of its flow ("0.21 s"). */
const at = (transient: boolean, x: number | null | undefined) => (transient ? `${formatNumber(x)} s` : formatInt(x));

/** The window both are averaged over, in words: "Both averaged after iteration 1,600, up to 2,000: from the later of
 *  their judges' starts, up to the shorter run's end"; or that each is averaged over its own judge's window. */
export function compareWindowText(doc: Comparison): string {
  const w = doc.window;
  if (!w) return "Each averaged over its own judge's window: one is steady and the other transient, so they share no window.";
  const t = doc.a.transient;
  const span = w.from == null ? `up to ${at(t, w.to)}` : `after ${t ? "" : "iteration "}${at(t, w.from)}, up to ${at(t, w.to)}`;
  return `Both averaged ${span}: ${w.how === "given" ? "the window asked for" : "from the later of their judges' starts"}`
    + `${w.how === "given" ? "" : ", up to the shorter run's end"}.`;
}

/** A side in brief: "Steady · 478,901 cells · made from ahmed-body (coarse) · 400 values". */
export function sideText(s: ComparedSide): string {
  return [
    s.transient ? "Transient" : "Steady",
    s.cells != null && `${formatInt(s.cells)} cells`,
    s.made && `made from ${s.made.template} (${s.made.size})`,
    formatCount(s.window.n, "value"),
  ].filter((x): x is string => typeof x === "string").join(" · ");
}

/** Its own window, of a side averaged over its own judge's (one steady, the other transient). */
export function sideWindowText(s: ComparedSide): string {
  const w = s.window;
  const how = w.how === "settled" ? "from when its forces settled" : w.how === "given" ? "as asked" : "its judge's window";
  return `${how}: after ${s.transient ? "" : "iteration "}${at(s.transient, w.from)}, up to ${at(s.transient, w.to)}`;
}

/** A case's sets that have pictures (made at least once), in the engine's order: the newest made first. */
export const madeSets = (sets: readonly PictureSetBrief[]) => sets.filter((s) => s.made != null);

/** The set each side shows first: one both have by name, so the same written time of each (the newest of a's that b
 *  has too); else each one's newest. Null for a side with none. */
export function firstSets(a: readonly PictureSetBrief[], b: readonly PictureSetBrief[]): [string | null, string | null] {
  const ma = madeSets(a), mb = madeSets(b);
  const both = ma.find((s) => mb.some((t) => t.set === s.set));
  return both ? [both.set, both.set] : [ma[0]?.set ?? null, mb[0]?.set ?? null];
}

/** The pictures to pick from, of each side's set (null: it has none; undefined: still being read): those both sets
 *  have, by file, in a's order; with one side's set only, that one's own. A cut over time's pictures are left out,
 *  each one written time of many. Undefined while a set is still being read. */
export function pictureChoices(a: PictureSet | null | undefined, b: PictureSet | null | undefined): Picture[] | undefined {
  if (a === undefined || b === undefined) return undefined;
  const own = (s: PictureSet | null) => (s?.pictures ?? []).filter((p) => p.kind !== "times");
  if (!a || !b) return own(a ?? b);
  const files = new Set(own(b).map((p) => p.file));
  return own(a).filter((p) => files.has(p.file));
}

/** The picture shown: the one picked while it is still a choice, else the first cut, else the first. */
export function shownPicture(choices: readonly Picture[] | undefined, picked: string | null): Picture | undefined {
  return choices?.find((p) => p.file === picked) ?? choices?.find((p) => p.kind === "cuts") ?? choices?.[0];
}
