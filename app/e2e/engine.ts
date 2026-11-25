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
    check("pictures", "pvbatch", "ParaView", "5.10.0-RC1"),
    check("memory", "memory", "Memory", "12.5 GB available"),
  ].map((c) => ({ ...c, ...change[c.id] }));
  return {
    ready: !checks.some((c) => c.state === "fail"), checks, checked: new Date().toISOString(),
    memory: { availableMb: 12_800, limitMb: null, cells: { repair: 8_388_608, solve: 9_320_675 } },
  };
}

/** A solve as GET /runs/{name} answers it (API 1.6): by default on its first stretch, solving at iteration 1,200 of
 *  2,000 on 4 processes, with 1,000 written. */
export function run(name: string, more: Record<string, unknown> = {}) {
  return {
    name, state: "running", step: "solving", iteration: 1200, start: 0, end: 2000, written: 1000, nProcs: 4,
    stretches: [] as { from: number; to: number }[], started: new Date(Date.now() - 900_000).toISOString(),
    updated: new Date().toISOString(), finished: null as string | null, error: null, ...more,
  };
}
/** A transient run of ahmed-coarse (API 1.6): DDES at a largest Courant number of 1 from its iteration 300, counting
 *  time in s; by default solving at 0.0005 s of 0.001 s on 4 processes, with 0.00025 s written, and not averaging
 *  its flow yet, as its forces haven't settled (API 1.9). */
export function transientRun(name: string, more: Record<string, unknown> = {}) {
  return run(name, {
    iteration: 0.0005, end: 0.001, written: 0.00025,
    transient: { steady: "ahmed-coarse", at: "300", maxCo: 1, model: "DDES" },
    averaging: { from: null, settled: null, written: null },
    ...more,
  });
}
type RunDoc = ReturnType<typeof run> & {
  transient?: { steady: string; at: string; maxCo: number | null; model: string | null } | null;
};

/** A transient run's time step, 20 µs. */
const DT = 2e-5;

/** A transient run's page data: its time steps up to the time it is at (the time step, and the Courant number about
 *  0.95 at its largest), its residuals and forces swinging with the flow, and the transient judge in time steps,
 *  over the last half of them (10 to 200) as GET /judge's: still developing and not settled while it solves,
 *  converged and its means from 0.0001 s once it has ended. */
function transientLive(r: RunDoc) {
  const at = Number(r.iteration ?? r.written);
  const n = Math.max(0, Math.round(at / DT));
  const ts = Array.from({ length: n }, (_, i) => (i + 1) * DT);
  const solving = r.state === "running";
  const stages = [...r.stretches.map((s) => ({ name: s.from === 0 ? "First solve" : "Continued", ...s }))];
  if (solving) stages.push({ name: r.start === 0 ? "First solve" : "Continued", from: r.start, to: r.end });
  return {
    name: r.name, run: r, stages, current: stages.at(-1) ?? { name: "First solve", from: 0, to: r.end },
    solver: solving
      ? { state: "running", iteration: at, end: r.end, deltaT: DT, wall_per_it: 1.4, eta: Math.round((r.end - at) / DT) * 1.4,
          log: "log.foamRun" }
      : { state: "done", iteration: at, end: r.end, deltaT: DT, log: "log.foamRun" },
    residuals: { cols: ["Time", "p", "Ux"],
      rows: ts.map((t, i) => [t, 0.012 + 0.004 * Math.sin(i / 3), 0.003 + 0.001 * Math.sin(i / 4)]) },
    forces: { body: ts.map((t, i) => [t, 40 + 1.5 * Math.sin(i / 2), 150 + 6 * Math.sin(i / 3)]) },
    forceInfo: { total: "body", groups: ["body"], vertical: "downforce", flow: "+x", up: "z", source: {} },
    steps: { cols: ["Time", "deltaT", "coMean", "coMax"],
      rows: ts.map((t, i) => [t, DT, 0.05 + 0.01 * Math.sin(i / 4), 0.95 + 0.04 * Math.sin(i / 3)]) },
    judge: {
      transient: true, window: Math.max(10, Math.min(200, Math.floor(n / 2))), group: "body", flags: [] as string[],
      verdict: solving ? "still developing (force means still drifting; average later)"
        : "converged (statistically stationary, every time step converged)",
      average: { drag: { mean: 40.1, u: 0.3 }, downforce: { mean: 150.4, u: 1.2 } }, axes: { flow: "+x", up: "z" },
      settled: solving ? null : 0.0001,
    },
    now: Date.now() / 1000,
  };
}

