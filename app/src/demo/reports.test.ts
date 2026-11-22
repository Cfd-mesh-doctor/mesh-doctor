// SPDX-License-Identifier: GPL-3.0-or-later
// The demo answers GET /repairs/{name}/report with the recorded sample reports, moved in time with the rest.
import { describe, expect, it } from "vitest";
import type { RepairList } from "@/engine/types";
import { toMillis } from "@/lib/format";
import sample from "@/report/samples/ahmed35-medium-fix.mdreport.json";
import recorded from "./fixtures.json";
import { demoTransport } from "./transport";

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
  it("are the recorded reports, with every time moved as far as the demo's own", async () => {
    const t = demoTransport(undefined, 0);
    const list = await t.request<RepairList>("GET", "/repairs");
    const run = (l: RepairList) => l.items.find((r) => r.name === "ahmed35-medium-fix");
    const shift = toMillis(run(list)?.finished ?? "") - toMillis(run(recorded.answers["/repairs"] as unknown as RepairList)?.finished ?? "");
    expect(Math.abs(shift)).toBeGreaterThan(0);

    const report = await t.request<unknown>("GET", "/repairs/ahmed35-medium-fix/report");
    const before = times(sample);
    const after = times(report);
    expect(before.size).toBeGreaterThan(0);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [where, time] of before) expect(after.get(where), where).toBe(time + shift);
    expect(times(sample)).toEqual(before); // the import itself is untouched
  });

  it("are not found for a run the demo has no report of", async () => {
    await expect(demoTransport(undefined, 0).request("GET", "/repairs/pitzdaily-fix/report"))
      .rejects.toMatchObject({ code: "not-found", status: 404 });
  });
});
