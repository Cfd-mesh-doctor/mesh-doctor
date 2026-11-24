// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Job, Run } from "@/engine/types";
import {
  MAX_TO, copyName, copyNameProblem, copyTaken, current, madeFrom, madeOfJob, procChoices, runRows, runShown,
  solveCommand, solveJobOf, solveStep, stretchFraction, stretchesText, suggestedProcs, suggestedTo, toProblem,
  totalForces, yourCases,
} from "./solveStart";

const run = (name: string, more: Partial<Run> = {}): Run => ({
  name, state: "done", step: "done", iteration: 2000, start: 0, end: 2000, written: 2000, nProcs: 4,
  stretches: [{ from: 0, to: 2000 }], started: "2026-11-23T10:00:00Z", updated: "2026-11-23T11:00:00Z",
  finished: "2026-11-23T11:00:00Z", error: null, ...more,
});
const job = (name: string, state: Job["state"], kind: Job["kind"] = "solve", params: Job["params"] = { name }) =>
  ({ id: `${name}-${state}`, kind, name, state, params }) as Job;
const tpl = (template: string) => ({ template });

describe("a solve's words", () => {
  it("names its steps with the program at work, and leaves one it doesn't know as it is", () => {
    expect(solveStep("decomposing")).toBe("Splitting the case (decomposePar)");
    expect(solveStep("solving")).toBe("Solving (foamRun)");
    expect(solveStep("copying")).toBe("Copying your case");
    expect(solveStep("renumbering")).toBe("renumbering");
    expect(solveStep("")).toBeNull();
  });

  it("names a template's mesh steps, while a solve makes its case first, as a new case's", () => {
    expect(solveStep("meshing")).toBe("Making the case from its template");
    expect(solveStep("meshing: snappyHexMesh: refining")).toBe("Refining the mesh around the shape (snappyHexMesh)");
    expect(solveStep("meshing: checkMesh")).toBe("Checking the mesh (checkMesh)");
    expect(solveStep("meshing: something new")).toBe("something new");
  });

  it("shows its job's state while that waits or runs, else the run's, else unsolved", () => {
    expect(runShown(run("a", { state: "interrupted" }), job("a", "running"))).toBe("running");
    expect(runShown(run("a"), job("a", "queued"))).toBe("queued");
    expect(runShown(run("a", { state: "stopped" }), job("a", "done"))).toBe("stopped");
    expect(runShown(null, undefined)).toBe("unsolved");
  });

  it("finds the solve job that waits or runs, else the newest, and no other kind's", () => {
    const jobs = [job("a", "done"), job("a", "running"), job("a", "failed"), job("b", "running", "repair")];
    expect(solveJobOf(jobs, "a")?.state).toBe("running");
    expect(solveJobOf([job("a", "done"), job("a", "failed")], "a")?.state).toBe("done");
    expect(solveJobOf(jobs, "b")).toBeUndefined();
  });

  it("reads a run as its job has it: not an earlier stretch's status before the job writes its own", () => {
    const old = run("a", { state: "stopped" });
    expect(current(old, "running")).toBeNull();                 // the job has started, the status is the last stretch's
    expect(current(run("a", { state: "running" }), "running")?.state).toBe("running");
    expect(current(old, "stopped")).toBe(old);
    expect(current(null, "unsolved")).toBeNull();
  });

  it("measures how far the stretch it is in has come, and says its stretches", () => {
    expect(stretchFraction({ start: 2000, end: 3000, iteration: 2500 })).toBe(0.5);
    expect(stretchFraction({ start: 0, end: 2000, iteration: 2400 })).toBe(1);
    expect(stretchFraction({ start: 0, end: null, iteration: 10 })).toBeUndefined();
    expect(stretchesText([{ from: 0, to: 2000 }, { from: 2000, to: 3000 }])).toBe("0 → 2,000, then 2,000 → 3,000");
    expect(stretchesText([])).toBeNull();
  });
});

describe("the runs list", () => {
  it("has every case Mesh Doctor made, those solving first, then the solved ones newest first, then the rest", () => {
    const made = {
      old: tpl("ahmed-body"), fresh: tpl("ahmed-body"), busy: tpl("wheel-wing"), zeta: { copyOf: "wing" },
      alpha: tpl("ahmed-body"),
    };
    const runs = [run("old", { updated: "2026-11-20T00:00:00Z" }), run("fresh"), run("busy", { state: "running" })];
    const rows = runRows(made, runs, [job("busy", "running")]);
    expect(rows.map((r) => [r.name, r.shown])).toEqual([
      ["busy", "running"], ["fresh", "done"], ["old", "done"], ["alpha", "unsolved"], ["zeta", "unsolved"],
    ]);
    expect(rows[0]).toMatchObject({ made: { template: "wheel-wing" }, job: { state: "running" } });
    expect(rows[4]!.made).toEqual({ copyOf: "wing" });
  });

  it("has a copy of yours that waits to be made, by its job, with the case it copies", () => {
    const rows = runRows({}, [], [job("wing-run", "queued", "solve", { name: "wing-run", source: "wing" }), job("x", "done")]);
    expect(rows).toEqual([expect.objectContaining({ name: "wing-run", shown: "queued", made: { copyOf: "wing" }, run: null })]);
  });

  it("keeps a run whose case it isn't told was made", () => {
    expect(runRows(undefined, [run("x")], undefined).map((r) => r.name)).toEqual(["x"]);
    expect(runRows({}, [], [])).toEqual([]);
  });
});

