// SPDX-License-Identifier: GPL-3.0-or-later
// A run's transient plan (GET /tplans/{name}, a tplan job's answer, API 1.6) in words: the time step a transient run
// of it would need at each Courant number, what such a run would cost, and which cells set the time step.
import type { Job, RunDetail, TransientPlan } from "@/engine/types";
import { formatCount, formatDuration, formatInt } from "@/lib/format";

const two = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 2 });
const three = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 });
const round2 = (x: number) => Number(x.toPrecision(2));

/** A time step in the unit that reads best: 2.13e-5 → "21 µs", 2.5e-3 → "2.5 ms", 1.2 → "1.2 s". */
export function formatStep(seconds: number): string {
  const us = round2(seconds * 1e6);
  if (us < 1000) return `${two.format(us)} µs`;
  const ms = round2(seconds * 1e3);
  if (ms < 1000) return `${two.format(ms)} ms`;
  return `${two.format(round2(seconds))} s`;
}

/** Hours of wall time → "under a minute", "35 min", "2.5 h", "160 h (6.7 days)". */
export function formatHours(hours: number): string {
  const min = Math.round(hours * 60);
  if (min < 1) return "under a minute";
  if (hours < 1) return `${min} min`;
  const h = two.format(round2(hours));
  return hours < 48 ? `${h} h` : `${h} h (${two.format(round2(hours / 24))} days)`;
}

/** A cell's size in m → "2.1 mm", "4.5 cm", "1.2 m". */
export function formatSize(m: number): string {
  const mm = round2(m * 1000);
  if (mm < 10) return `${two.format(mm)} mm`;
  const cm = round2(m * 100);
  if (cm < 100) return `${two.format(cm)} cm`;
  return `${two.format(round2(m))} m`;
}

/** A place in the case's axes, in m: "(0.21, −0.05, 0.19) m". */
export function formatPoint(c: number[]): string {
  return `(${c.map((x) => three.format(x).replace("-", "−")).join(", ")}) m`;
}

/** The processes the plan's hours are on: those the run was solved on, whose pace the plan took. */
export function planProcs(p: TransientPlan): string {
  return (p.processors ?? 1) > 1 ? `${formatInt(p.processors)} processes` : "one process";
}

/** The flow time the costs are for, and where it came from: "0.8 s of flow (8 body lengths)"; null without one. */
export function flowText(p: TransientPlan): string | null {
  if (p.flowTime == null) return null;
  const n = /^(\d+) L\/U$/.exec(p.flowTimeSource ?? "")?.[1];
  return `${two.format(round2(p.flowTime))} s of flow${n ? ` (${n} body lengths)` : ""}`;
}

/** The plan in a sentence, at the first Courant number it planned for: 1, which DES and LES need. */
export function planHeadline(p: TransientPlan): string {
  const o = p.options[0];
  if (!o) return "This plan has no Courant numbers in it.";
  const head = `At a largest Courant number of ${two.format(o.maxCo)}${o.maxCo <= 1 ? ", which DES and LES need" : ""}, `
    + `the time step is ${formatStep(o.deltaT)}`;
  const flow = flowText(p);
  if (o.steps != null && flow) {
    return `${head}: ${formatInt(o.steps)} steps for ${flow}`
      + `${o.hours != null ? `, about ${formatHours(o.hours)} on ${planProcs(p)}` : ""}.`;
  }
  if (o.hoursPerFlowSecond != null) {
    return `${head}: about ${formatHours(o.hoursPerFlowSecond / 10)} for each 0.1 s of flow on ${planProcs(p)}.`;
  }
  return `${head}.`;
}

/** One row of the plan's table, as it reads. */
export interface PlanRow {
  co: string;
  step: string;
  steps: string;
  time: string;
  /** The time step and time without the fastest cells. */
  without: string;
}

/** The plan's table: each largest Courant number it planned for, its time step, the steps and time for the flow time
 * (or the time for each 0.1 s of flow without one), and the same without the fastest cells. */
export function planRows(p: TransientPlan): PlanRow[] {
  return p.options.map((o) => ({
    co: two.format(o.maxCo),
    step: formatStep(o.deltaT),
    steps: o.steps != null ? formatInt(o.steps) : "–",
    time: o.hours != null ? formatHours(o.hours)
      : o.hoursPerFlowSecond != null ? `${formatHours(o.hoursPerFlowSecond / 10)} per 0.1 s` : "–",
    without: `${formatStep(o.deltaTWithoutTop)}${o.hoursWithoutTop != null ? `, ${formatHours(o.hoursWithoutTop)}` : ""}`,
  }));
}

