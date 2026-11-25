// SPDX-License-Identifier: GPL-3.0-or-later
// The Pictures screen's words and checks: a set's name, address and title, the set a picture job makes, the written
// times a run can be pictured at (the split ones too, on an engine that joins one first) and those a cut over time
// reads, a mean flow's swings beside the same time's instant, and the memory a picture job takes.
import { describe, expect, it } from "vitest";
import type { Job, MachineInfo, Run } from "@/engine/types";
import {
  MAX_TIMES, drawsFastest, hasMeanFlow, jobOfSet, joinsTimes, kindInfo, kindsText, makesOverTime, makingPictures,
  overTimes, parseSet,
  pictureFileName, pictureTimes, picturesMemory, setHeading, setName, setOfJob, setPath, setShown, setTitle, splitTimes,
  swings, timeName,
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
    expect(kindsText(["cuts", "times", "fastest"])).toBe("cuts, a cut over time and the cells that set the time step");
    expect(kindInfo("fastest")?.label).toBe("The cells that set the time step");
    expect(["1.21", "1.30", "2.0"].map(drawsFastest)).toEqual([true, true, true]);      // API 1.21
    expect(["1.20", "1.2", "", null].map(drawsFastest)).toEqual([false, false, false, false]);
    expect(kindsText(["cuts", "vortices", "spots"])).toBe("cuts, vortices and spots");
    expect(kindsText(["cuts", "times"])).toBe("cuts and a cut over time");
    expect(kindInfo("times")?.label).toBe("Over time");
    expect(kindInfo("cuts")?.label).toBe("Cuts");
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

  it("of a mean flow puts each cut's swing beside its mean speed and the speed at the same time, from that time's set", () => {
    const pic = (file: string) => ({ file, kind: "cuts" as const, title: file });
    const mean = { pictures: [pic("cuts/a1_U.png"), pic("cuts/a1_Urms.png"), pic("cuts/a2_Cpt.png"), pic("cuts/a2_Urms.png")] };
    const instant = { pictures: [pic("cuts/a1_Cp.png"), pic("cuts/a1_U.png")] };
    expect(swings(mean, instant)).toEqual([
      { cut: "a1", mean: 0, swing: 1, instant: 1 },
      { cut: "a2", mean: null, swing: 3, instant: null },
    ]);
    expect(swings(mean).map((r) => r.instant)).toEqual([null, null]);     // no set of that time
    expect(swings(instant)).toEqual([]);                                   // no swing: not a mean flow's
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

  it("are each one it keeps, the split ones too, on an engine that joins one first (API 1.19)", () => {
    expect(["1.19", "1.20", "2.0"].map(joinsTimes)).toEqual([true, true, true]);
    expect(["1.18", "1.2", "1.0", "", null, undefined].map(joinsTimes)).toEqual([false, false, false, false, false, false]);
    const r = { times: [100, 200, 300], joined: [300], averaging: null } as Pick<Run, "times" | "joined" | "averaging">;
    expect(pictureTimes(r, false)).toEqual(["300"]);
    expect(pictureTimes(r, false, true)).toEqual(["300", "200", "100"]);
    expect([...splitTimes(r)]).toEqual(["100", "200"]);
    expect(splitTimes({ times: [300], joined: [300] }).size).toBe(0);
    // a run that lists only its joined times: those
    expect(pictureTimes(run([300]), false, true)).toEqual(["300"]);
    expect(splitTimes({ joined: [300] }).size).toBe(0);
  });

  it("of a cut over time are those up to the one pictured, oldest first, on an engine that makes one (API 1.20)", () => {
    expect(["1.20", "1.21", "2.0"].map(makesOverTime)).toEqual([true, true, true]);
    expect(["1.19", "1.2", "", null].map(makesOverTime)).toEqual([false, false, false, false]);
    const r = { times: [100, 200, 300, 400], joined: [200, 400], averaging: null } as Pick<Run, "times" | "joined" | "averaging">;
    expect(overTimes(r, "300", false)).toEqual({ times: ["100", "200", "300"], split: true });
    expect(overTimes(r, "", false).times).toEqual(["100", "200", "300", "400"]);      // up to the latest
    expect(overTimes({ ...r, times: [200, 400] }, "", false)).toEqual({ times: ["200", "400"], split: false });
    // with its mean flow: those written with it
    const t = { times: [0.0002, 0.0004, 0.0006], joined: [0.0006], averaging: { from: 0.0003, settled: null, written: 0.0006 } };
    expect(overTimes(t as Pick<Run, "times" | "joined" | "averaging">, "", true)).toEqual({ times: ["0.0004", "0.0006"], split: true });
    expect(MAX_TIMES).toBe(50);
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

  it("with a cut over time is 1.4 KB a cell read joined and 1.9 read split, as the engine's RAM guard counts it", () => {
    expect(picturesMemory(478_901, machine(16_384), "joined")).toMatchObject({ need: 1.1, fits: true });
    expect(picturesMemory(478_901, machine(16_384), "split")).toMatchObject({ need: 1.4, fits: true });
    expect(picturesMemory(12_300_000, machine(32_768), "split")).toMatchObject({ need: 22.8, have: 32, fits: true });
    expect(picturesMemory(31_100_000, machine(32_768), "joined")).toMatchObject({ need: 42, fits: false });
  });

  it("isn't checked here when the case's size or the computer's memory isn't known", () => {
    expect(picturesMemory(null, machine(16_384))).toBeNull();
    expect(picturesMemory(0, machine(16_384))).toBeNull();
    expect(picturesMemory(480_000, undefined)).toBeNull();
  });
});