/** A run's page data (GET /runs/{name}/live): two fields' residuals falling and a body's forces settling, up to the
 *  iteration it is at; the live judge still collecting. A transient run's: transientLive's. */
function runLive(r: RunDoc) {
  if (r.transient) return transientLive(r);
  const n = Math.max(0, Math.floor(Number(r.iteration ?? r.written)));
  const ts = Array.from({ length: n }, (_, i) => i + 1);
  const solving = r.state === "running";
  const stages = [...r.stretches.map((s) => ({ name: s.from === 0 ? "First solve" : "Continued", ...s }))];
  if (solving) stages.push({ name: r.start === 0 ? "First solve" : "Continued", from: r.start, to: r.end });
  return {
    name: r.name, run: r, stages, current: stages.at(-1) ?? { name: "First solve", from: 0, to: r.end },
    solver: solving
      ? { state: "running", iteration: n, end: r.end, wall_per_it: 0.42, eta: (r.end - n) * 0.42, log: "log.foamRun" }
      : { state: "done", iteration: n, end: r.end, log: "log.foamRun" },
    residuals: { cols: ["Time", "p", "Ux"], rows: ts.map((t) => [t, 0.4 * Math.exp(-t / 250) + 2e-5, 0.1 * Math.exp(-t / 300) + 4e-6]) },
    forces: { body: ts.map((t) => [t, 42 + 30 * Math.exp(-t / 200), 180 * (1 - Math.exp(-t / 180)) + 4 * Math.sin(t / 12)]) },
    forceInfo: { total: "body", groups: ["body"], vertical: "downforce", flow: "+x", up: "z", source: {} },
    judge: solving
      ? { window: 200, avgFrom: 1000, level: "warn", verdict: "not converged yet: the forces still drift",
          average: { drag: { mean: 42.3, u: 0.4 }, downforce: { mean: 179.6, u: 2.1 } } }
      : { window: 200, level: "ok", verdict: "converged" },
    now: Date.now() / 1000,
  };
}

/** GET /runs/verify-install/validation (Verify install, API 1.6) as a real coarse run with OpenFOAM 14 answered it:
 *  the same answer as the accuracy check's run of that mesh. */
export const MATCHING = {
  name: "verify-install", state: "done", template: "ahmed-body", size: "coarse", slant: 25, cells: 478_901,
  iterations: 2000, window: 500, cd: 0.2986, cl: 0.2978, drift: -0.11,
  tunnel: { cd: 0.285, difference: 4.76 },
  published: { cd: 0.299, cl: 0.298, iterations: 2000, difference: -0.15 },
  comparable: true, matches: true,
};

/** GET /tplans/ahmed-coarse (a tplan job's plan, API 1.6) as the engine answered it of a real coarse Ahmed body solved
 *  to 300 on 6 processes, to 6 digits: the time step at Courant numbers 1, 5 and 20, which cells set it, the cost. Its
 *  places' walls, speeds and shapes (foamCourantCells') are those of a plan of the same mesh solved on to 2000 (the
 *  fourth's made up to match), and it saved the cell set of its 100 fastest cells. */
