// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { elapsed, formatCells, formatDuration, formatPercent, formatRelative, toMillis } from "@/lib/format";
import { EngineError, explain } from "./errors";
import { ACTIVE_POLL_MS, IDLE_POLL_MS, jobsPollInterval } from "./hooks";
import { browserCantReachLocal } from "./permission";
import type { Job, JobList, RepairSummary } from "./types";
import { caseName, improvedCleanly, latestFinished, madeWorse, runStep, runUpdated, verdictText } from "./verdict";

const job = (state: Job["state"]): Job => ({
  schemaVersion: "1.0", id: `20261121-120000-repair-x-${state.slice(0, 4).padEnd(4, "0")}`, kind: "repair",
  params: {}, name: "x", state, runner: "local", created: "2026-11-21T18:00:00Z", log: "x.log",
});

describe("verdicts", () => {
  it("puts the engine's lists into words", () => {
    expect(verdictText({ improved: ["nSkew", "maxSkewness"], regressions: [], unchanged: [] })).toMatchObject({
      tone: "success", label: "Improved 2",
    });
    expect(verdictText({ improved: ["a", "b"], regressions: ["c"], unchanged: [] })).toMatchObject({
      tone: "warning", label: "2 better, 1 worse",
    });
    expect(verdictText({ improved: [], regressions: ["c"], unchanged: [] })).toMatchObject({ tone: "danger" });
    expect(verdictText({ improved: [], regressions: [], unchanged: ["nSkew"] })).toMatchObject({ label: "Unchanged" });
    expect(verdictText(null)).toBeNull();
  });

  it("counts a repair as clean only with no regression", () => {
    expect(improvedCleanly({ improved: ["a"], regressions: [], unchanged: [] })).toBe(true);
    expect(improvedCleanly({ improved: ["a"], regressions: ["b"], unchanged: [] })).toBe(false);
    expect(improvedCleanly(undefined)).toBe(false);
    expect(madeWorse({ improved: ["a"], regressions: ["b"], unchanged: [] })).toBe(true);
    expect(madeWorse({ improved: ["a"], regressions: [], unchanged: [] })).toBe(false);
    expect(madeWorse(null)).toBe(false);
  });

  it("reads where an unfinished run stopped", () => {
    const run = { name: "x", status: { step: "checkMesh (before)", time: "2026-11-21 13:19:07" } };
    expect(runStep(run)).toBe("checkMesh (before)");
    expect(runUpdated(run)).toBe("2026-11-21 13:19:07");
    expect(runStep({ name: "y", status: {} })).toBeNull();
    expect(runUpdated({ name: "y", status: { time: 5 } })).toBeNull();
  });

  it("finds the case name in a worker path", () => {
    expect(caseName("/home/user/cases/ahmed-25-coarse")).toBe("ahmed-25-coarse");
    expect(caseName("/home/user/cases/ahmed/")).toBe("ahmed");
    expect(caseName("C:\\cases\\wing")).toBe("wing");
    expect(caseName(null)).toBeNull();
  });
});

describe("polling", () => {
  it("is quick only while a job is active", () => {
    const list = (...s: Job["state"][]): JobList => ({ items: s.map(job) });
    expect(jobsPollInterval(list("done", "running"))).toBe(ACTIVE_POLL_MS);
    expect(jobsPollInterval(list("queued"))).toBe(ACTIVE_POLL_MS);
    expect(jobsPollInterval(list("done", "failed", "cancelled"))).toBe(IDLE_POLL_MS);
    expect(jobsPollInterval(undefined)).toBe(IDLE_POLL_MS);
  });
});

describe("errors in plain words", () => {
  it("has a fix for the usual problems", () => {
    expect(explain(new EngineError("unreachable", "x"), "https://app.test")).toMatchObject({
      command: "meshdoctor serve",
    });
    expect(explain(new EngineError("unreachable", "x"), "https://app.test").hint).toContain("https://app.test");
    expect(explain(new EngineError("permission-denied", "x")).title).toMatch(/blocked/);
    expect(explain(new EngineError("busy", "x")).title).toMatch(/Another OpenFOAM job/);
    expect(explain(new Error("boom")).hint).toBe("boom");
  });
});

describe("browsers", () => {
  it("knows Safari can't reach localhost, and others can", () => {
    const safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
    const edge = `${chrome} Edg/142.0.0.0`;
    expect(browserCantReachLocal(safari)).toBe(true);
    expect(browserCantReachLocal(chrome)).toBe(false);
    expect(browserCantReachLocal(edge)).toBe(false);
  });
});

describe("formats", () => {
  it("formats durations, sizes and shares", () => {
    expect(formatDuration(12)).toBe("12 s");
    expect(formatDuration(252)).toBe("4 min 12 s");
    expect(formatDuration(7500)).toBe("2 h 05 min");
    expect(formatDuration(null)).toBe("–");
    expect(formatCells(478901)).toBe("479 k");
    expect(formatCells(1565115)).toBe("1.57 M");
    expect(formatCells(31_100_000)).toBe("31.1 M");
    expect(formatPercent(0.4)).toBe("40 %");
    expect(formatPercent(1.7)).toBe("100 %");
  });

  it("measures time between ISO stamps", () => {
    expect(elapsed("2026-11-21T19:00:00Z", "2026-11-21T19:01:30Z")).toBe(90);
    expect(elapsed(null)).toBeNull();
    const now = Date.parse("2026-11-21T19:10:00Z");
    expect(formatRelative("2026-11-21T19:09:50Z", now)).toBe("just now");
    expect(formatRelative("2026-11-21T19:05:00Z", now)).toBe("5 minutes ago");
    // repairs give the worker's local time without a zone; it must parse everywhere, Safari included
    expect(toMillis("2026-11-21 13:01:32")).toBe(new Date(2026, 10, 21, 13, 1, 32).getTime());
    expect(toMillis("")).toBeNaN();
  });
});

describe("the latest finished repair run", () => {
  const run = (name: string, finished: string | null): RepairSummary =>
    ({ name, finished, nCells: null, profile: null, source: null, status: {}, verdict: null });

  it("is the one that finished last by the worker's clock, whatever the list's order", () => {
    expect(latestFinished([run("a", "2026-11-20 23:59:59"), run("b", "2026-11-21 00:00:00"), run("c", "2026-11-09 12:00:00")])).toBe("b");
    expect(latestFinished([run("b", "2026-11-21 00:00:00"), run("a", "2026-11-20 23:59:59")])).toBe("b");
  });

  it("is none before a run has finished", () => {
    expect(latestFinished([run("running", null)])).toBeNull();
    expect(latestFinished([])).toBeNull();
    expect(latestFinished()).toBeNull();
  });
});
