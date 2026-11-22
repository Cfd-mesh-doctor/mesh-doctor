// SPDX-License-Identifier: GPL-3.0-or-later
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { formatNumber } from "@/lib/format";
import { MAX_BYTES, ReportError, checkReport, fileBytes, readReport } from "./read";
import { geomean, judgeTone, ratioChange, summarize } from "./summary";
import { testReport } from "./testReport";

const bytes = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
const json = () => JSON.stringify(testReport());
const page = (data: string, extra = "") =>
  `<!doctype html><html><head><title>Mesh Doctor report</title></head><body>${extra}` +
  `<script type="application/json" id="md-report">${data.replace(/</g, "\\u003c")}</script></body></html>`;

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ReportError);
    return (e as Error).message;
  }
  throw new Error("expected the file to be refused");
}

describe("opening report files", () => {
  it("reads a .mdreport.json file", async () => {
    const { report, from } = await readReport(bytes(json()), "ahmed25-fine-fix.mdreport.json");
    expect(report.name).toBe("ahmed25-fine-fix");
    expect(from).toBe("ahmed25-fine-fix.mdreport.json");
  });

  it("unpacks a .json.gz file", async () => {
    const gz = new Uint8Array(gzipSync(json()));
    const { report } = await readReport(gz, "r.mdreport.json.gz");
    expect(report.kind).toBe("meshdoctor-report");
  });

  it("takes the data out of an exported page without running it", async () => {
    const w = window as unknown as { ran?: boolean };
    const { report } = await readReport(bytes(page(json(), "<script>window.ran = true</script><img src=x onerror=\"window.ran = true\">")), "r.html");
    expect(report.name).toBe("ahmed25-fine-fix");
    expect(w.ran).toBeUndefined();
  });

  it("reads the bytes of a picked file", async () => {
    const got = await fileBytes(new File([json()], "r.json", { type: "application/json" }));
    expect(new TextDecoder().decode(got)).toBe(json());
  });

  it("refuses what isn't a version 1 report, and says why", async () => {
    expect(await refusal(readReport(new Uint8Array(0), "e.json"))).toMatch(/empty/);
    expect(await refusal(readReport(bytes("hello"), "n.txt"))).toMatch(/isn't JSON/);
    expect(await refusal(readReport(bytes('{"kind":"something-else"}'), "o.json"))).toMatch(/isn't a Mesh Doctor report/);
    expect(await refusal(readReport(bytes(page("")), "p.html"))).toMatch(/no report inside/);
    expect(await refusal(readReport(new Uint8Array([0x1f, 0x8b, 1, 2, 3]), "d.gz"))).toMatch(/damaged/);
    const newer = { ...testReport(), schemaVersion: "2.0" };
    expect(await refusal(readReport(bytes(JSON.stringify(newer)), "v2.json"))).toMatch(/version 2\.0/);
    expect(() => checkReport({ kind: "meshdoctor-report", schemaVersion: "1.3", documents: {} })).toThrow(/no repair result/);
    await expect(fileBytes({ size: MAX_BYTES + 1 } as Blob)).rejects.toThrow(/bigger than/);
  });
});

describe("what a report says", () => {
  it("sums up the repair, the A/B test and the judge", () => {
    const s = summarize(checkReport(testReport()));
    expect(s).toMatchObject({
      name: "ahmed25-fine-fix", caseName: "ahmed-25-fine", cells: 1_565_115, profile: "fix",
      clustersBefore: 4, clustersAfter: 1, sourceUnchanged: true,
    });
    expect(s.maxMoveMm).toBeCloseTo(0.412);
    // Known checkMesh numbers in the engine's order; meshOK is not a number and is left out.
    expect(s.checkMesh.map((r) => [r.key, r.change])).toEqual([
      ["nWrongPyramids", "better"], ["maxNonOrtho", "better"], ["avgNonOrtho", "better"], ["nSevereNonOrtho", "better"],
      ["maxSkewness", "worse"], ["minVolRatio", null], ["failedChecks", "better"],
    ]);
    expect(s.ab?.rows.map((r) => [r.field, r.ratio, r.change])).toEqual([["p", 0.5, "better"], ["Ux", 0.9, "better"]]);
    expect(s.ab?.meanRatio).toBeCloseTo(Math.sqrt(0.45));
    expect(s.ab?.meta).toEqual(["300 iterations", "started from 0", "4 processes", "the same settings on both meshes"]);
    expect(s.ab?.finished).toBe("2026-11-21T19:18:41Z");
    expect(s.ab?.history.fields).toEqual(["p", "Ux"]);
    expect(s.ab?.history.original?.x).toHaveLength(60);
    expect(s.ab?.history.repaired?.y.p?.[0]).toBeCloseTo(0.9 * (1 + 0.15 * Math.sin(1)), 3);
    expect(s.sentence).toBe(
      "The repair improved 5 checkMesh numbers but made 1 worse (Max skewness). Problem clusters went from 4 to 1. " +
        "In the solver test, the repaired mesh's residuals are 0.50–0.90× those of the original mesh, so the repair helped the solver.",
    );
    expect(s.judge).toMatchObject({ verdict: "converged", group: "body", window: 100, flow: "x", up: "z", flags: ["lift still drifting slowly"] });
    expect(s.about.documents.map((d) => d.label)).toEqual(["Repair result", "Solver A/B test"]);
  });

  it("copes with a bare or damaged report", () => {
    const bare = summarize(checkReport({ kind: "meshdoctor-report", schemaVersion: "1.0", documents: { repair: {} } }));
    expect(bare).toMatchObject({ name: "Unnamed run", checkMesh: [], ab: null, judge: null, maxMoveMm: null, sourceUnchanged: null });
    expect(bare.sentence).toBe(
      "No checkMesh number changed: nothing in this mesh needed this repair. There were no problem clusters. There is no solver A/B test in this report.",
    );
    const odd = summarize(checkReport({
      kind: "meshdoctor-report", schemaVersion: "1.0", name: 7, contents: "x",
      documents: {
        repair: { verdict: { improved: [1, "maxNonOrtho"], regressions: "no" }, checkMeshBefore: [], checkMeshAfter: { maxNonOrtho: "70" }, clustersBefore: 3 },
        abtest: { residualRatioFixedOverBase: { p: "0.5", U: -1, k: 0.99 }, fixedJudge: { average: { Cd: { mean: "x" } } } },
      },
    }));
    expect(odd.improved).toEqual(["maxNonOrtho"]);
    expect(odd.checkMesh).toEqual([]);
    expect(odd.ab?.rows.map((r) => r.field)).toEqual(["k"]);
    expect(odd.judge).toMatchObject({ verdict: "–", averages: [] });
    expect(odd.sentence).toMatch(/about the same\.$/);
  });

  it("grades residual ratios and verdicts", () => {
    expect([ratioChange(0.5), ratioChange(1), ratioChange(1.5), ratioChange(null)]).toEqual(["better", null, "worse", null]);
    expect(geomean([0.25, 1])).toBeCloseTo(0.5);
    expect(geomean([])).toBeNull();
    expect(judgeTone("converged")).toBe("success");
    expect(judgeTone("statistically steady (forces stationary; use window means)")).toBe("info");
    expect(judgeTone("statistically stationary, but check: forces drift")).toBe("warning");
    expect(judgeTone("still converging")).toBe("warning");
    expect(judgeTone("not converged (plateau/oscillation)")).toBe("danger");
  });

  it("formats measured values like the engine's pages", () => {
    expect([formatNumber(71.3456), formatNumber(0.00312), formatNumber(1565115), formatNumber(2.15e-7), formatNumber(1234.567)])
      .toEqual(["71.35", "0.00312", "1,565,115", "2.150e-7", "1,235"]);
    expect(formatNumber(null)).toBe("–");
  });
});
