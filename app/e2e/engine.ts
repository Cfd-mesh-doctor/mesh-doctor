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
  /** From now on: answers nothing, as when it isn't running (`down`), turns the pairing key down (`wrongKey`), or
   * reports this API version (`apiVersion`, 1.0 to begin with). */
  down: boolean;
  wrongKey: boolean;
  apiVersion: string;
  /** What POST /jobs was sent, in order. */
  started: unknown[];
}

const check = (group: string, id: string, label: string, found: string, more: Record<string, unknown> = {}) =>
  ({ id, label, group, state: "ok", found, fix: null, command: null, ...more });

/** GET /check (API 1.4) on a 16 GB laptop where everything is in place, the programs as `meshdoctor check` lists them.
 *  `change` swaps a check (by id) for what's given. */
export function readiness(change: Record<string, Record<string, unknown>> = {}) {
  const programs = ["foamRun", "checkMesh", "decomposePar", "foamDictionary", "mpirun", "foamMeshDoctor",
    "foamResidualHotspots", "foamCourantCells"];
  const checks = [
    check("python", "python", "Python", "3.10.12"), check("python", "numpy", "numpy", "1.21.5"),
    check("folders", "cases", "Cases folder", "found"), check("folders", "workspace", "Workspace", "private (700)"),
    check("openfoam", "openfoam", "OpenFOAM", "OpenFOAM 14"),
    ...programs.map((p) => check("programs", p, p, "found")),
    check("memory", "memory", "Memory", "12.5 GB available"),
  ].map((c) => ({ ...c, ...change[c.id] }));
  return {
    ready: !checks.some((c) => c.state === "fail"), checks, checked: new Date().toISOString(),
    memory: { availableMb: 12_800, limitMb: null, cells: { repair: 8_388_608, solve: 9_320_675 } },
  };
}

/** An A/B test as GET /abtests/{name} answers it. */
/** GET /templates (API 1.5): the engine's two templates, the Ahmed body in three mesh sizes. */
const TEMPLATES = {
  items: [
    {
      name: "ahmed-body", label: "Ahmed body", about: "The standard test shape for car aerodynamics.", size: "medium",
      sizes: [
        { name: "coarse", label: "Coarse", cells: 480_000, about: "for a quick look" },
        { name: "medium", label: "Medium", cells: 836_000, about: "the accuracy check's mesh" },
        { name: "fine", label: "Fine", cells: 1_570_000, about: "twice the medium mesh's cells" },
      ],
    },
    {
      name: "wheel-wing", label: "Wheel and front wing", about: "A front wing ahead of a rolling wheel.", size: "medium",
      sizes: [{ name: "medium", label: "Medium", cells: 920_000, about: "the template's tested mesh" }],
    },
  ],
};

interface AbDetail {
  status?: { step?: string; time?: string } | null;
  result?: { finished?: string | null; residualRatioFixedOverBase?: Record<string, number> } | null;
}

/** `repairs`: the repair runs it lists (none by default). `noJobs`: it lists no jobs (two by default). `broken`: the
 * lists it fails to give, with an error of its own (as when something goes wrong in the engine). `refuse`: the error
 * POST /jobs answers (409) instead of starting the job, as the engine's busy, memory and name checks do. `abtests`:
 * its A/B tests (none by default), each as GET /abtests/{name} answers it; it judges each run converged. */
export async function mockEngine(
  page: Page,
  opts: {
    down?: boolean; wrongKey?: boolean; repairs?: unknown[]; noJobs?: boolean; broken?: string[];
    refuse?: { code: string; message: string }; abtests?: Record<string, AbDetail>;
    /** GET /check's answer (everything in place by default); null: none, as from an engine before API 1.4. */
    check?: unknown;
    /** GET /templates' answer (two templates by default); null: none, as from an engine before API 1.5. */
    templates?: unknown;
  } = {},
): Promise<MockEngine> {
  const state: MockEngine = {
    requests: [], cases: ["wing", "ahmed-25-coarse", "motorBike"],
    down: opts.down ?? false, wrongKey: opts.wrongKey ?? false, apiVersion: "1.0", started: [],
  };
  const jobs = opts.noJobs ? [] : [
    job("20261121-130610-repair-wing-fix-13c2", "wing-fix", "running", { progress: { step: "fixing", fraction: 0.62 } }),
    job("20261121-120000-repair-old-fix-0001", "old-fix", "done", { finished: new Date(Date.now() - 300_000).toISOString() }),
  ];
  await page.route(`${ENGINE}/**`, async (route) => {
    const req = route.request();
    state.requests.push(req);
    if (state.down) return route.abort("connectionrefused");
    const cors = { "Access-Control-Allow-Origin": "http://localhost:4173", Vary: "Origin" };
    if (req.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type, X-MD-Key" },
      });
    }
    const json = (status: number, doc: unknown) =>
      route.fulfill({ status, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(doc) });
    if (state.wrongKey || req.headers()["x-md-key"] !== KEY) {
      return json(403, { error: { code: "forbidden", message: "forbidden: missing or wrong pairing key (pair again: meshdoctor pair)" } });
    }
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, "") || "/";
    if (opts.broken?.includes(path)) {
      return json(500, { error: { code: "internal", message: "internal error; details are in the server window" } });
    }
    if (path === "/") return json(200, { apiVersion: state.apiVersion, version: "0.1.0", schemas: { repair: "1.0", job: "1.0" }, jobKinds: ["repair"] });
    if (path === "/cases") return json(200, { items: state.cases });
    if (path === "/jobs" && req.method() === "GET") return json(200, { items: jobs });
    if (path === "/repairs") return json(200, { items: opts.repairs ?? [] });
    // A 16 GB laptop with no RAM limit (API 1.1).
    if (path === "/machine") return json(200, { cpus: 8, cores: 4, memoryMb: 16_000, ramLimitMb: null });
    if (path === "/check" && opts.check !== null) return json(200, opts.check ?? readiness());
    if (path === "/templates" && opts.templates !== null) return json(200, opts.templates ?? TEMPLATES);
    // Its A/B tests (API 1.3): none unless asked, and one solver-setting variant for a test's second run.
    const tests = opts.abtests ?? {};
    if (path === "/abtests") {
      return json(200, {
        items: Object.keys(tests),
        tests: Object.fromEntries(Object.entries(tests).map(([name, t]) => [name, {
          step: t.status?.step ?? null, updated: t.status?.time ?? null, finished: t.result?.finished ?? null,
          ratios: t.result?.residualRatioFixedOverBase ?? {}, verdict: null,
        }])),
      });
    }
    const ab = /^\/abtests\/([^/]+)(\/judge)?$/.exec(path);
    const test = ab && tests[decodeURIComponent(ab[1]!)];
    if (ab && test) return json(200, ab[2] ? { verdict: "converged", window: 50 } : test);
    if (path === "/variants") return json(200, { items: [{ name: "lts", label: "pseudo-transient local time stepping (localEuler)" }] });
    if (path === "/jobs" && req.method() === "POST") {
      const body = req.postDataJSON() as { kind: string; params: { name: string } };
      state.started.push(body);
      if (opts.refuse) return json(409, { error: opts.refuse });
      const made = job(`20261123-120000-${body.kind}-${body.params.name}-e2e1`, body.params.name, "queued",
        { kind: body.kind, params: body.params, started: null });
      jobs.unshift(made);
      return json(202, made);
    }
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
