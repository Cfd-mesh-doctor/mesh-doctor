// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from "vitest";
import { api } from "@/engine/client";
import type { CompareAsk, Job } from "@/engine/types";
import { DEMO_CLUSTERS_NOTE, RECORDED_CLUSTERS, recordedCluster } from "./clusters";
import clusters from "./clusters.json";
import recorded from "./fixtures.json";
import compared from "./compare.json";
import forces from "./forces.json";
import forcesAb from "./forces-ab.json";
import forcesMedium from "./forces-medium.json";
import {
  DEMO_AB_FORCES_NOTE, DEMO_COMPARE_NOTE, DEMO_RESULTS_NOTE, RECORDED, RECORDED_COMPARE_AB, RECORDED_RESULTS,
} from "./results";
import results from "./results.json";
import resultsMedium from "./results-medium.json";
import { demoTransport, shiftTimes, withCaseSizes } from "./transport";

const job = (id: string, state: Job["state"], at: string): Job => ({
  schemaVersion: "1.0", id, kind: "repair", params: {}, name: id, state, runner: "local", created: at, started: at, log: "x.log",
});

const answers = () => ({
  "/": { apiVersion: "1.0", schemas: {} },
  "/jobs": {
    items: [job("20261121-120000-repair-a-0001", "running", "2026-11-21T18:00:00Z"),
      job("20261121-110000-repair-b-0002", "done", "2026-11-21T17:00:00Z")],
  },
});