export const PLAN = {
  schemaVersion: "1.2", case: "ahmed-coarse", time: "300", processors: 6, decomposed: true, tool: "foamCourantCells",
  cells: 478_901,
  courantPerSecond: { median: 4329.14, p99: 15320.4, p999: 20357.4, p9999: 29466.6, max: 54448.3, withoutTop: 24803.3 },
  top: 100, cellsWithin2x: 62,
  regions: [
    { nCells: 38, centre: [-0.0635271, 0.179941, 0.322101], h: 0.00264837, maxRate: 54448.3, wall: "ahmed",
      wallDist: 0.002376, speed: 54.9072, aspectRatio: 5.31782, maxNonOrtho: 51.878 },
    { nCells: 26, centre: [-0.931042, 0.190741, 0.298457], h: 0.0025086, maxRate: 43727.2, wall: "ahmed",
      wallDist: 0.000855, speed: 49.0417, aspectRatio: 4.45747, maxNonOrtho: 64.5689 },
    { nCells: 33, centre: [-0.0525219, 0.177295, 0.0701108], h: 0.00219626, maxRate: 41831, wall: "ahmed",
      wallDist: 0.001272, speed: 55.6989, aspectRatio: 4.80645, maxNonOrtho: 47.4006 },
    { nCells: 3, centre: [-1.04556, 0.193505, 0.0518287], h: 0.00274267, maxRate: 27844.4, wall: "ahmed",
      wallDist: 0.000912, speed: 47.2108, aspectRatio: 4.21, maxNonOrtho: 39.8 },
  ],
  cellSet: { name: "fastestCells", cells: 100, whole: true },
  speed: 40, length: 1.044, flowTime: 0.2088, flowTimeSource: "8 L/U", secondsPerIteration: 0.4, outerCorrectors: 3,
  options: [
    { maxCo: 1, deltaT: 1.83661e-5, deltaTWithoutTop: 4.03171e-5, stepsPerSecond: 54448.3, hoursPerFlowSecond: 18.1494,
      steps: 11_369, hours: 3.78967, hoursWithoutTop: 1.72633 },
    { maxCo: 5, deltaT: 9.18303e-5, deltaTWithoutTop: 2.01586e-4, stepsPerSecond: 10889.7, hoursPerFlowSecond: 3.62988,
      steps: 2274, hours: 0.758, hoursWithoutTop: 0.345333 },
    { maxCo: 20, deltaT: 3.67321e-4, deltaTWithoutTop: 8.06343e-4, stepsPerSecond: 2722.41,
      hoursPerFlowSecond: 0.907471, steps: 569, hours: 0.189667, hoursWithoutTop: 0.0863333 },
  ],
  seconds: 1.5,
  notes: [
    "Courant numbers come from the steady flow; in the transient run the velocity fluctuates, so the real max Co is "
      + "usually somewhat higher.",
    "Hours assume one PIMPLE outer iteration costs about one steady iteration.",
    "DES/LES need max Co <= 1; URANS with enough outer correctors usually runs higher.",
  ],
};

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

/** A set of pictures as GET /pictures/{case}/{set} answers it (API 1.17). */
export interface PictureSetDoc {
  case: string; set: string; time: string; mean: boolean; kinds: string[]; made: string | null; notes: string[];
  pictures: { file: string; kind: string; title: string; time?: string }[];
}

