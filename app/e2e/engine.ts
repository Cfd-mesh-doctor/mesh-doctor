// SPDX-License-Identifier: GPL-3.0-or-later
// A pretend engine for browser tests: answers /api/v1 like Mesh Doctor does, with CORS for the app.
import type { Page, Request } from "@playwright/test";

export const ENGINE = "http://localhost:8765";
export const KEY = "e2eKey-0123456789abcdefghijklmnopqrstuvwxyzAB";
export const pairingLink = (engine = ENGINE, key = KEY) => `/connect#key=${key}&engine=${encodeURIComponent(engine)}`;

const job = (id: string, name: string, state: string, extra: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0", id, kind: "repair", params: { source: "wing", name }, name, state, runner: "local",
  created: new Date(Date.now() - 600_000).toISOString(), started: new Date(Date.now() - 590_000).toISOString(),
  log: `${name}.log`, ...extra,
});

export interface MockEngine {
  requests: Request[];
  /** Answers with this many cases from now on. */
  cases: string[];
}

/** `repairs`: the repair runs it lists (none by default). */
export async function mockEngine(
  page: Page,
  opts: { down?: boolean; wrongKey?: boolean; repairs?: unknown[] } = {},
): Promise<MockEngine> {
  const state: MockEngine = { requests: [], cases: ["wing", "ahmed-25-coarse", "motorBike"] };
  const jobs = [
    job("20261121-130610-repair-wing-fix-13c2", "wing-fix", "running", { progress: { step: "fixing", fraction: 0.62 } }),
    job("20261121-120000-repair-old-fix-0001", "old-fix", "done", { finished: new Date(Date.now() - 300_000).toISOString() }),
  ];
  await page.route(`${ENGINE}/**`, async (route) => {
    const req = route.request();
    state.requests.push(req);
    if (opts.down) return route.abort("connectionrefused");
    const cors = { "Access-Control-Allow-Origin": "http://localhost:4173", Vary: "Origin" };
    if (req.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type, X-MD-Key" },
      });
    }
    const json = (status: number, doc: unknown) =>
      route.fulfill({ status, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(doc) });
    if (opts.wrongKey || req.headers()["x-md-key"] !== KEY) {
      return json(403, { error: { code: "forbidden", message: "forbidden: missing or wrong pairing key (pair again: meshdoctor pair)" } });
    }
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, "") || "/";
    if (path === "/") return json(200, { apiVersion: "1.0", version: "0.1.0", schemas: { repair: "1.0", job: "1.0" }, jobKinds: ["repair"] });
    if (path === "/cases") return json(200, { items: state.cases });
    if (path === "/jobs") return json(200, { items: jobs });
    if (path === "/repairs") return json(200, { items: opts.repairs ?? [] });
    const cancel = /^\/jobs\/([^/]+)\/cancel$/.exec(path);
    if (cancel && req.method() === "POST") {
      const j = jobs.find((x) => x.id === cancel[1]);
      if (!j) return json(404, { error: { code: "not-found", message: "no job" } });
      Object.assign(j, { state: "cancelled", finished: new Date().toISOString(), progress: null });
      return json(200, j);
    }
    return json(404, { error: { code: "not-found", message: "no such API route" } });
  });
  return state;
}