describe("demo transport", () => {
  it("answers recorded routes and nothing else", async () => {
    const t = demoTransport(answers(), 0);
    await expect(api.info(t)).resolves.toMatchObject({ apiVersion: "1.0" });
    await expect(api.repairs(t)).rejects.toMatchObject({ code: "not-found" });
  });

  it("cancels a running job for the rest of the visit", async () => {
    const data = answers();
    const t = demoTransport(data, 0);
    const out = await api.cancelJob(t, "20261121-120000-repair-a-0001");
    expect(out.state).toBe("cancelled");
    const jobs = await api.jobs(t);
    expect(jobs.items[0]?.state).toBe("cancelled");
    expect(data["/jobs"].items[0]?.state).toBe("running"); // the recording itself is untouched
    await expect(api.cancelJob(t, "20261121-110000-repair-b-0002")).rejects.toMatchObject({ code: "finished" });
  });

  it("has the gallery's set of pictures, serves them, and deletes it for the rest of the visit only", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([0x89, 0x50]), { headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", fetch);
    try {
      const t = demoTransport(answers(), 0);
      const sets = await api.pictureSets(t, null);
      expect(sets.items).toEqual([expect.objectContaining({ case: "ahmed-25-medium", set: "2000", count: 5, job: null })]);
      await expect(api.pictureSets(t, "another")).resolves.toEqual({ items: [] });
      const set = await api.pictureSet(t, "ahmed-25-medium", "2000");
      expect(set.pictures.map((p) => p.kind)).toEqual(["cuts", "cuts", "cuts", "vortices", "vortices"]);
      const blob = await api.picture(t, "ahmed-25-medium", "2000", "cuts/c1_side_centre_U.png");
      expect(blob.size).toBe(2);
      expect(String((fetch.mock.calls[0] as unknown[])[0])).toMatch(/ahmed_c1_side_centre_U/);
      await expect(api.picture(t, "ahmed-25-medium", "2000", "cuts/nothing.png")).rejects.toMatchObject({ code: "not-found" });
      await expect(api.deletePictures(t, "ahmed-25-medium", "2000"))
        .resolves.toEqual({ case: "ahmed-25-medium", set: "2000", deleted: 5 });
      await expect(api.pictureSets(t, null)).resolves.toEqual({ items: [] });
      await expect(api.pictureSet(t, "ahmed-25-medium", "2000")).rejects.toMatchObject({ code: "not-found" });
      // the next visit has it again
      await expect(api.pictureSets(demoTransport(answers(), 0), null)).resolves.toMatchObject({ items: [{ set: "2000" }] });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("moves dates only, not the written time a picture job pictures", () => {
    const data = { "/jobs": { items: [{ ...job("j", "done", "2026-11-21T18:00:00Z"), params: { name: "a", time: "300" } }] } };
    shiftTimes(data, Date.parse("2026-11-25T00:00:00Z"));
    expect(data["/jobs"].items[0]?.params).toEqual({ name: "a", time: "300" });
    expect(data["/jobs"].items[0]?.created).toBe("2026-11-24T23:56:00.000Z");
  });

  it("never starts anything", async () => {
    const t = demoTransport(answers(), 0);
    await expect(t.request("POST", "/jobs", { kind: "repair" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("moves recorded times so the newest is a few minutes ago", () => {
    const data = answers();
    const now = Date.parse("2027-03-01T12:00:00Z");
    shiftTimes(data, now);
    const items = data["/jobs"].items;
    expect(Date.parse(items[0]!.started!)).toBe(now - 4 * 60_000);
    expect(Date.parse(items[0]!.started!) - Date.parse(items[1]!.started!)).toBe(3600_000); // gaps kept
  });

  it("ships a recording that the screens can read", async () => {
    const t = demoTransport((recorded as { answers: Record<string, unknown> }).answers, 0);
    const info = await api.info(t);
    expect(info.apiVersion.startsWith("1.")).toBe(true);
    const [cases, jobs, repairs] = await Promise.all([api.cases(t), api.jobs(t), api.repairs(t)]);
    expect(Array.isArray(cases.items)).toBe(true);
    expect(Array.isArray(jobs.items)).toBe(true);
    expect(Array.isArray(repairs.items)).toBe(true);
  });

  it("says each case's size, as the recording's own repairs counted it", async () => {
    // The recording's engine predates API 1.2; these are the cell counts its repairs of each case give.
    expect((await api.cases(demoTransport(undefined, 0))).cells).toEqual({
      "ahmed-25-coarse": 478_901, "ahmed-25-fine": 1_565_115, "ahmed-25-medium": 835_565, "ahmed-35-medium": 837_235,
      pitzDaily: 12_225,
    });
    const repairs = { items: [{ name: "wing-fix", source: "~/cases/wing", nCells: 2_000_000 }] };
    expect(withCaseSizes({ "/cases": { items: ["wing", "bracket"] }, "/repairs": repairs })["/cases"])
      .toEqual({ items: ["wing", "bracket"], cells: { wing: 2_000_000, bracket: null } });
    // an engine that already says is left alone, and so are answers without cases
    const told = { "/cases": { items: ["wing"], cells: { wing: 5 } }, "/repairs": repairs };
    expect(withCaseSizes(told)).toBe(told);
    const none = { "/repairs": repairs };
    expect(withCaseSizes(none)).toBe(none);
  });

  it("has the shapes of three recorded clusters, and says which for any other", async () => {
    const t = demoTransport(answers(), 0);
    const c = await api.cluster(t, "ahmed35-medium-fix", 0, "before");
    expect([c.cells.length, c.cells.filter((f) => f.hot).length, c.ctx.length]).toEqual([30, 6, 69]);
    for (const [run, id, tag] of [["ahmed35-medium-fix", 3, "before"], ["ahmed35-medium-fix", 0, "after"], ["pitzdaily-fix", 0, "before"]] as const) {
      await expect(api.cluster(t, run, id, tag)).rejects.toMatchObject({ code: "not-found", message: DEMO_CLUSTERS_NOTE });
    }
  });

  it("records clusters where the 35° report puts them: their failing faces sit at the cluster's middle", async () => {
    const report = (await import("@/report/samples/ahmed35-medium-fix.mdreport.json")).default;
    const listed = report.documents.repair.clustersBefore;
    for (const id of RECORDED_CLUSTERS.ids) {
      const shape = await recordedCluster(RECORDED_CLUSTERS.run, "before", id);
      const corners = (shape?.cells ?? []).filter((f) => f.hot).flatMap((f) => f.xyz);
      const middle = [0, 1, 2].map((k) => corners.filter((_, i) => i % 3 === k).reduce((a, b) => a + b, 0) / (corners.length / 3));
      const want = listed[id];
      expect(corners.length).toBeGreaterThan(0);
      middle.forEach((v, k) => expect(Math.abs(v - (want?.centroid[k] ?? NaN))).toBeLessThan(3 * (want?.h ?? 0)));
    }
  });

  it("checks its computer as ready just now, with the meshes the engine's RAM guard would let it take", async () => {
    const before = Date.now() - 1000;
    const doc = await api.readiness(demoTransport(answers(), 0));
    expect(doc.ready).toBe(true);
    expect(doc.checks.every((c) => c.state === "ok" && c.fix === null && c.command === null)).toBe(true);
    expect(Date.parse(doc.checked)).toBeGreaterThanOrEqual(before);
    // As ramguard.max_cells works them out: the free memory less 512 MB of headroom, over each job's KB per cell.
    const free = doc.memory.availableMb!;
    expect(doc.memory.cells).toEqual({ repair: Math.floor((free - 512) * 1024 / 1.5), solve: Math.floor((free - 512) * 1024 / 1.35) });
    expect(doc.checks.find((c) => c.id === "memory")?.found).toBe(`${(free / 1024).toFixed(1)} GB available`);
  });

  it("has the results of its recorded cases, their forces written 4 and 5 h ago, and says what it didn't record", async () => {
    const t = demoTransport({ ...answers(), "/cases": { items: [...RECORDED, "ahmed-25-fine"] } }, 0);
    const list = await api.resultsList(t);
    expect(list).toMatchObject({ items: [{ case: RECORDED_RESULTS }, { case: "ahmed-25-medium" }], waiting: [] });
    const doc = await api.caseResults(t, RECORDED_RESULTS, { from: null, to: null });
    expect(doc).toMatchObject({ schemaVersion: "1.1", transient: false, window: { from: 1600, to: 2000, how: "judge", n: 400 } });
    const hours = (Date.now() - Date.parse(doc.updated!)) / 3_600_000;
    expect(hours).toBeGreaterThan(3.99);
    expect(hours).toBeLessThan(4.01);
    // its coefficients are its forces over q, and over its forceCoeffs's own q Aref
    const g = doc.groups[0]!;
    expect(g).toMatchObject({ name: "forceCoeffs", total: true, patches: ["ahmedGroup"] });
    expect(g.CdA).toBeCloseTo(g.drag!.mean / doc.q!, 9);
    expect(g.Cd).toBeCloseTo(g.drag!.mean / (doc.q! * g.Aref!), 9);
    expect(g.LD).toBeCloseTo(g.vertical!.mean / g.drag!.mean, 9);
    await expect(api.caseResults(t, RECORDED_RESULTS, { from: 1000, to: null }))
      .rejects.toMatchObject({ code: "unavailable", message: DEMO_RESULTS_NOTE });
    await expect(api.caseResults(t, "ahmed-25-fine", { from: null, to: null }))
      .rejects.toMatchObject({ code: "unavailable", message: expect.stringContaining(`${RECORDED.join(" and ")} only`) });
    await expect(api.caseResults(t, "nope", { from: null, to: null })).rejects.toMatchObject({ code: "not-found" });

    // its force history: each group's every 4th iteration, the total group first, whose window's mean is its results'
    const h = await api.forceHistory(t, RECORDED_RESULTS);
    expect(h).toMatchObject({ case: RECORDED_RESULTS, transient: false, vertical: "lift" });
    expect(h.groups.map((x) => [x.name, x.total, x.n, x.t.length, x.drag.length, x.vertical.length])).toEqual([
      ["forceCoeffs", true, 501, 501, 501, 501], ["forcesTotal", false, 501, 501, 501, 501],
    ]);
    const f = h.groups[0]!;
    expect([f.t[0], f.t[1], f.t.at(-1)]).toEqual([0, 4, 2000]);
    const inWindow = f.t.flatMap((x, i) => (x > 1600 ? [f.drag[i]!] : []));
    expect(inWindow).toHaveLength(100);
    expect(inWindow.reduce((s, v) => s + v, 0) / inWindow.length).toBeCloseTo(g.drag!.mean, 1);
    await expect(api.forceHistory(t, "ahmed-25-fine")).rejects.toMatchObject({ code: "unavailable" });
    await expect(api.forceHistory(t, "nope")).rejects.toMatchObject({ code: "not-found" });
    await expect(t.request("GET", "/results/nope/more")).rejects.toMatchObject({ code: "not-found" });

    // the medium mesh's, for the comparison: its forces written 5 h ago, its forcesTotal group the total one
    const medium = await api.caseResults(t, "ahmed-25-medium", { from: null, to: null });
    expect(medium).toMatchObject({ case: "ahmed-25-medium", cells: 835_565, window: { from: 1600, to: 2000, n: 400 } });
    expect((Date.now() - Date.parse(medium.updated!)) / 3_600_000).toBeCloseTo(5, 1);
    expect(medium.groups.map((x) => [x.name, x.total])).toEqual([["forcesTotal", true], ["forceCoeffs", false]]);
    const mh = await api.forceHistory(t, "ahmed-25-medium");
    expect(mh.groups.map((x) => [x.name, x.total, x.t.length, x.t.at(-1)])).toEqual([
      ["forcesTotal", true, 501, 2000], ["forceCoeffs", false, 501, 2000],
    ]);
  });

  it("compares the coarse and medium meshes, as a mesh study or two designs, and its finished A/B test's two runs", async () => {
    const t = demoTransport({ ...answers(), "/cases": { items: [...RECORDED, "ahmed-25-fine"] } }, 0);
    const ask = (q: Partial<CompareAsk>) =>
      api.compare(t, { a: null, b: null, abtest: null, mesh: false, from: null, to: null, ...q });
    const [coarse, medium] = RECORDED;
    const mesh = await ask({ a: coarse, b: medium, mesh: true });
    expect(mesh).toMatchObject({ kind: "mesh", a: { case: coarse, cells: 478_901 }, b: { case: medium, cells: 835_565 },
                                 window: { from: 1600, to: 2000, how: "judges" }, vertical: "lift", warnings: [] });
    // each force group paired with the other's by name, the total ones first
    expect(mesh.groups.map((g) => [g.name, g.nameB, g.total])).toEqual([
      ["forceCoeffs", "forceCoeffs", true], ["forcesTotal", "forcesTotal", false],
    ]);
    const drag = mesh.groups[0]!.drag!;
    expect(drag.diff).toBeCloseTo(drag.b - drag.a, 9);
    expect([drag.real, drag.meshOk]).toEqual([true, false]);
    const design = await ask({ a: coarse, b: medium });
    expect(design.kind).toBe("design");
    expect(design.warnings[0]).toMatch(/^Their meshes differ by 74\.5 % in cells \(478,901 and 835,565\)/);
    const ab = await ask({ abtest: RECORDED_COMPARE_AB });
    expect(ab).toMatchObject({ kind: "abtest", a: { case: `${RECORDED_COMPARE_AB} (original mesh)`, made: null },
                               b: { case: `${RECORDED_COMPARE_AB} (repaired mesh)` } });
    expect(ab.groups.every((g) => g.drag?.diff === 0 && g.drag.real === false)).toBe(true);

    // the rest isn't in the demo, and what the engine refuses it refuses the same way
    const refused = (q: Partial<CompareAsk>, code: string, message?: string) =>
      expect(ask(q)).rejects.toMatchObject(message == null ? { code } : { code, message });
    await refused({ a: medium, b: coarse }, "unavailable", DEMO_COMPARE_NOTE);
    await refused({ a: coarse, b: "ahmed-25-fine" }, "unavailable", DEMO_COMPARE_NOTE);
    await refused({ a: coarse, b: medium, from: 1000 }, "unavailable", DEMO_COMPARE_NOTE);
    await refused({ abtest: RECORDED_COMPARE_AB, to: 100 }, "unavailable", DEMO_COMPARE_NOTE);
    await refused({ abtest: "ahmed25-medium-fix" }, "unavailable", DEMO_COMPARE_NOTE);
    await refused({ abtest: "nope" }, "not-found", "no A/B test nope with both its runs");
    await refused({ a: coarse, b: "nope" }, "not-found", "no case nope in the cases folder");
    await refused({ a: coarse, b: coarse }, "bad-request", "pick two different cases to compare");
    await refused({ a: coarse }, "bad-request");
    await expect(t.request("GET", `/compare?abtest=${RECORDED_COMPARE_AB}&a=${coarse}`))
      .rejects.toMatchObject({ code: "bad-request" });
  });

  it("has its finished A/B test's two runs' forces, named as compared, and refuses as the engine does", async () => {
    const t = demoTransport(answers(), 0);
    const base = await api.abtestForces(t, RECORDED_COMPARE_AB, "base");
    const fixed = await api.abtestForces(t, RECORDED_COMPARE_AB, "fixed");
    expect([base.case, fixed.case]).toEqual([compared.abtest.a.case, compared.abtest.b.case]);
    // every iteration of its 201 (and the one before), each group the comparison has, the total one first
    for (const run of [base, fixed]) {
      expect([run.transient, run.vertical]).toEqual([false, "lift"]);
      expect(run.groups.map((g) => [g.name, g.total, g.n, g.t.length, g.drag.length, g.t.at(-1)])).toEqual([
        ["forcesTotal", true, 202, 202, 202, 201], ["forceCoeffs", false, 202, 202, 202, 201],
      ]);
    }
    expect(compared.abtest.groups.map((g) => g.name)).toEqual(base.groups.map((g) => g.name));
    // the same forces on both meshes, as the comparison says
    expect(fixed.groups[0]!.drag.at(-1)).toBe(base.groups[0]!.drag.at(-1));
    const refused = (path: string, code: string, message: string) =>
      expect(t.request("GET", path)).rejects.toMatchObject({ code, message });
    await refused(`/abtests/${RECORDED_COMPARE_AB}/forces`, "bad-request", "missing query parameter side");
    await refused(`/abtests/${RECORDED_COMPARE_AB}/forces?side=both`, "bad-request", "side: 'both' not one of ['base', 'fixed']");
    await refused("/abtests/nope/forces?side=base", "not-found", "no base run in A/B test nope");
    await refused("/abtests/ahmed25-medium-fix/forces?side=fixed", "unavailable", DEMO_AB_FORCES_NOTE);
  });

  it("ships no paths from the recording machine", () => {
    expect(JSON.stringify(clusters)).not.toMatch(/\/home\/|\/mnt\/|\/tmp\/|[A-Z]:\\\\|Users[\\/]/);
    expect(JSON.stringify(results)).not.toMatch(/\/home\/|\/mnt\/|\/tmp\/|[A-Z]:\\\\|Users[\\/]/);
    expect(JSON.stringify(forces)).not.toMatch(/\/home\/|\/mnt\/|\/tmp\/|[A-Z]:\\\\|Users[\\/]/);
    for (const doc of [resultsMedium, forcesMedium, compared, forcesAb]) {
      expect(JSON.stringify(doc)).not.toMatch(/\/home\/|\/mnt\/|\/tmp\/|[A-Z]:\\\\|Users[\\/]/);
    }
    const text = JSON.stringify(recorded);
    expect(text).not.toMatch(/\/home\/|\/mnt\/|\/tmp\/|[A-Z]:\\\\|Users[\\/]/);
  });
});
