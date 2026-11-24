// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { TransientPlan } from "@/engine/types";
import {
  MAX_CO, coProblem, flowHint, planAt, planAtText, suggestedCo, transientName, transientProcs,
} from "./transientStart";

/** The plan's numbers as the engine made them of a real coarse Ahmed body solved to 300 on 6 processes. */
const PLAN = {
  schemaVersion: "1.0", case: "ahmed", time: "300", processors: 6, cells: 478_901,
  courantPerSecond: { median: 4329.14, p99: 15320.4, p999: 20357.4, p9999: 29466.6, max: 54448.3, withoutTop: 24803.3 },
  top: 100, cellsWithin2x: 62, regions: [],
  speed: 40, length: 1.044, flowTime: 0.2088, flowTimeSource: "8 L/U", secondsPerIteration: 0.4, outerCorrectors: 3,
  options: [{ maxCo: 1, deltaT: 1.83661e-5, deltaTWithoutTop: 4.03171e-5, stepsPerSecond: 54448.3,
    hoursPerFlowSecond: 18.1494, steps: 11_369, hours: 3.78967, hoursWithoutTop: 1.72633 }],
} satisfies TransientPlan;

describe("a transient run's dialog", () => {
  it("suggests a free name of the steady run's and the model's, then -2, -3…", () => {
    expect(transientName("ahmed", "DDES", new Set())).toBe("ahmed-ddes");
    expect(transientName("ahmed", "URANS", new Set(["ahmed-urans"]))).toBe("ahmed-urans-2");
    expect(transientName("ahmed", "DDES", new Set(["ahmed-ddes", "ahmed-ddes-2"]))).toBe("ahmed-ddes-3");
    expect(transientName("x".repeat(80), "URANS", new Set())).toHaveLength(80 - "-urans-99".length + "-urans".length);
  });

  it("suggests a largest Courant number of 1 for DDES and 5 for URANS, and takes what the engine takes", () => {
    expect([suggestedCo("DDES"), suggestedCo("URANS")]).toEqual([1, 5]);
    for (const [text, model] of [["1", "DDES"], ["0.5", "DDES"], ["2", "DDES"], ["20", "URANS"], [".8", "URANS"]] as const) {
      expect(coProblem(text, model)).toBeNull();
    }
    expect(coProblem("3", "DDES")).toBe("DDES resolves the wake's eddies, which needs about 1: give 2 or less, or pick URANS.");
    expect(coProblem("21", "URANS")).toBe(`Give a number more than 0 and at most ${MAX_CO}.`);
    expect(coProblem("0", "URANS")).toBe("Give a number more than 0 and at most 20.");
    for (const bad of ["", "one", "-1", "1e1", "1,5"]) expect(coProblem(bad, "URANS")).toBe("Give a number, such as 1.");
  });

  it("works out from the plan the time step, the steps and the hours at the Courant number and time typed", () => {
    const at1 = planAt(PLAN, 1, 0.2088, 6);
    expect(at1.deltaT).toBeCloseTo(1.83661e-5, 9);
    expect(at1.steps).toBe(11_369);                                   // as the plan's own row at 1
    expect(at1.hours).toBeCloseTo(3.78967, 4);
    expect(at1.hoursOn).toBeCloseTo(3.78967, 4);
    expect(planAt(PLAN, 5, 0.2088, 6).steps).toBe(2274);              // as its row at 5
    expect(planAt(PLAN, 1, 0.2088, 4).hoursOn).toBeCloseTo(3.78967 * 6 / 4, 4);
    expect(planAt({ ...PLAN, secondsPerIteration: null }, 1, 0.2088, 6)).toMatchObject({ hours: null, hoursOn: null });
    expect(planAtText(PLAN, 1, 0.2088, 6)).toBe("At 1 the plan's time step is 18 µs: 11,369 steps to 0.2088 s, about "
      + "3.8 h on its 6 processes.");
    expect(planAtText(PLAN, 5, 0.2088, 4)).toBe("At 5 the plan's time step is 92 µs: 2,274 steps to 0.2088 s, about 45 min "
      + "on its 6 processes (about 1.1 h on 4 processes, if it splits as evenly).");
    expect(planAtText(PLAN, 1, null, 6)).toBe("At 1 the plan's time step is 18 µs.");
    expect(planAtText({ ...PLAN, secondsPerIteration: null, processors: 1 }, 1, 0.1, 1))
      .toBe("At 1 the plan's time step is 18 µs: 5,445 steps to 0.1 s.");
  });

  it("says where the time suggested comes from, and suggests the steady run's processes when the computer has them", () => {
    expect(flowHint(PLAN)).toBe("8 flow times over the body (8 L/U: 1.044 m at 40 m/s), which the plan's hours are for.");
    expect(flowHint({ ...PLAN, flowTimeSource: "--flow-time" })).toBe("The plan's flow time, which its hours are for.");
    expect(flowHint({ ...PLAN, flowTime: null })).toBeNull();
    expect(transientProcs(PLAN, [1, 2, 3, 4, 5, 6, 7, 8], 4)).toBe(6);
    expect(transientProcs(PLAN, [1, 2, 3, 4], 4)).toBe(4);
    expect(transientProcs({ ...PLAN, processors: undefined }, [1, 2, 3, 4, 5, 6], 4)).toBe(4);
  });
});
