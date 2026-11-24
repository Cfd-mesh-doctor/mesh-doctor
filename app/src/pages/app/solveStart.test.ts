// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { DiskInfo, Job, Run } from "@/engine/types";
import {
  MAX_TO, atText, averagingText, copyName, copyNameProblem, copyTaken, current, diskCheck, diskSpace, formatTime,
  isTransient,
  madeFrom, madeOfJob, ofText,
  procChoices, runRows, runShown, solveCommand, solveJobOf, solveStep, stretchFraction, stretchesText, suggestedProcs,
  suggestedTime, suggestedTo, timeInput, timeNumber, timeProblem, toProblem, totalForces, transientCommand,
  transientText, yourCases,
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

describe("a transient run", () => {
  const t = run("ahmed-ddes", {
    iteration: 0.0011, start: 0.0005, end: 0.0011, written: 0.0011,
    stretches: [{ from: 0, to: 0.0005 }, { from: 0.0005, to: 0.0011 }],
    transient: { steady: "ahmed", at: "300", maxCo: 1, model: "DDES" },
  });

  it("is one with `transient`, and counts time in s where a steady run counts iterations", () => {
    expect([isTransient(t), isTransient(run("a")), isTransient(run("a", { transient: null })), isTransient(null)])
      .toEqual([true, false, false, false]);
    expect([timeNumber(0.0011), timeNumber(0.20875), timeNumber(0), timeNumber(1.5)]).toEqual(["0.0011", "0.2088", "0", "1.5"]);
    expect(formatTime(0.000255)).toBe("0.000255 s");
    expect([atText(0.0011, true), atText(1200, false)]).toEqual(["0.0011 s", "iteration 1,200"]);
    expect([ofText(0.00052, 0.0011, true), ofText(120, 200, false)]).toEqual(["0.00052 s of 0.0011 s", "iteration 120 of 200"]);
    expect(stretchesText(t.stretches, true)).toBe("0 → 0.0005, then 0.0005 → 0.0011 s");
    expect(stretchFraction({ start: 0.0005, end: 0.0011, iteration: 0.0008 })).toBeCloseTo(0.5);
  });

  it("says what it started from: the steady run, its result, the model and the largest Courant number", () => {
    expect(transientText(t.transient!)).toBe("DDES at a largest Courant number of 1, from ahmed's iteration 300");
    expect(transientText({ steady: "wing", at: "0.5", maxCo: 5, model: "URANS" }))
      .toBe("URANS at a largest Courant number of 5, from wing's time 0.5");
    expect(transientText({ steady: "wing", at: "latest", maxCo: null, model: null })).toBe("From wing's time latest");
    expect(madeFrom({ transientOf: "ahmed" })).toBe("a transient run of ahmed");
    expect(madeOfJob(job("ahmed-ddes", "queued", "solve", { name: "ahmed-ddes", steady: "ahmed", maxCo: 1, to: 0.2 })))
      .toEqual({ transientOf: "ahmed" });
  });

  it("continues to the end it stopped short of, else as far again as its latest stretch went, past what is written", () => {
    expect(suggestedTime(t)).toBe(0.0017);
    expect(suggestedTime({ written: 0.000255, start: 0.0002, end: 0.001 })).toBe(0.001);      // stopped short of it
    expect(suggestedTime({ written: 0.2088, start: 0, end: 0.2088 })).toBe(0.4176);
    expect([timeInput(0.2088), timeInput(0.1 + 0.2), timeInput(1.7e-5)]).toEqual(["0.2088", "0.3", "0.000017"]);
    expect(timeProblem("0.0017", 0.0011)).toBeNull();
    expect(timeProblem("2e-3", 0.0011)).toBeNull();
    expect(timeProblem(".5", 0)).toBeNull();
    expect(timeProblem("0.0011", 0.0011)).toBe("Give one past 0.0011 s, the latest time written: the run continues from there.");
    expect(timeProblem("0", 0)).toBe("Give a time past 0 s.");
    for (const bad of ["", "abc", "-1", "1,5", "0.2 s", "Infinity"]) expect(timeProblem(bad, 0)).toBe("Give the time in s, such as 0.2.");
    expect(transientCommand("ahmed-ddes", "ahmed", 1, "DDES", 0.2088, 6))
      .toBe("meshdoctor solve ahmed-ddes --steady ahmed --co 1 --model DDES --to 0.2088 --np 6");
    expect(solveCommand("ahmed-ddes", 0.0017, null)).toBe("meshdoctor solve ahmed-ddes --to 0.0017");
    expect(copyNameProblem("", new Set(), "the transient run")).toBe("Give the transient run a name.");
  });

  it("says from when it averages its flow: once its forces have settled, as the engine switches it on (API 1.9)", () => {
    const off = { from: null, settled: null, written: null };
    expect(averagingText(off, false)).toBe("It averages its flow once its forces have settled: they haven't yet.");
    expect(averagingText(off, true)).toBe("Its flow isn't averaged: it ended before averaging began, which waits for "
      + "its forces to settle. Continue it, and it averages once they have.");
    const fields = "its mean flow and how much it swings (UMean, pMean, UPrime2Mean, pPrime2Mean)";
    expect(averagingText({ from: 0.00052, settled: 0.0004, written: null }, false)).toBe("Its flow is averaged from "
      + `0.00052 s, once its forces had settled (at 0.0004 s): each time it writes from now on holds ${fields}.`);
    expect(averagingText({ from: 0.00052, settled: 0.0004, written: 0.0011 }, true)).toBe("Its flow is averaged from "
      + `0.00052 s, once its forces had settled (at 0.0004 s): each time it has written since holds ${fields}, the `
      + "latest at 0.0011 s.");
    expect(averagingText({ from: 0.00052, settled: 0.0004, written: null }, true)).toBe("Its flow is averaged from "
      + "0.00052 s, once its forces had settled (at 0.0004 s), but it ended before it wrote a time with the average "
      + `in. Continue it, and each time it writes holds ${fields}.`);
    // Settled at the time it switched on, or not said (a status written before it, the average read from the case)
    expect(averagingText({ from: 0.0005, settled: 0.0005, written: 0.001 }, true)).toBe("Its flow is averaged from "
      + `0.0005 s, once its forces had settled: each time it has written since holds ${fields}, the latest at 0.001 s.`);
    expect(averagingText({ from: 0.0005, settled: null, written: 0.001 }, true))
      .toMatch(/^Its flow is averaged from 0\.0005 s, once its forces had settled: each/);
    // Not a run that averages: steady, or made by an engine before API 1.9
    expect([averagingText(null, true), averagingText(undefined, false)]).toEqual([null, null]);
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

describe("what a solve takes on the disk", () => {
  // GET /disk for the coarse Ahmed body (API 1.7), as measured: a copy of 65 MB, 212 MB written on several processes.
  const disk = (freeMb: number | null, more: Partial<NonNullable<DiskInfo["case"]>> = {}): DiskInfo => ({
    freeMb, keepMb: 1024, case: {
      name: "wing", copyMb: 65, transientMb: 103, solveMb: { several: 212, one: 78 }, continueMb: { several: 39, one: 0 },
      ...more,
    },
  });

  it("is the new case it makes, then what it writes as it goes, on the processes it runs on", () => {
    expect(diskCheck(disk(402_339), "copy", true, 4)).toEqual({ need: 277, free: 402_339, keep: 1024, fits: true });
    expect(diskCheck(disk(402_339), "copy", true, 1)?.need).toBe(65 + 78);              // unsplit
    expect(diskCheck(disk(402_339), "transient", true, 6)?.need).toBe(103 + 212);
    expect(diskCheck(disk(402_339), null, true, 2)?.need).toBe(212);                    // a case it made, solved
    expect(diskCheck(disk(402_339), null, false, 4)?.need).toBe(39);                    // and continued
    expect(diskCheck(disk(402_339), null, false, 1)?.need).toBe(0);
  });

  it("counts a new transient run's averaged flow in what it writes, as API 1.9 says it, and an older engine doesn't", () => {
    const averaged = { transientSolveMb: { several: 445, one: 164 } };
    expect(diskCheck(disk(402_339, averaged), "transient", true, 6)?.need).toBe(103 + 445);
    expect(diskCheck(disk(402_339, averaged), "transient", true, 1)?.need).toBe(103 + 164);
    expect(diskCheck(disk(402_339, averaged), "copy", true, 4)?.need).toBe(277);         // a copy solves steady
    expect(diskCheck(disk(402_339, averaged), null, false, 4)?.need).toBe(39);            // continueMb has it
    expect(diskCheck(disk(402_339, { transientSolveMb: null }), "transient", true, 6)?.need).toBe(103 + 212);
  });

  it("fits with the space the engine keeps free to spare, as its disk guard checks, and no less", () => {
    expect(diskCheck(disk(277 + 1024), "copy", true, 4)?.fits).toBe(true);
    expect(diskCheck(disk(277 + 1023), "copy", true, 4)?.fits).toBe(false);
  });

  it("is not said when the engine doesn't say it: before API 1.7, or a space or size it can't measure", () => {
    expect(diskCheck(undefined, "copy", true, 4)).toBeNull();
    expect(diskCheck({ ...disk(5000), case: null }, "copy", true, 4)).toBeNull();
    expect(diskCheck(disk(null), "copy", true, 4)).toBeNull();
    expect(diskCheck(disk(5000, { solveMb: null, continueMb: null }), "copy", true, 4)).toBeNull();
    expect(diskCheck(disk(5000, { transientMb: null }), "transient", true, 4)).toBeNull();
    expect(diskCheck(disk(5000, { transientMb: null }), "copy", true, 4)?.need).toBe(277);
  });

  it("is worded as the engine words it", () => {
    expect([0, 70, 1023, 2458, 421_888, 1_200_000].map(diskSpace))
      .toEqual(["1 MB", "70 MB", "1,023 MB", "2.4 GB", "412 GB", "1,172 GB"]);
  });
});
