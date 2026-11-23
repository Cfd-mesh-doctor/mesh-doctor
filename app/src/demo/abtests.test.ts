// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { api } from "@/engine/client";
import { toMillis } from "@/lib/format";
import { RECORDED } from "@/report/samples";
import { DEMO_JUDGE_NOTE, DEMO_LIVE_NOTE, RECORDED_ABTESTS, briefOf, demoAbtest, historyTable } from "./abtests";
import judges from "./judges.json";
import { demoTransport } from "./transport";

describe("the demo's A/B tests", () => {
  it("are the recorded reports that hold one", async () => {
    const withAb: string[] = [];
    for (const r of RECORDED) {
      const doc = (await r.load()).default as { documents?: Record<string, unknown> };
      if (doc.documents && "abtest" in doc.documents) withAb.push(r.name);
    }
    expect(withAb.sort()).toEqual([...RECORDED_ABTESTS]);
  });

  it("are listed with each one's step and outcome, as the engine lists them", async () => {
    const t = demoTransport(undefined, 0);
    const list = await api.abtests(t);
    expect(list.items).toEqual(["ahmed25-coarse-fix", "ahmed25-medium-fix"]);
    const coarse = list.tests?.["ahmed25-coarse-fix"], medium = list.tests?.["ahmed25-medium-fix"];
    // The recording's repair moved no point, so both runs solved the same mesh: every ratio is 1.
    expect(coarse).toMatchObject({ step: "done", ratios: { p: 1, Ux: 1, Uy: 1, Uz: 1, k: 1, omega: 1 }, verdict: null });
    expect(toMillis(coarse?.finished)).toBeLessThan(Date.now());
    // The job list has the medium test solving its repaired-mesh run, so it has no outcome yet.
    expect(medium).toMatchObject({ step: "solving fixed", finished: null, ratios: {}, verdict: null });
    expect(toMillis(medium?.updated)).toBeLessThan(Date.now());
  });

  it("answer as the engine does: the result without the residual histories, which come as tables", async () => {
    const t = demoTransport(undefined, 0);
    const done = await api.abtest(t, "ahmed25-coarse-fix");
    expect(done.status).toMatchObject({ step: "done" });
    expect(done.result?.base).not.toHaveProperty("residualHistory");
    expect(done.result).not.toHaveProperty("fixedFull");
    expect(done.live.base?.cols).toEqual(["Time", "p", "Ux", "Uy", "Uz", "k", "omega"]);
    expect([done.live.base?.rows.length, done.live.fixed?.rows.length]).toEqual([200, 200]);
    expect(done.modes).toEqual([]);
    // The same moment as the report's A/B test says.
    const report = await api.report(t, "ahmed25-coarse-fix");
    expect(done.result?.finished).toBe(report.documents.abtest?.finished);
  });

  it("answer a test still solving with its original-mesh run alone", async () => {
    const t = demoTransport(undefined, 0);
    const going = await api.abtest(t, "ahmed25-medium-fix");
    expect(going.status?.step).toBe("solving fixed");
    expect(going.result).toHaveProperty("base");
    for (const key of ["fixed", "finished", "residualRatioFixedOverBase", "sourceCheck", "baseHotspots"]) {
      expect(going.result).not.toHaveProperty(key);
    }
    expect(going.live.base?.rows).toHaveLength(200);
    expect(going.live.fixed).toBeNull();
  });

  it("have no live monitor, and the judge only on the runs that ended", async () => {
    const t = demoTransport(undefined, 0);
    await expect(api.abtestLive(t, "ahmed25-medium-fix")).rejects.toMatchObject({ code: "unavailable", message: DEMO_LIVE_NOTE });
    await expect(api.abtestJudge(t, "ahmed25-coarse-fix", "fixed")).resolves.toMatchObject({ verdict: "still converging", window: 100 });
    await expect(api.abtestJudge(t, "ahmed25-medium-fix", "base")).resolves.toMatchObject({ run: "ahmed25-medium-fix_ab/base" });
    await expect(api.abtestJudge(t, "ahmed25-medium-fix", "fixed")).rejects.toMatchObject({ code: "not-found", message: DEMO_JUDGE_NOTE });
    await expect(api.abtest(t, "nothing-fix")).rejects.toMatchObject({ code: "not-found" });
    expect(Object.keys(judges).sort()).toEqual(["ahmed25-coarse-fix/base", "ahmed25-coarse-fix/fixed", "ahmed25-medium-fix/base"]);
    expect(JSON.stringify(judges)).not.toMatch(/\/home\/|\/mnt\/|[A-Z]:\\\\/); // the recording names no folder
  });

  it("turn a residual history into the engine's table, and back into the list's brief", () => {
    expect(historyTable({ Time: [1, 2], p: [0.1, "x"], note: "not a field" })).toEqual({ cols: ["Time", "p"], rows: [[1, 0.1], [2, null]] });
    expect(historyTable({ p: [0.1] })).toBeNull();
    const d = demoAbtest({ finished: "2026-11-21T19:05:52Z", residualRatioFixedOverBase: { p: 0.5, U: null }, fixedJudge: { verdict: "converged" } }, null);
    expect(briefOf(d)).toEqual({ step: "done", updated: "2026-11-21T19:05:52Z", finished: "2026-11-21T19:05:52Z", ratios: { p: 0.5 }, verdict: "converged" });
    expect(demoAbtest({}, { step: "solving base", time: null }).status).toEqual({ step: "solving base" });
  });
});
