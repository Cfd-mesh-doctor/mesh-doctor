// SPDX-License-Identifier: GPL-3.0-or-later
// A transient run of a solved steady run (API 1.6: a `solve` job with `steady`), as its dialog sets it up from the
// run's transient plan (GET /tplans/{name}): a free name, DDES or URANS, the largest Courant number and the time step,
// steps and hours the plan gives at it, the time to solve to (8 flow times over the body by default) and the processes.
import type { TransientPlan } from "@/engine/types";
import { formatInt } from "@/lib/format";
import { formatTime } from "./solveStart";
import { formatHours, formatStep } from "./tplan";

export const MODELS = ["DDES", "URANS"] as const;
export type Model = (typeof MODELS)[number];
/** The largest Courant number the engine takes (meshdoctor/transient.py's MAX_CO), and for DDES (MAX_DDES_CO). */
export const MAX_CO = 20;
export const MAX_DDES_CO = 2;

/** The largest Courant number suggested: 1 for DDES, which resolves the wake's eddies; 5 for URANS. */
export function suggestedCo(model: Model): number {
  return model === "DDES" ? 1 : 5;
}

/** A free name for a transient run of `steady`: its name and the model ("ahmed-ddes"), then -2, -3… while taken. */
export function transientName(steady: string, model: Model, taken: ReadonlySet<string>): string {
  const base = `${steady.slice(0, 80 - "-urans-99".length)}-${model.toLowerCase()}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** What's wrong with the largest Courant number typed, or null when the engine will take it. */
export function coProblem(text: string, model: Model): string | null {
  const t = text.trim();
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return "Give a number, such as 1.";
  const co = Number(t);
  if (!(co > 0) || co > MAX_CO) return `Give a number more than 0 and at most ${MAX_CO}.`;
  if (model === "DDES" && co > MAX_DDES_CO) {
    return `DDES resolves the wake's eddies, which needs about 1: give ${MAX_DDES_CO} or less, or pick URANS.`;
  }
  return null;
}

/** What the plan says a transient run would take at largest Courant number `co`, to `to` s: its time step (the
 * largest cell Courant number per second sets it), its steps, and its hours on the plan's processes, from the steady
 * run's pace with the plan's outer correctors per step, and on `np` as if it split as evenly. The hours are null
 * when the plan has no pace (its run's log said no times). */
export interface PlanAt {
  deltaT: number;
  steps: number;
  hours: number | null;
  hoursOn: number | null;
}

export function planAt(plan: TransientPlan, co: number, to: number, np: number): PlanAt {
  const deltaT = co / plan.courantPerSecond.max;
  const steps = Math.ceil(to / deltaT);
  const pace = plan.secondsPerIteration;
  const hours = pace != null && pace > 0 ? (steps * pace * (plan.outerCorrectors ?? 3)) / 3600 : null;
  return { deltaT, steps, hours, hoursOn: hours == null ? null : (hours * (plan.processors ?? 1)) / Math.max(1, np) };
}

const procsText = (n: number) => (n > 1 ? `${formatInt(n)} processes` : "one process");

/** The plan's numbers at the Courant number and time typed, in a sentence: "At 1 the plan's time step is 18 µs:
 * 11,369 steps to 0.2088 s, about 3.8 h on its 6 processes." */
export function planAtText(plan: TransientPlan, co: number, to: number | null, np: number): string {
  const head = `At ${co} the plan's time step is ${formatStep(co / plan.courantPerSecond.max)}`;
  if (to == null) return `${head}.`;
  const a = planAt(plan, co, to, np);
  const procs = plan.processors ?? 1;
  const elsewhere = np !== procs && a.hoursOn != null
    ? ` (about ${formatHours(a.hoursOn)} on ${procsText(np)}, if it splits as evenly)` : "";
  const time = a.hours == null ? "" : `, about ${formatHours(a.hours)} on its ${procsText(procs)}${elsewhere}`;
  return `${head}: ${formatInt(a.steps)} steps to ${formatTime(to)}${time}.`;
}

/** Where the time suggested comes from, in a sentence; null when the plan has no flow time (no body length). */
export function flowHint(plan: TransientPlan): string | null {
  if (plan.flowTime == null) return null;
  const n = /^(\d+) L\/U$/.exec(plan.flowTimeSource ?? "")?.[1];
  if (!n) return "The plan's flow time, which its hours are for.";
  const body = plan.length != null && plan.speed != null
    ? `: ${Number(plan.length.toPrecision(4))} m at ${Number(plan.speed.toPrecision(3))} m/s` : "";
  return `${n} flow times over the body (${n} L/U${body}), which the plan's hours are for.`;
}

/** The processes suggested: the steady run's, whose pace the plan's hours are at, when this computer offers as many;
 * else `fallback`. */
export function transientProcs(plan: TransientPlan, choices: readonly number[], fallback: number): number {
  return plan.processors != null && choices.includes(plan.processors) ? plan.processors : fallback;
}