/** Which cells set the time step, and what leaving out the fastest would give, in two sentences. */
export function setBy(p: TransientPlan): string {
  const n = p.cellsWithin2x;
  const c = p.courantPerSecond;
  const few = `${formatCount(n, "cell")} of ${formatInt(p.cells)} ${n === 1 ? "is" : "are"} within 2× of the largest `
    + `Courant number: ${n === 1 ? "it sets" : "they set"} the time step.`;
  const gain = c.withoutTop > 0 ? c.max / c.withoutTop : 1;
  return gain >= 1.1
    ? `${few} Without the ${formatInt(p.top)} fastest, it could be ${two.format(round2(gain))}× larger: so few cells set `
      + "the pace of the whole run."
    : `${few} Leaving out the ${formatInt(p.top)} fastest would hardly change it.`;
}

/** Where the fastest cells are, fastest place first, and what may make them fast: "12 cells near (0.21, 0.05, 0.19) m,
 * about 2.1 mm across and 0.4 mm from the wall frontWing, where the flow is up to 38 m/s". A plan from Mesh Doctor's
 * foamCourantCells knows the nearest wall and the speed, and the cells' shape, said where it's poor: non-orthogonal
 * past 65° (a repair's target) or stretched past an aspect ratio of 100. */
export function regionLines(p: TransientPlan, n = 3): string[] {
  return p.regions.slice(0, n).map((g) => {
    let s = `${formatCount(g.nCells, "cell")} near ${formatPoint(g.centre)}, about ${formatSize(g.h)} across`;
    if (g.wall) s += g.wallDist != null ? ` and ${formatSize(g.wallDist)} from the wall ${g.wall}` : `, by the wall ${g.wall}`;
    if (g.speed != null) s += `, where the flow is up to ${two.format(round2(g.speed))} m/s`;
    const shape = [
      g.maxNonOrtho != null && g.maxNonOrtho > 65 ? `non-orthogonal up to ${Math.round(g.maxNonOrtho)}°` : null,
      g.aspectRatio != null && g.aspectRatio > 100
        ? `stretched to an aspect ratio of ${formatInt(Math.round(g.aspectRatio))}` : null,
    ].filter((x) => x != null);
    return shape.length ? `${s}; ${shape.join(", ")}` : s;
  });
}

/** Where the plan saved its fastest cells as a cell set, to see in paraFoam or pick with topoSet; null when it saved
 * none (a plan made with OpenFOAM's CourantNo, where foamCourantCells isn't built, or by an engine before it). */
export function cellSetLine(p: TransientPlan): string | null {
  if (!p.cellSet) return null;
  return `The ${formatInt(p.cellSet.cells)} fastest are saved as the cell set \`${p.cellSet.name}\` in the workspace `
    + `(\`.tplans/${p.case}.sets\`, laid out as the case is): copy its folders into the case to see them in paraFoam `
    + "(Include Sets) or pick them with topoSet.";
}

/** The iteration (a steady run's time) the plan was made from; null for a time that isn't a number. */
export function planIteration(p: TransientPlan): number | null {
  const t = Number(p.time);
  return p.time.trim() !== "" && Number.isFinite(t) ? t : null;
}

/** Is the plan from an earlier result than the run's latest written iteration? */
export function planStale(p: TransientPlan, run: Pick<RunDetail, "written">): boolean {
  const t = planIteration(p);
  return t != null && t < run.written;
}

/** Where the plan came from and how long it took: "Planned from iteration 300 of this run, in 12 s." */
export function planMade(p: TransientPlan): string {
  const t = planIteration(p);
  return `Planned from ${t != null ? `iteration ${formatInt(t)}` : `time ${p.time}`} of this run`
    + `${p.seconds != null ? `, in ${formatDuration(p.seconds)}` : ""}.`;
}

/** The newest tplan job of case `name` (the jobs come newest first). */
export function planJobOf(jobs: Job[] | undefined, name: string): Job | undefined {
  return jobs?.find((j) => j.kind === "tplan" && j.name === name);
}