describe("a copy of a case you made", () => {
  it("says what a case was made from", () => {
    expect(madeFrom(tpl("ahmed-body"))).toBe("made from the ahmed-body template");
    expect(madeFrom({ copyOf: "wing" })).toBe("a copy of wing");
    expect(madeFrom({})).toBeNull();
    expect(madeFrom(null)).toBeNull();
    expect(madeOfJob(job("w", "queued", "solve", { name: "w", source: "wing" }))).toEqual({ copyOf: "wing" });
    expect(madeOfJob(job("w", "queued"))).toBeNull();
    expect(madeOfJob(job("v", "running", "solve", { name: "v", template: "ahmed-body", size: "coarse" })))
      .toEqual({ template: "ahmed-body" });
    expect(madeOfJob(job("w", "queued", "repair", { name: "w", source: "wing" }))).toBeNull();
  });

  it("is of one of the cases you made: those Mesh Doctor didn't", () => {
    expect(yourCases({ items: ["a", "b", "c"], made: { b: tpl("ahmed-body") } })).toEqual(["a", "c"]);
    expect(yourCases({ items: ["a"] })).toEqual(["a"]);
    expect(yourCases(undefined)).toEqual([]);
  });

  it("gets a name no case has, nor a new case's or a copy's job, while it waits or runs", () => {
    const taken = copyTaken(["wing", "wing-run"], [
      job("wing-run-2", "failed", "case"), job("wing-run-3", "queued"), job("wing-run-4", "failed"),
    ]);
    expect([...taken].sort()).toEqual(["wing", "wing-run", "wing-run-2", "wing-run-3"]);
    expect(copyName("wing", taken)).toBe("wing-run-4");                     // a copy that failed left nothing
    expect(copyName("motorBike", taken)).toBe("motorBike-run");
    expect(copyName("x".repeat(80), new Set())).toHaveLength(77);
    expect(copyNameProblem("wing-run-4", taken)).toBeNull();
    expect(copyNameProblem("wing", taken)).toBe("A case with this name is in the cases folder already. Pick another name.");
    expect(copyNameProblem("", taken)).toBe("Give the copy a name.");
    expect(copyNameProblem("-x", taken)).toMatch(/^Use only letters/);
  });
});

describe("the Solve dialog's numbers", () => {
  it("suggests 2,000 iterations for a first solve and 1,000 more for a continuation", () => {
    expect(suggestedTo(0)).toBe(2000);
    expect(suggestedTo(1500)).toBe(2500);
    expect(suggestedTo(MAX_TO - 10)).toBe(MAX_TO);
  });

  it("takes a whole number past the latest written iteration, up to the engine's most", () => {
    expect(toProblem("2000", 0)).toBeNull();
    expect(toProblem("2001", 2000)).toBeNull();
    expect(toProblem("2000", 2000)).toBe("Give one past 2,000, the latest iteration written: the solve continues from there.");
    expect(toProblem("12.5", 0)).toBe("Give a whole number of iterations.");
    expect(toProblem("", 0)).toBe("Give a whole number of iterations.");
    expect(toProblem("0", 0)).toBe("Give an iteration from 1 to 100,000.");
    expect(toProblem("100001", 0)).toBe("Give an iteration from 1 to 100,000.");
  });

  it("suggests 4 processes, or one per core on a smaller computer, and offers one up to each core", () => {
    expect(suggestedProcs(undefined)).toBe(4);
    expect(suggestedProcs(16)).toBe(4);
    expect(suggestedProcs(2)).toBe(2);
    expect(procChoices(2)).toEqual([1, 2]);
    expect(procChoices(undefined)).toHaveLength(8);
    expect(procChoices(200)).toHaveLength(64);
  });

  it("gives the command that does the same, with the processes for a first solve only", () => {
    expect(solveCommand("ahmed-coarse", 2000, 4)).toBe("meshdoctor solve ahmed-coarse --to 2000 --np 4");
    expect(solveCommand("ahmed-coarse", 3000, null)).toBe("meshdoctor solve ahmed-coarse --to 3000");
    expect(solveCommand("wing-run", 2000, 4, "wing")).toBe("meshdoctor solve wing wing-run --to 2000 --np 4");
  });
});

describe("a run's forces", () => {
  it("are its total group's rows, its vertical force named by the engine", () => {
    const live = {
      forces: { body: [[1, 40, -170], [2, 41, -171], [3, "x", 0]], wheel: [[1, 5, 1]] },
      forceInfo: { total: "body", groups: ["body", "wheel"], vertical: "lift" },
    };
    expect(totalForces(live)).toEqual({ group: "body", rows: [[1, 40, -170], [2, 41, -171]], vertical: "lift" });
  });

  it("are none for a case that writes none", () => {
    expect(totalForces({ forces: {}, forceInfo: { total: null, groups: [] } })).toEqual(
      { group: null, rows: [], vertical: "downforce" });
  });
});
