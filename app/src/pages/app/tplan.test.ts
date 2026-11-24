// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Job, TransientPlan } from "@/engine/types";
import {
  flowText, formatHours, formatPoint, formatSize, formatStep, planHeadline, planIteration, planJobOf, planMade,
  planProcs, planRows, planStale, regionLines, setBy,
} from "./tplan";

/** The plan the engine's own test makes (TransientPlanTest.test_plan): 500 cells on 2 processes, 5 fast ones in a
 * cluster, 20 m/s past a body 2 m long, 2 s a steady iteration, planned at Courant numbers 1 and 5. */
const PLAN: TransientPlan = {
  schemaVersion: "1.0", case: "ahmed", time: "300", processors: 2, cells: 500,
  courantPerSecond: { median: 13, p99: 16, p999: 996, p9999: 1000, max: 1000, withoutTop: 16 },
  top: 5, cellsWithin2x: 5,
  regions: [{ nCells: 5, centre: [5.02, 2, 1], bbox: [], h: 0.01, maxRate: 1000 }],
  speed: 20, length: 2, flowTime: 0.8, flowTimeSource: "8 L/U", secondsPerIteration: 2, outerCorrectors: 3,
  options: [
    { maxCo: 1, deltaT: 1e-3, deltaTWithoutTop: 1 / 16, stepsPerSecond: 1000, hoursPerFlowSecond: 3 * 2 / 1e-3 / 3600,
      steps: 800, hours: 800 * 3 * 2 / 3600, hoursWithoutTop: 13 * 3 * 2 / 3600 },
    { maxCo: 5, deltaT: 5e-3, deltaTWithoutTop: 5 / 16, stepsPerSecond: 200, hoursPerFlowSecond: 3 * 2 / 5e-3 / 3600,
      steps: 160, hours: 160 * 3 * 2 / 3600, hoursWithoutTop: 3 * 3 * 2 / 3600 },
  ],
  seconds: 12.4,
  notes: ["Hours assume one PIMPLE outer iteration costs about one steady iteration."],
};

const job = (name: string, kind: Job["kind"], state: Job["state"], id = `${kind}-${name}-${state}`) =>
  ({ id, kind, name, state, params: { name } }) as Partial<Job> as Job;

describe("a transient plan's numbers", () => {
  it("writes a time step in the unit that reads best", () => {
    expect([2.13e-5, 1.07e-4, 9.996e-4, 2.5e-3, 0.0213, 0.9996, 1.234].map(formatStep))
      .toEqual(["21 µs", "110 µs", "1 ms", "2.5 ms", "21 ms", "1 s", "1.2 s"]);
  });

  it("writes hours of wall time as minutes, hours, or hours and days", () => {
    expect([0.005, 0.267, 1.333, 16.3, 160.4, 1234].map(formatHours))
      .toEqual(["under a minute", "16 min", "1.3 h", "16 h", "160 h (6.7 days)", "1,200 h (51 days)"]);
  });

  it("writes a cell's size, a place and the processes", () => {
    expect([0.0021, 0.0095, 0.012, 0.45, 1.23].map(formatSize)).toEqual(["2.1 mm", "9.5 mm", "1.2 cm", "45 cm", "1.2 m"]);
    expect(formatPoint([0.2134, -0.0512, 0.19])).toBe("(0.213, −0.0512, 0.19) m");
    expect([planProcs(PLAN), planProcs({ ...PLAN, processors: 1 }), planProcs({ ...PLAN, processors: undefined })])
      .toEqual(["2 processes", "one process", "one process"]);
  });
});

describe("a transient plan in words", () => {
  it("says the time step at a Courant number of 1, the steps for the flow time and the hours", () => {
    expect(flowText(PLAN)).toBe("0.8 s of flow (8 body lengths)");
    expect(flowText({ ...PLAN, flowTimeSource: "given" })).toBe("0.8 s of flow");
    expect(planHeadline(PLAN)).toBe("At a largest Courant number of 1, which DES and LES need, the time step is 1 ms: "
      + "800 steps for 0.8 s of flow (8 body lengths), about 1.3 h on 2 processes.");
    expect(planHeadline({ ...PLAN, options: PLAN.options.slice(1) })).toBe("At a largest Courant number of 5, the time "
      + "step is 5 ms: 160 steps for 0.8 s of flow (8 body lengths), about 16 min on 2 processes.");
  });

  it("without a flow time, the hours for each 0.1 s of flow; without the run's pace, the time step alone", () => {
    const bare = { maxCo: 1, deltaT: 1e-3, deltaTWithoutTop: 1 / 16, stepsPerSecond: 1000 };  // no pace
    const open = { ...bare, hoursPerFlowSecond: 3 * 2 / 1e-3 / 3600 };                          // no flow time
    expect(planHeadline({ ...PLAN, flowTime: null, flowTimeSource: null, options: [open] })).toBe("At a largest "
      + "Courant number of 1, which DES and LES need, the time step is 1 ms: about 10 min for each 0.1 s of flow on 2 "
      + "processes.");
    expect(planHeadline({ ...PLAN, flowTime: null, options: [bare] }))
      .toBe("At a largest Courant number of 1, which DES and LES need, the time step is 1 ms.");
    expect(planRows({ ...PLAN, flowTime: null, options: [open, bare] })).toEqual([
      { co: "1", step: "1 ms", steps: "–", time: "10 min per 0.1 s", without: "63 ms" },
      { co: "1", step: "1 ms", steps: "–", time: "–", without: "63 ms" },
    ]);
  });

  it("tables each Courant number planned for, with and without the fastest cells", () => {
    expect(planRows(PLAN)).toEqual([
      { co: "1", step: "1 ms", steps: "800", time: "1.3 h", without: "63 ms, 1 min" },
      { co: "5", step: "5 ms", steps: "160", time: "16 min", without: "310 ms, under a minute" },
    ]);
  });

  it("says which cells set the time step, and where the fastest are", () => {
    expect(setBy(PLAN)).toBe("5 cells of 500 are within 2× of the largest Courant number: they set the time step. "
      + "Without the 5 fastest, it could be 63× larger: so few cells set the pace of the whole run.");
    expect(setBy({ ...PLAN, cellsWithin2x: 1, courantPerSecond: { ...PLAN.courantPerSecond, withoutTop: 950 } }))
      .toBe("1 cell of 500 is within 2× of the largest Courant number: it sets the time step. Leaving out the 5 fastest "
        + "would hardly change it.");
    expect(regionLines(PLAN)).toEqual(["5 cells near (5.02, 2, 1) m, about 1 cm across"]);
  });

  it("says what it was planned from, and whether the run has been solved further since", () => {
    expect(planMade(PLAN)).toBe("Planned from iteration 300 of this run, in 12 s.");
    expect([planStale(PLAN, { written: 300 }), planStale(PLAN, { written: 600 })]).toEqual([false, true]);
    expect([planIteration({ ...PLAN, time: "0.25" }), planIteration({ ...PLAN, time: "" })]).toEqual([0.25, null]);
    expect(planMade({ ...PLAN, time: "latest", seconds: undefined })).toBe("Planned from time latest of this run.");
  });

  it("follows the newest plan job of the run", () => {
    const jobs = [job("wing", "tplan", "running"), job("ahmed", "solve", "done"), job("ahmed", "tplan", "failed", "new"),
      job("ahmed", "tplan", "done", "old")];
    expect(planJobOf(jobs, "ahmed")?.id).toBe("new");
    expect(planJobOf(jobs, "mine")).toBeUndefined();
    expect(planJobOf(undefined, "ahmed")).toBeUndefined();
  });
});