/** Each picture it serves: a PNG of one pixel. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64");

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
    /** The cases Mesh Doctor made, each with what from (GET /cases' `made`, API 1.6): a template, a case you made
     * (a copy of it), or a solved run (a transient run of it); listed with the others. */
    made?: Record<string, { template?: string; copyOf?: string; transientOf?: string }>;
    /** Their solves (GET /runs), each as run() makes it; a running one has a solve job running too. */
    runs?: RunDoc[];
    /** Verify install's comparison of a run (GET /runs/{name}/validation), by its name. */
    validations?: Record<string, unknown>;
    /** Each case's latest written time with its face flux (GET /cases' `results`, API 1.8), by name. */
    results?: Record<string, string | null>;
    /** The job kinds GET / lists (only repair by default, as from an engine of API 1.0). */
    kinds?: string[];
    /** The transient plans tplan jobs made (GET /tplans/{name}, API 1.6), by their case's name. */
    tplans?: Record<string, unknown>;
    /** The free space GET /disk and GET /disk/{kind} say (API 1.7, 1.12), in MB: 393 GB by default. */
    diskFreeMb?: number;
    /** Its sets of pictures (API 1.17), made in a terminal (no job); none, as from an older engine, unless given. */
    pictures?: PictureSetDoc[];
  } = {},
): Promise<MockEngine> {
  const state: MockEngine = {
    requests: [], cases: ["wing", "ahmed-25-coarse", "motorBike", ...Object.keys(opts.made ?? {})],
    down: opts.down ?? false, wrongKey: opts.wrongKey ?? false, apiVersion: "1.0", started: [],
  };
  const jobs = opts.noJobs ? [] : [
    job("20261121-130610-repair-wing-fix-13c2", "wing-fix", "running", { progress: { step: "fixing", fraction: 0.62 } }),
    job("20261121-120000-repair-old-fix-0001", "old-fix", "done", { finished: new Date(Date.now() - 300_000).toISOString() }),
  ];
  const runs = new Map((opts.runs ?? []).map((r) => [r.name, structuredClone(r)]));
  for (const r of runs.values()) {
    if (r.state === "running") {
      jobs.unshift(job(`20261123-110000-solve-${r.name}-e2e0`, r.name, "running",
        { kind: "solve", params: { name: r.name, to: r.end }, progress: { step: "solving", fraction: 0.6 } }));
    }
  }
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
    if (path === "/") {
      return json(200, { apiVersion: state.apiVersion, version: "0.1.0", schemas: { repair: "1.0", job: "1.0" },
        jobKinds: opts.kinds ?? ["repair"] });
    }
    const tplan = /^\/tplans\/([^/]+)$/.exec(path);
    if (tplan) {
      const name = decodeURIComponent(tplan[1]!);
      const p = opts.tplans?.[name];
      return p ? json(200, p) : json(404, { error: { code: "not-found", message: `no transient plan of ${name}: a tplan job makes one` } });
    }
    if (path === "/cases") {
      return json(200, { items: state.cases, ...(opts.made && { made: opts.made }), ...(opts.results && { results: opts.results }) });
    }
    // Its solves (API 1.6): Stop ends a running one at the iteration it has reached, and its job with it.
    if (path === "/runs" && opts.runs) return json(200, { items: [...runs.values()] });
    const solve = /^\/runs\/([^/]+)(\/live|\/stop|\/validation)?$/.exec(path);
    const r = solve && runs.get(decodeURIComponent(solve[1]!));
    if (solve && !r) return json(404, { error: { code: "not-found", message: `no run ${solve[1]}` } });
    if (solve && r && solve[2] === "/stop" && req.method() === "POST") {
      if (r.state !== "running") return json(409, { error: { code: "not-ready", message: `${r.name} isn't solving now` } });
      const answer = structuredClone(r);
      const now = new Date().toISOString();
      Object.assign(r, { state: "stopped", step: "done", written: r.iteration, end: r.iteration, finished: now, updated: now,
        stretches: [...r.stretches, { from: r.start, to: r.iteration }] });
      const j = jobs.find((x) => x.kind === "solve" && x.name === r.name && x.state === "running");
      if (j) Object.assign(j, { state: "done", finished: now, progress: null });
      return json(200, answer);
    }
    if (solve && r && solve[2] === "/live") return json(200, runLive(r));
    if (solve && r && solve[2] === "/validation") {
      const v = opts.validations?.[r.name];
      return v ? json(200, v) : json(422, { error: { code: "unsupported", message: `${r.name} isn't made from the Ahmed body template` } });
    }
    if (solve && r && !solve[2]) return json(200, r);
    if (path === "/judge") return json(200, { verdict: "converged", window: 200, group: "body",
      average: { drag: { mean: 41.8, u: 0.2 }, downforce: { mean: 181.4, u: 0.9 } } });
    if (path === "/jobs" && req.method() === "GET") return json(200, { items: jobs });
    if (path === "/repairs") return json(200, { items: opts.repairs ?? [] });
    // A 16 GB laptop with no RAM limit (API 1.1).
    if (path === "/machine") return json(200, { cpus: 8, cores: 4, memoryMb: 16_000, ramLimitMb: null });
    // Its disk (API 1.7), where solving any of its cases takes what the coarse Ahmed body's does: a copy of 65 MB, and
    // 212 MB written on several processes; 445 MB for a transient run, with its averaged flow (API 1.9), and more for
    // each written time past the 4 a stretch of one writes unasked (API 1.10's `writes`). With a template (API 1.13),
    // what a solve that makes a case of it takes, as the disk guard counts it from the cells it makes: its mesh with
    // the sets beside it, then two written times kept (purgeWrite 2), split on several processes: for the coarse
    // Ahmed body's 66 MB mesh, 68 MB and 215 MB (80 on one process).
    if (path === "/disk") {
      const query = new URL(req.url()).searchParams;
      const name = query.get("case");
      const more = Number(query.get("writes") ?? 4) - 4;
      if (name != null && !state.cases.includes(name)) {
        return json(404, { error: { code: "not-found", message: `no case ${name} in the cases folder` } });
      }
      const asked = query.get("template");
      const template = TEMPLATES.items.find((t) => t.name === asked);
      const size = query.get("size") ?? template?.size;
      const cells = template?.sizes.find((s) => s.name === size)?.cells;
      if (asked != null && cells == null) {
        return json(404, { error: { code: "not-found", message: `no template ${asked} here` } });
      }
      const mesh = Math.ceil((cells ?? 0) * 0.14 / 1024);
      return json(200, { freeMb: opts.diskFreeMb ?? 402_339, keepMb: 1024, case: name == null ? null : {
        name, copyMb: 65, transientMb: 103, solveMb: { several: 212, one: 78 },
        continueMb: { several: 39 + 20 * more, one: 0 },
        transientSolveMb: { several: 445 + 84 * more, one: 164 + 75 * more } },
        template: cells == null ? null : { name: asked, size, madeMb: Math.ceil((cells * 0.14 / 1024) * 1.03),
          solveMb: { several: Math.ceil(mesh * 3.25), one: Math.ceil(mesh * 1.2) } } });
    }
    // What the other jobs write (API 1.12), as the disk guard counts them for the coarse Ahmed body's mesh of 66 MB: a
    // repair 212 MB (its copy and its points' backup, its sets and room to collapse faces), an A/B test 484 MB (two
    // runs), its continuation 106 MB (two written times), a new case its mesh with its sets, and a set of pictures
    // 7 MB (API 1.18: about 20 pictures of 0.3 MB, and its list), with a time still split onto a run's processes that
    // the picture job joins first, 41 MB on the same disk (API 1.19: the coarse Ahmed body's, split onto 6 processes).
    const diskJob = /^\/disk\/(repair|abtest|abextend|case|pictures)$/.exec(path);
    if (diskJob) {
      const query = new URL(req.url()).searchParams;
      const kind = diskJob[1]!;
      const template = TEMPLATES.items.find((t) => t.name === query.get("template"));
      const cells = template?.sizes.find((s) => s.name === (query.get("size") ?? "medium"))?.cells;
      if (kind === "case" && cells == null) {
        return json(404, { error: { code: "not-found", message: `no template ${query.get("template")}` } });
      }
      const needMb = kind === "repair" ? 212 : kind === "abtest" ? 484 : kind === "abextend" ? 106
        : kind === "pictures" ? 7 : Math.ceil((cells ?? 0) * 0.14 / 1024 * 1.03);
      const r = kind === "pictures" ? runs.get(query.get("name") ?? "") : undefined;
      const kept = (k: "times" | "joined") => (((r as Record<string, unknown> | undefined)?.[k] ?? []) as number[]).map(String);
      const at = query.get("time") || String(Math.max(...kept("times").map(Number)));
      const join = kept("times").includes(at) && !kept("joined").includes(at)
        ? { time: at, processes: r?.nProcs, needMb: 41, freeMb: opts.diskFreeMb ?? 402_339, sameDisk: true } : null;
      const joins = kind === "pictures" && Number(state.apiVersion.split(".")[1]) >= 19;
      return json(200, { needMb, freeMb: opts.diskFreeMb ?? 402_339, keepMb: 1024,
        folder: kind === "case" ? "cases" : "workspace", ...(joins ? { join } : {}) });
    }
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
    // Its sets of pictures (API 1.17): the list, a set, a picture (a PNG, its one answer that isn't JSON), and a delete.
    const sets = opts.pictures;
    if (sets && path === "/pictures") {
      const of = new URL(req.url()).searchParams.get("case");
      return json(200, { items: sets.filter((s) => of == null || s.case === of).map((s) => ({
        case: s.case, set: s.set, time: s.time, mean: s.mean, kinds: s.kinds, made: s.made, count: s.pictures.length,
        job: null,
      })) });
    }
    const pic = sets && /^\/pictures\/([^/]+)\/([^/]+)(?:\/(.+))?$/.exec(path);
    if (sets && pic) {
      const [name, at, rest] = [decodeURIComponent(pic[1]!), decodeURIComponent(pic[2]!), pic[3]];
      const i = sets.findIndex((s) => s.case === name && s.set === at);
      if (i < 0) return json(404, { error: { code: "not-found", message: `no set of pictures ${at} of ${name}` } });
      if (rest === "delete" && req.method() === "POST") {
        const [gone] = sets.splice(i, 1);
        return json(200, { case: name, set: at, deleted: gone!.pictures.length });
      }
      if (!rest) return json(200, sets[i]);
      if (!sets[i]!.pictures.some((p) => p.file === decodeURIComponent(rest))) {
        return json(404, { error: { code: "not-found", message: `the set ${at} of ${name} lists no picture ${rest}` } });
      }
      return route.fulfill({ status: 200, headers: { ...cors, "Content-Type": "image/png" }, body: PNG });
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
