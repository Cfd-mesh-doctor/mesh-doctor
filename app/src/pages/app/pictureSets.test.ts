// SPDX-License-Identifier: GPL-3.0-or-later
// The Pictures screen's words and checks: a set's name, address and title, the set a picture job makes, the written
// times a run can be pictured at, and the memory a picture job takes.
import { describe, expect, it } from "vitest";
import type { Job, MachineInfo, Run } from "@/engine/types";
import {
  hasMeanFlow, jobOfSet, kindsText, makingPictures, parseSet, pictureFileName, pictureTimes, picturesMemory, setHeading,
  setName, setOfJob, setPath, setShown, setTitle, timeName,
} from "./pictureSets";

const job = (id: string, state: Job["state"], params: Record<string, unknown>, kind: Job["kind"] = "pictures") =>
  ({ id, kind, name: String(params.name), state, params }) as Job;

const run = (joined: number[], averaging: Run["averaging"] = null) => ({ joined, averaging }) as Pick<Run, "joined" | "averaging">;

describe("a set of pictures", () => {
  it("is named by the time it pictures, with _mean for a transient run's mean flow, as the engine names its folder", () => {
    expect(setName("2000", false)).toBe("2000");
    expect(setName("0.0006", true)).toBe("0.0006_mean");
    expect(parseSet("0.0006_mean")).toEqual({ time: "0.0006", mean: true });
    expect(parseSet("2000")).toEqual({ time: "2000", mean: false });
    expect(setPath("my case", "0.0006_mean")).toBe("/pictures/my%20case/0.0006_mean");
  });

  it("says what it pictures and has in words", () => {
    expect(setTitle({ time: "2000", mean: false })).toBe("written time 2000");
    expect(setTitle({ time: "0.0006", mean: true })).toBe("the mean flow to 0.0006 s");
    expect(setHeading({ time: "2000", mean: false })).toBe("Written time 2000");
    expect(kindsText(["cuts"])).toBe("cuts");
    expect(kindsText(["cuts", "spots"])).toBe("cuts and spots");
    expect(kindsText(["cuts", "vortices", "spots"])).toBe("cuts, vortices and spots");
  });

  it("is being made while its job waits or runs, else made, or how its job ended", () => {
    expect(setShown({ made: null, job: { id: "j", state: "queued" } })).toBe("making");
    expect(setShown({ made: "2026-11-24T12:00:00Z", job: { id: "j", state: "running" } })).toBe("making");
    expect(setShown({ made: "2026-11-24T12:00:00Z", job: { id: "j", state: "failed" } })).toBe("made");
    expect(setShown({ made: "2026-11-24T12:00:00Z", job: null })).toBe("made");
    expect(setShown({ made: null, job: { id: "j", state: "cancelled" } })).toBe("cancelled");
    expect(setShown({ made: null, job: { id: "j", state: "failed" } })).toBe("failed");
  });

  it("is saved under its case, its name and its file", () => {
    expect(pictureFileName("ahmed", "2000", "cuts/c1_side_centre_U.png")).toBe("ahmed_2000_cuts_c1_side_centre_U.png");
  });
});

describe("a picture job", () => {
  it("makes the set its case, time and mean flow name; any other job makes none", () => {
    expect(setOfJob(job("a", "running", { name: "ahmed", time: "2000", kinds: ["cuts"], mean: false })))
      .toEqual({ name: "ahmed", set: "2000" });
    expect(setOfJob(job("b", "done", { name: "t", time: "0.0006", mean: true }))).toEqual({ name: "t", set: "0.0006_mean" });
    expect(setOfJob(job("c", "queued", { name: "t", time: "" }))).toBeNull();
    expect(setOfJob(job("d", "done", { name: "ahmed", time: "2000" }, "solve"))).toBeNull();
  });

  it("of a set is the newest that made it (the engine lists the newest first)", () => {
    const jobs = [
      job("3", "running", { name: "other", time: "2000" }),
      job("2", "failed", { name: "ahmed", time: "2000" }),
      job("1", "done", { name: "ahmed", time: "2000" }),
      job("0", "done", { name: "ahmed", time: "1000" }),
    ];
    expect(jobOfSet(jobs, "ahmed", "2000")?.id).toBe("2");
    expect(jobOfSet(jobs, "ahmed", "1000")?.id).toBe("0");
    expect(jobOfSet(jobs, "ahmed", "3000")).toBeUndefined();
    expect(makingPictures(jobs)).toBe(true);
    expect(makingPictures(jobs, "other")).toBe(true);
    expect(makingPictures(jobs, "ahmed")).toBe(false);
    expect(makingPictures(undefined)).toBe(false);
  });
});

describe("the times a run can be pictured at", () => {
  it("are its joined times, newest first, named as their folders are", () => {
    expect(pictureTimes(run([100, 300, 200]), false)).toEqual(["300", "200", "100"]);
    expect(timeName(0.00060000000000001)).toBe("0.0006");
    expect(timeName(2000)).toBe("2000");
    expect(pictureTimes(run([]), false)).toEqual([]);
  });

  it("with its mean flow, are those written after its averaging started, up to the latest written with it", () => {
    const t = run([0.0001, 0.0002, 0.0004, 0.0006, 0.0008], { from: 0.0002, settled: 0.00015, written: 0.0006 });
    expect(hasMeanFlow(t)).toBe(true);
    expect(pictureTimes(t, true)).toEqual(["0.0006", "0.0004"]);
    expect(pictureTimes(t, false)).toHaveLength(5);
    const steady = run([100]);
    expect(hasMeanFlow(steady)).toBe(false);
    expect(pictureTimes(steady, true)).toEqual([]);
  });
});

describe("a picture job's memory", () => {
  const machine = (memoryMb: number, ramLimitMb: number | null = null): MachineInfo =>
    ({ cpus: 8, cores: 4, memoryMb, ramLimitMb }) as MachineInfo;

  it("is 0.6 KB a cell and 0.5 GB to spare, and fits under 90 % of the engine's computer's memory", () => {
    // 31.1 million cells: 17.8 GB and 0.5 GB to spare
    expect(picturesMemory(31_100_000, machine(65_536))).toEqual({ need: 18.3, have: 64, limited: false, fits: true });
    expect(picturesMemory(31_100_000, machine(16_384))).toMatchObject({ need: 18.3, have: 16, fits: false });
    expect(picturesMemory(478_901, machine(65_536, 25_600))).toEqual({ need: 0.8, have: 25, limited: true, fits: true });
  });

  it("isn't checked here when the case's size or the computer's memory isn't known", () => {
    expect(picturesMemory(null, machine(16_384))).toBeNull();
    expect(picturesMemory(0, machine(16_384))).toBeNull();
    expect(picturesMemory(480_000, undefined)).toBeNull();
  });
});
