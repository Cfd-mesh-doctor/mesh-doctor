// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { AbtestBrief, Job } from "@/engine/types";
import {
  abJobOf, abRows, abState, lastIteration, liveHistory, outcome, outcomeText, stepSide, stepText, tableRun,
} from "./abtest";

const job = (name: string, state: Job["state"], kind: Job["kind"] = "abtest") => ({ id: `${kind}-${name}-${state}`, kind, name, state }) as Job;

describe("an A/B test's state", () => {
  it("is its job's while that waits or runs, even when an earlier run finished", () => {
    expect(abState("solving fixed", job("t", "running"))).toBe("running");
    expect(abState("done", job("t", "queued", "abextend"))).toBe("running"); // a continuation waiting its turn
  });

  it("is its own step's once done, and says so when the source case changed meanwhile", () => {
    expect(abState("done", job("t", "done"))).toBe("done");
    expect(abState("done", undefined)).toBe("done"); // run in a terminal
    expect(abState("done, but the SOURCE CASE CHANGED during the run", undefined)).toBe("changed");
  });

  it("is failed or cancelled as its job says, else unfinished: no job says why it stopped", () => {
    expect(abState("solving fixed", job("t", "failed"))).toBe("failed");
    expect(abState("extending fixed 200 -> 600", job("t", "cancelled", "abextend"))).toBe("cancelled");
    expect(abState("solving base", undefined)).toBe("unfinished");
    expect(abState(null, undefined)).toBe("unfinished");
  });

  it("takes the newest A/B job of that name, a continuation too, and never a repair of the same name", () => {
    const jobs = [job("t", "running", "repair"), job("t", "failed", "abextend"), job("t", "done"), job("u", "running")];
    expect(abJobOf(jobs, "t")?.kind).toBe("abextend");
    expect(abJobOf(jobs, "v")).toBeUndefined();
    expect(abJobOf(undefined, "t")).toBeUndefined();
  });
});

describe("an A/B test's step", () => {
  it("is said in words", () => {
    expect(stepText("solving base")).toBe("Solving on the original mesh");
    expect(stepText("copying fixed")).toBe("Copying the case for the repaired mesh");
    expect(stepText("hotspots fixed")).toBe("Mapping where the repaired mesh's residuals are largest");
    expect(stepText("extending fixed 200.0 -> 600")).toBe("Continuing the repaired-mesh run from iteration 200 to 600");
    expect(stepText("extending fixed 600 -> 900 with gamg")).toBe("Continuing the repaired-mesh run from iteration 600 to 900 with gamg settings");
    expect(stepText("done, but the SOURCE CASE CHANGED during the run")).toBe("Finished, but the source case changed during the test");
    expect(stepText("something new")).toBe("something new"); // a step a newer engine adds reads as it is
    expect(stepText(null)).toBeNull();
  });

  it("names the run it works on", () => {
    expect(["copying base", "solving base", "hotspots base"].map(stepSide)).toEqual(["base", "base", "base"]);
    expect(["solving fixed", "hotspots fixed", "extending fixed 200 -> 600"].map(stepSide)).toEqual(["fixed", "fixed", "fixed"]);
    expect([stepSide("done"), stepSide(null)]).toEqual([null, null]);
  });
});

describe("an A/B test's outcome", () => {
  it("is the geometric mean of the fields' ratios: 0.5 and 2 even out", () => {
    expect(outcome({ p: 0.5, U: 2 })).toEqual({ ratio: 1, change: null });
    expect(outcome({ p: 0.5 })).toEqual({ ratio: 0.5, change: "better" });
    expect(outcome({ p: 0, U: Number.NaN })).toBeNull(); // nothing to average
    expect(outcome(undefined)).toBeNull();
    expect([outcomeText(outcome({ p: 0.5 })), outcomeText(outcome({ p: 1.5 })), outcomeText(outcome({ p: 1 })), outcomeText(null)])
      .toEqual(["helped", "worse", "about the same", ""]);
  });
});

describe("a run's residual table", () => {
  it("becomes the chart's run: iterations, and each field's residual at each", () => {
    const run = tableRun({ cols: ["Time", "p", "Ux"], rows: [[1, 0.1, null], [2, 0.05, 0.2]] });
    expect(run).toEqual({ x: [1, 2], y: { p: [0.1, 0.05], Ux: [null, 0.2] } });
    expect(lastIteration(run)).toBe(2);
  });

  it("is nothing without its iterations or rows", () => {
    expect(tableRun({ cols: ["p"], rows: [[0.1]] })).toBeNull();
    expect(tableRun({ cols: ["Time", "p"], rows: [] })).toBeNull();
    expect(tableRun(null)).toBeNull();
    expect(lastIteration(null)).toBeNull();
  });

  it("gives the chart every field of both runs, in the order they list them", () => {
    const h = liveHistory({
      base: { cols: ["Time", "p", "Ux"], rows: [[1, 0.1, 0.2]] },
      fixed: { cols: ["Time", "p", "k"], rows: [[1, 0.1, 0.3]] },
    });
    expect(h.fields).toEqual(["p", "Ux", "k"]);
    expect(liveHistory({ base: null, fixed: null })).toEqual({ fields: [], original: null, repaired: null });
  });
});

describe("the A/B tests list", () => {
  const brief = (b: Partial<AbtestBrief>): AbtestBrief => ({ step: "done", updated: null, finished: null, ratios: {}, verdict: null, ...b });

  it("puts running tests first, then the newest", () => {
    const tests = {
      old: brief({ updated: "2026-11-20 10:00:00", finished: "2026-11-20 09:59:00", ratios: { p: 0.8 } }),
      fresh: brief({ updated: "2026-11-22 10:00:00" }),
      going: brief({ step: "solving fixed", updated: "2026-11-19 10:00:00" }),
    };
    const rows = abRows(["fresh", "going", "old"], tests, [job("going", "running")], new Map([["old", "duct"]]));
    expect(rows.map((r) => [r.name, r.state])).toEqual([["going", "running"], ["fresh", "done"], ["old", "done"]]);
    expect(rows[2]).toMatchObject({ caseName: "duct", finished: "2026-11-20 09:59:00", outcome: { change: "better" } });
  });

  it("has its jobs' states alone from an engine that only names its tests (before API 1.3)", () => {
    const rows = abRows(["a", "b"], undefined, [job("b", "failed")], new Map());
    expect(rows.map((r) => [r.name, r.state, r.outcome])).toEqual([["a", "unfinished", null], ["b", "failed", null]]);
  });
});
