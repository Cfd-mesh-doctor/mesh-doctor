// SPDX-License-Identifier: GPL-3.0-or-later
// The demo answers GET /repairs/{name}/report with the recorded sample reports, moved in time with the rest.
import { describe, expect, it } from "vitest";
import type { Job, JobList, RepairList } from "@/engine/types";
import { toMillis } from "@/lib/format";
import sample from "@/report/samples/ahmed35-medium-fix.mdreport.json";
import recorded from "./fixtures.json";
import medium from "@/report/samples/ahmed25-medium-fix.mdreport.json";
import { abTestFinished, demoTransport, replacedPaths } from "./transport";

const TIME_KEYS = new Set(["created", "started", "finished", "updated", "time"]);

/** Every time in a document, by where it is. */
function times(doc: unknown, at = ""): Map<string, number> {
  const found = new Map<string, number>();
  if (doc && typeof doc === "object") {
    for (const [k, v] of Object.entries(doc)) {
      if (TIME_KEYS.has(k) && typeof v === "string" && Number.isFinite(toMillis(v))) found.set(`${at}/${k}`, toMillis(v));
      else for (const [p, t] of times(v, `${at}/${k}`)) found.set(p, t);
    }
  }
  return found;
}

describe("the demo's reports", () => {
  it("cover every finished repair in the demo, each the report of that run", async () => {
    const t = demoTransport(undefined, 0);
    const list = await t.request<RepairList>("GET", "/repairs");
    const finished = list.items.filter((r) => r.verdict).map((r) => r.name);
    expect(finished).toHaveLength(5);
    for (const name of finished) {
      const report = await t.request<{ name?: string }>("GET", `/repairs/${name}/report`);
      expect(report.name, name).toBe(name);
    }
  });

  it("are the recorded reports, with every time moved as far as the demo's own, made when asked", async () => {
    const t = demoTransport(undefined, 0);
    const list = await t.request<RepairList>("GET", "/repairs");
    const run = (l: RepairList) => l.items.find((r) => r.name === "ahmed35-medium-fix");
    const shift = toMillis(run(list)?.finished ?? "") - toMillis(run(recorded.answers["/repairs"] as unknown as RepairList)?.finished ?? "");
    expect(Math.abs(shift)).toBeGreaterThan(0);

    const asked = Date.now();
    const report = await t.request<unknown>("GET", "/repairs/ahmed35-medium-fix/report");
    const before = times(sample);
    const after = times(report);
    expect(before.size).toBeGreaterThan(1);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [where, time] of before) {
      // The engine builds a report when asked for it and stamps that time (to the second), as the demo does.
      if (where === "/created") expect(after.get(where)).toBeGreaterThanOrEqual(Math.floor(asked / 1000) * 1000);
      else expect(after.get(where), where).toBe(time + shift);
    }
    expect((report as { created: string }).created).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(after.get("/created")).toBeLessThanOrEqual(Date.now());
    expect(times(sample)).toEqual(before); // the import itself is untouched
  });

  type Report = { documents: Record<string, unknown>; contents: Record<string, unknown>; redacted: { paths: number } };
  const parts = (r: Report) => [Object.keys(r.documents).sort(), Object.keys(r.contents).sort()];

  it("leave out an A/B test the demo's job list has unfinished, and only that", async () => {
    const t = demoTransport(undefined, 0);
    // The job list was recorded while the 25° medium A/B test was still solving.
    const jobs = await t.request<JobList>("GET", "/jobs");
    const test = jobs.items.find((j) => j.kind === "abtest" && j.params.name === "ahmed25-medium-fix");
    expect(test?.state).toBe("running");
    const left = await t.request<Report>("GET", "/repairs/ahmed25-medium-fix/report");
    expect(parts(left)).toEqual([["repair"], ["repair"]]);
    // Of the 3 folder paths the engine replaced, the repair result held 2 and the A/B test 1.
    expect(medium.redacted.paths).toBe(3);
    expect(left.redacted.paths).toBe(2);
    // the coarse run's A/B test finished in the job list, so its report keeps it
    expect(parts(await t.request<Report>("GET", "/repairs/ahmed25-coarse-fix/report")))
      .toEqual([["abtest", "repair"], ["abtest", "repair"]]);
    // a cancelled test never finished either
    await t.request("POST", `/jobs/${encodeURIComponent(test?.id ?? "")}/cancel`);
    expect(parts(await t.request<Report>("GET", "/repairs/ahmed25-medium-fix/report"))).toEqual([["repair"], ["repair"]]);
  });

  it("count the paths the engine replaced, as it writes them", () => {
    expect(replacedPaths(medium.documents.repair)).toBe(2);
    expect(replacedPaths(medium.documents.abtest)).toBe(1);
    expect(replacedPaths(["cases/wing", "workspace", { log: "see workspace/a and cases/b" }])).toBe(4);
    expect(replacedPaths(["myworkspace/x", "worst cases", "cases-old/x", 12, null])).toBe(0);
  });

  it("know an A/B test has finished only from a finished A/B job of that run", () => {
    const ab = (name: string, state: Job["state"]): Job => ({
      schemaVersion: "1.0", id: `20261121-120000-abtest-${name}-0001`, kind: "abtest", params: { name }, name, state,
      runner: "local", created: "2026-11-21T18:00:00Z", log: "x.log",
    });
    const list = (...items: Job[]): JobList => ({ items });
    expect(abTestFinished(list(), "run")).toBe(true); // no A/B job: the report keeps what it holds
    expect(abTestFinished(undefined, "run")).toBe(true);
    expect(abTestFinished(list(ab("run", "running")), "run")).toBe(false);
    expect(abTestFinished(list(ab("run", "queued")), "run")).toBe(false);
    expect(abTestFinished(list(ab("run", "failed"), ab("run", "cancelled")), "run")).toBe(false);
    expect(abTestFinished(list(ab("run", "failed"), ab("run", "done")), "run")).toBe(true);
    expect(abTestFinished(list(ab("other", "running")), "run")).toBe(true);
    expect(abTestFinished(list({ ...ab("run", "running"), kind: "repair" }), "run")).toBe(true);
  });

  it("are not found for a run the demo has no report of (it never finished)", async () => {
    await expect(demoTransport(undefined, 0).request("GET", "/repairs/ahmed25-fine-strict/report"))
      .rejects.toMatchObject({ code: "not-found", status: 404 });
  });
});
