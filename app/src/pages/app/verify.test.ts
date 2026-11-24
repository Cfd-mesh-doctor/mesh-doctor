// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Job, Run, RunValidation } from "@/engine/types";
import { VERIFY as DOC_COMMAND } from "@/pages/accuracy/results";
import { runRows } from "./solveStart";
import {
  VERIFY, VERIFY_NAME, isVerifyName, signedPercent, verifyCases, verifyCommand, verifyName, verifyNameProblem,
  verifyProcs, verifyRow, verifyStage, verifyTaken, verifyTime, verifyVerdict,
} from "./verify";

const run = (name: string, more: Partial<Run> = {}): Run => ({
  name, state: "done", step: "done", iteration: 2000, start: 0, end: 2000, written: 2000, nProcs: 6,
  stretches: [{ from: 0, to: 2000 }], started: "2026-11-23T21:09:54Z", updated: "2026-11-23T21:24:19Z",
  finished: "2026-11-23T21:24:19Z", error: null, ...more,
});
const job = (name: string, state: Job["state"], kind: Job["kind"] = "solve", params: Job["params"] = { name }) =>
  ({ id: `${name}-${state}`, kind, name, state, params }) as Job;

/** GET /runs/verify-install/validation as a real coarse run with OpenFOAM 14 answered it. */
const MATCHING: RunValidation = {
  name: "verify-install", state: "done", template: "ahmed-body", size: "coarse", slant: 25, cells: 478_901,
  iterations: 2000, window: 500, cd: 0.2986, cl: 0.2978, drift: -0.11,
  tunnel: { cd: 0.285, difference: 4.76 },
  published: { cd: 0.299, cl: 0.298, iterations: 2000, difference: -0.15 },
  comparable: true, matches: true,
};

describe("Verify install's run", () => {
  it("is verify-install, or verify-install-2, -3… for another; a new one takes the first free name", () => {
    expect(["verify-install", "verify-install-2", "verify-install-10"].every(isVerifyName)).toBe(true);
    expect(["verify-install-0", "verify-install-x", "verify-installs", "my-verify-install", "ahmed-coarse"].some(isVerifyName))
      .toBe(false);
    expect(verifyName(new Set())).toBe(VERIFY_NAME);
    expect(verifyName(new Set(["verify-install", "verify-install-2"]))).toBe("verify-install-3");
  });

  it("can't take a name a case, a run, or a new case's or a solve job's has", () => {
    const taken = verifyTaken(["mine"], [run("cut-short")], [job("making", "running", "case"), job("old", "done"),
      job("fix", "running", "repair")]);
    expect([...taken].sort()).toEqual(["cut-short", "making", "mine", "old"]);
    expect(verifyNameProblem("mine", taken)).toMatch(/has this name already/);
    expect(verifyNameProblem("", taken)).toBe("Give it a name.");
    expect(verifyNameProblem("../x", taken)).toMatch(/^Use only letters/);
    expect(verifyNameProblem("verify-install", taken)).toBeNull();
  });

  it("is the one solving or waiting, else the one solved last", () => {
    const rows = runRows({ "verify-install": { template: "ahmed-body" }, "verify-install-2": { template: "ahmed-body" },
      ahmed: { template: "ahmed-body" } },
    [run("verify-install", { updated: "2026-11-23T10:00:00Z" }), run("verify-install-2", { updated: "2026-11-23T11:00:00Z" }),
      run("ahmed", { updated: "2026-11-23T12:00:00Z" })], []);
    expect(verifyRow(rows)?.name).toBe("verify-install-2");
    const working = runRows({ "verify-install": { template: "ahmed-body" } }, [run("verify-install-2")],
      [job("verify-install", "running")]);
    expect(verifyRow(working)?.name).toBe("verify-install");
    expect(verifyRow(runRows({ ahmed: { template: "ahmed-body" } }, [run("ahmed")], []))).toBeUndefined();
  });

  it("is being made or solved, ended at 2,000 to compare, short of it to continue, or to make again", () => {
    const stage = (r: Run | null, j?: Job) => verifyStage(runRows({}, r ? [r] : [], j ? [j] : [])[0]);
    expect(verifyStage(undefined)).toBe("none");
    expect(stage(null, job("verify-install", "queued"))).toBe("working");
    expect(stage(run("verify-install", { state: "running", step: "meshing: blockMesh", written: 0 }),
      job("verify-install", "running"))).toBe("working");
    expect(stage(run("verify-install"))).toBe("ended");
    expect(stage(run("verify-install", { written: 3000 }))).toBe("ended");
    expect(stage(run("verify-install", { state: "stopped", written: 1200 }))).toBe("short");
    expect(stage(run("verify-install", { state: "interrupted", written: 1500 }))).toBe("short");
    expect(stage(run("verify-install", { state: "failed", written: 1500, error: "the solve failed at foamRun" })))
      .toBe("again");
    expect(stage(run("verify-install", { state: "cancelled", written: 0, step: "meshing: checkMesh" }))).toBe("again");
  });

  it("is the command the accuracy check's page gives, on the processes it is suggested to run on", () => {
    expect([verifyCommand(VERIFY_NAME, VERIFY.np)]).toEqual(DOC_COMMAND);
    expect(verifyCommand("verify-install-2", 4)).toBe(
      "meshdoctor solve verify-install-2 --template ahmed-body --size coarse --to 2000 --np 4");
    expect([verifyProcs(16), verifyProcs(4), verifyProcs(undefined)]).toEqual([6, 4, 6]);
  });
});

