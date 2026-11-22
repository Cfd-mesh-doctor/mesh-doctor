// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { api } from "@/engine/client";
import type { Job } from "@/engine/types";
import recorded from "./fixtures.json";
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

  it("ships no paths from the recording machine", () => {
    const text = JSON.stringify(recorded);
    expect(text).not.toMatch(/\/home\/|\/mnt\/|\/tmp\/|[A-Z]:\\\\|Users[\\/]/);
  });
});
