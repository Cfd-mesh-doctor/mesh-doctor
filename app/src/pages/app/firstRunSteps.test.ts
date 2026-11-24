// SPDX-License-Identifier: GPL-3.0-or-later
// Try it on the Ahmed body's steps: the case it follows, and each step's state from what the engine lists.
import { describe, expect, it } from "vitest";
import type { Job, RepairSummary, Run } from "@/engine/types";
import { SHORT_TO, ahmedCases, firstRun, type Lists } from "./firstRunSteps";

const run = (name: string, more: Partial<Run> = {}) =>
  ({ name, state: "done", step: "done", iteration: 1000, end: 1000, written: 1000, ...more }) as Run;
const repair = (name: string, source: string, finished = true) =>
  ({ name, source: `~/cases/${source}`, finished: finished ? "2026-11-24 10:00:00" : null,
     verdict: finished ? { improved: ["maxNonOrth"], regressions: [] } : null }) as unknown as RepairSummary;
const job = (kind: Job["kind"], name: string, params: Record<string, unknown>, state: Job["state"] = "running") =>
  ({ id: `${kind}-${name}`, kind, name, state, params }) as Job;
const brief = (finished: string | null) => ({ finished, ratios: {}, step: finished ? "done" : "solving", updated: null, verdict: null });
const made = { "ahmed-coarse": { template: "ahmed-body" }, wing: { copyOf: "mine" }, "wheel": { template: "wheel-wing" } };
const ready = { ready: true };
const states = (l: Lists) => Object.values(firstRun(l).states);

