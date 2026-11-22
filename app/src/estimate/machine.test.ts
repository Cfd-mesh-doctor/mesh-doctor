// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { machineFields } from "./machine";

const m = (memoryMb: number | null, ramLimitMb: number | null, cores: number | null, cpus: number | null = 16) =>
  machineFields({ cpus, cores, memoryMb, ramLimitMb });

describe("what the engine's computer fills in", () => {
  it("takes all of Linux's memory, rounded down to 0.1 GB, and the physical cores", () => {
    expect(m(26_052, null, 8)).toEqual({ ram: 25.4, cores: 8 });
    expect(m(25_600, null, 8)).toEqual({ ram: 25, cores: 8 });
  });

  it("takes the RAM limit when it is lower, and says so", () => {
    expect(m(26_052, 20_480, 8)).toEqual({ ram: 20, limited: true, cores: 8 });
    expect(m(null, 20_480, 8)).toEqual({ ram: 20, limited: true, cores: 8 });
    expect(m(26_052, 64_000, 8)).toEqual({ ram: 25.4, cores: 8 });
  });

  it("counts processors when the cores are unknown", () => {
    expect(m(26_052, null, null, 12)).toEqual({ ram: 25.4, cores: 12 });
  });

  it("leaves out what the engine doesn't know or the estimator would refuse", () => {
    expect(m(null, null, null, null)).toEqual({});
    expect(m(300, null, 0, 0)).toEqual({});
    expect(m(26_052, 0, null, null)).toEqual({ ram: 25.4 });
  });
});