describe("Verify install's comparison", () => {
  it("writes a difference as the accuracy check does", () => {
    expect([signedPercent(4.76), signedPercent(-0.15, 2), signedPercent(-0.04), signedPercent(0)])
      .toEqual(["+4.8 %", "−0.15 %", "0.0 %", "0.0 %"]);
  });

  it("says whether the install gives the accuracy check's answer", () => {
    expect(verifyVerdict(MATCHING)).toEqual({ tone: "success", badge: "Same answer", said: expect.stringMatching(
      /^Its drag is within 2 % of the accuracy check's run of the same mesh \(Cd 0\.299\): your install gives/) });
    const off = verifyVerdict({ ...MATCHING, cd: 0.31, published: { ...MATCHING.published, difference: 3.68 },
      matches: false });
    expect([off.tone, off.badge]).toEqual(["warning", "A different answer"]);
    expect(off.said).toMatch(/^Its drag is \+3\.7 % from the accuracy check's run .*, more than 2 %: something in your setup/);
    const short = verifyVerdict({ ...MATCHING, iterations: 1500, comparable: false, matches: false });
    expect([short.tone, short.said]).toEqual(["neutral", expect.stringMatching(
      /^Solved to iteration 1,500, and the accuracy check's run .* went to 2,000: continue it there to compare\.$/)]);
  });

  it("takes as long as its one stretch did, with its mesh", () => {
    expect(verifyTime(run("v"))).toBe("14 min");
    expect(verifyTime(run("v", { finished: "2026-11-23T23:30:00Z" }))).toBe("2.3 h");
    expect(verifyTime(run("v", { stretches: [{ from: 0, to: 1200 }, { from: 1200, to: 2000 }] }))).toBe("");
    expect(verifyTime(run("v", { finished: null }))).toBe("");
    expect(verifyTime(null)).toBe("");
  });

  it("draws the accuracy check's run of the same mesh and yours, as that check draws its cases", () => {
    const [theirs, ours] = verifyCases(MATCHING, "14 min");
    expect(theirs).toEqual({ name: "Accuracy check, coarse mesh", cells: "0.48 M", cd: 0.299, tunnel: 0.285,
      difference: "+4.8 %", drift: "−0.11 %", cl: 0.298, time: "14 min", miss: false });
    expect(ours).toEqual({ name: "Your install, coarse mesh", cells: "0.48 M", cd: 0.2986, tunnel: 0.285,
      difference: "+4.8 %", drift: "−0.11 %", cl: 0.2978, time: "14 min with its mesh", miss: false, window: 500 });
    expect(verifyCases({ ...MATCHING, cells: null }, "")[1]).toMatchObject({ cells: "", time: "" });
  });
});