describe("Try it on the Ahmed body", () => {
  it("follows a case made from the Ahmed body template, the one furthest along", () => {
    expect(ahmedCases({ made: { ...made, "ahmed-b": { template: "ahmed-body" } } })).toEqual(["ahmed-b", "ahmed-coarse"]);
    const two = { made: { "ahmed-a": { template: "ahmed-body" }, "ahmed-b": { template: "ahmed-body" } } };
    expect(firstRun({ readiness: ready, cases: two }).name).toBe("ahmed-a");
    expect(firstRun({ readiness: ready, cases: two, runs: [run("ahmed-b")] }).name).toBe("ahmed-b");
    expect(firstRun({ readiness: ready, cases: { made } }).name).toBe("ahmed-coarse");
    expect(firstRun({ readiness: ready, cases: { made: { wing: { copyOf: "mine" } } } }).name).toBeNull();
    expect(SHORT_TO).toBe(1000);
  });

  it("ticks each step off from what the engine lists, the first not done next and the rest waiting", () => {
    expect(states({})).toEqual(["next", "later", "later", "later", "later", "later"]);
    expect(states({ readiness: ready })).toEqual(["done", "next", "later", "later", "later", "later"]);
    expect(states({ readiness: ready, cases: { made } })).toEqual(["done", "done", "next", "later", "later", "later"]);
    const solved = { readiness: ready, cases: { made }, runs: [run("ahmed-coarse")] };
    expect(states(solved)).toEqual(["done", "done", "done", "next", "later", "later"]);
    expect(states({ ...solved, judged: true })).toEqual(["done", "done", "done", "done", "next", "later"]);
    const repaired = { ...solved, judged: true, repairs: [repair("ahmed-coarse-fix", "ahmed-coarse")] };
    expect(firstRun(repaired).repair?.name).toBe("ahmed-coarse-fix");
    expect(states(repaired)).toEqual(["done", "done", "done", "done", "done", "next"]);
    const tested = { ...repaired, tests: { items: ["ahmed-coarse-fix"], tests: { "ahmed-coarse-fix": brief("x") } } };
    expect(states(tested)).toEqual(["done", "done", "done", "done", "done", "done"]);
    // An engine before API 1.3 names its tests only: listed, then done.
    expect(states({ ...repaired, tests: { items: ["ahmed-coarse-fix"] } }).at(-1)).toBe("done");
    // A step done stays done, though one before it isn't any more.
    expect(states({ readiness: { ready: false }, cases: { made } })).toEqual(["next", "done", "later", "later", "later", "later"]);
  });

  it("says a step is under way while its job waits or runs", () => {
    const at = (l: Lists) => firstRun({ readiness: ready, ...l }).states;
    expect(at({ jobs: [job("case", "ahmed-coarse", { template: "ahmed-body", size: "coarse" }, "queued")] }).case).toBe("running");
    expect(at({ jobs: [job("case", "w", { template: "wheel-wing" })] }).case).toBe("next");
    expect(at({ cases: { made }, jobs: [job("solve", "ahmed-coarse", { name: "ahmed-coarse" })] }).solve).toBe("running");
    expect(at({ cases: { made }, runs: [run("ahmed-coarse", { state: "running", written: 0 })] }).solve).toBe("running");
    expect(at({ cases: { made }, runs: [run("ahmed-coarse", { state: "failed", written: 0 })] }).solve).toBe("next");
    const solved = { cases: { made }, runs: [run("ahmed-coarse")], judged: true };
    expect(at({ ...solved, jobs: [job("repair", "x-fix", { source: "ahmed-coarse", name: "x-fix" })] }).repair).toBe("running");
    expect(at({ ...solved, repairs: [repair("x-fix", "ahmed-coarse", false)] }).repair).toBe("running");
    const repaired = { ...solved, repairs: [repair("x-fix", "ahmed-coarse")] };
    expect(at({ ...repaired, jobs: [job("abtest", "x-fix", { name: "x-fix" }, "queued")] }).abtest).toBe("running");
    expect(at({ ...repaired, tests: { items: ["x-fix"], tests: { "x-fix": brief(null) } } }).abtest).toBe("running");
  });

  it("says when the step to do now failed last time: its newest job did, so not once tried again", () => {
    const g = (l: Lists) => firstRun({ readiness: ready, ...l });
    const make = (state: Job["state"]) => job("case", "ahmed-coarse", { template: "ahmed-body", size: "coarse" }, state);
    expect(g({ jobs: [make("failed")] }).states.case).toBe("next");
    expect(g({ jobs: [make("failed")] }).failed?.kind).toBe("case");
    expect(g({}).failed).toBeNull();
    // The engine lists jobs newest first: tried again, then cancelled.
    expect(g({ jobs: [make("cancelled"), make("failed")] }).failed).toBeNull();
    // A step done is past its failures.
    expect(g({ cases: { made }, jobs: [make("failed")] }).failed).toBeNull();
    // A repair or an A/B test that its job left unfinished isn't under way.
    const solved = { cases: { made }, runs: [run("ahmed-coarse")], judged: true };
    const half = { ...solved, repairs: [repair("x-fix", "ahmed-coarse", false)] };
    const fix = (state: Job["state"]) => job("repair", "x-fix", { source: "ahmed-coarse", name: "x-fix" }, state);
    expect(g({ ...half, jobs: [fix("failed")] }).states.repair).toBe("next");
    expect(g({ ...half, jobs: [fix("failed")] }).failed?.kind).toBe("repair");
    expect(g({ ...half, jobs: [fix("cancelled")] }).states.repair).toBe("next");
    expect(g({ ...half, jobs: [fix("cancelled")] }).failed).toBeNull();
    expect(g({ ...half, jobs: [fix("done")] }).states.repair).toBe("running");
    const repaired = { ...solved, repairs: [repair("x-fix", "ahmed-coarse")] };
    const tests = { items: ["x-fix"], tests: { "x-fix": brief(null) } };
    const ab = g({ ...repaired, tests, jobs: [job("abtest", "x-fix", { name: "x-fix" }, "failed")] });
    expect([ab.states.abtest, ab.failed?.kind]).toEqual(["next", "abtest"]);
  });
});
