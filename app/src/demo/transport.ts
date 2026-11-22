// SPDX-License-Identifier: GPL-3.0-or-later
// The demo: answers recorded from a real engine (the public Ahmed-body example, see fixtures.json's
// "_about"), served without any engine. It can cancel its own jobs; it cannot start anything.
import type { Method, Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import type { CaseList, Job, JobList, MachineInfo, RepairList } from "@/engine/types";
import { caseName } from "@/engine/verdict";
import { toMillis } from "@/lib/format";
import { RECORDED } from "@/report/samples";
import recorded from "./fixtures.json";

type Answers = Record<string, unknown>;

/** The demo engine's computer, written by hand (the recording's engine predates GET /machine): a laptop that
 *  gives WSL 25 GB and 8 cores. */
export const DEMO_MACHINE: MachineInfo = { cpus: 8, cores: 8, memoryMb: 25_600, ramLimitMb: null };

/**
 * Each case's size, which the recording's engine predates (API 1.2 added `cells` to GET /cases): the cell count
 * the recording's own repairs give for their case, or null for a case it never repaired. Answers that already
 * say, or have no cases, stay as they are.
 */
export function withCaseSizes(answers: Answers): Answers {
  const cases = answers["/cases"] as CaseList | undefined;
  if (!cases || cases.cells) return answers;
  const repairs = (answers["/repairs"] as RepairList | undefined)?.items ?? [];
  const cells = Object.fromEntries(cases.items.map((name) =>
    [name, repairs.find((r) => caseName(r.source) === name && r.nCells != null)?.nCells ?? null]));
  return { ...answers, "/cases": { ...cases, cells } };
}

/** The demo's answers: the recording, with the cases' sizes added. */
export const DEMO_ANSWERS: Answers = withCaseSizes((recorded as { answers: Answers }).answers);

const DELAY_MS = 220;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new EngineError("aborted", "Cancelled"));
    }, { once: true });
  });
}

const TIME_KEYS = new Set(["created", "started", "finished", "updated", "time"]);

function eachTime(doc: unknown, fn: (t: number) => number): void {
  if (Array.isArray(doc)) {
    doc.forEach((d) => eachTime(d, fn));
  } else if (doc && typeof doc === "object") {
    const o = doc as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if (TIME_KEYS.has(k) && typeof v === "string" && Number.isFinite(toMillis(v))) {
        o[k] = new Date(fn(toMillis(v))).toISOString();
      } else {
        eachTime(v, fn);
      }
    }
  }
}

/** Moves every recorded time so the newest is a few minutes ago: the demo always looks recent. Returns the shift. */
export function shiftTimes(data: Answers, now = Date.now()): number {
  let newest = -Infinity;
  eachTime(data, (t) => {
    newest = Math.max(newest, t);
    return t;
  });
  if (!Number.isFinite(newest)) return 0;
  const by = now - 4 * 60_000 - newest;
  moveTimes(data, by);
  return by;
}

/** Moves every time in a document by the same shift: a recorded report, so it agrees with the demo's answers. */
export function moveTimes(doc: unknown, by: number): void {
  eachTime(doc, (t) => t + by);
}

/** The parts of a recorded report the demo changes. */
interface RecordedReport {
  created?: string;
  documents?: Record<string, unknown>;
  contents?: Record<string, unknown>;
  redacted?: { paths?: number };
}

/** A path the engine replaced reads workspace/... or cases/..., or is the whole string workspace or cases
 *  (report.py's Redactor; "worst cases" in a sentence is a word, not a path). */
const REPLACED = /^(?:workspace|cases)$|(?<![^\s"'=([,:])(?:workspace|cases)\//g;

/** How many of a report's replaced paths a document holds. (A path outside both folders became its file name, which
 *  can't be told from any other word; the recorded reports have none.) */
export function replacedPaths(doc: unknown): number {
  if (typeof doc === "string") return doc.match(REPLACED)?.length ?? 0;
  if (Array.isArray(doc)) return doc.reduce((n: number, d) => n + replacedPaths(d), 0);
  if (doc && typeof doc === "object") return replacedPaths(Object.values(doc));
  return 0;
}

/** A report without one of its documents, as the engine would have written it. */
function withoutDocument(doc: RecordedReport, key: string): void {
  const gone = doc.documents?.[key];
  if (gone === undefined) return;
  delete doc.documents?.[key];
  delete doc.contents?.[key];
  if (typeof doc.redacted?.paths === "number") doc.redacted.paths -= replacedPaths(gone);
}

/**
 * Whether a run's report may hold its A/B test: not while the demo's job list has that test unfinished. The job
 * list was recorded with the 25° medium A/B test still solving its second run, and that run's report afterwards, so
 * its A/B test finishes after the demo's "now". (The engine would already hold the first run's half, written when
 * that run ended; the demo leaves the whole test out rather than cut a recorded document.) A run with no A/B job
 * in the list keeps what its report holds.
 */
export function abTestFinished(jobs: JobList | undefined, run: string): boolean {
  const tests = jobs?.items.filter((j) => j.kind === "abtest" && j.params.name === run) ?? [];
  return tests.length === 0 || tests.some((j) => j.state === "done");
}

export function demoTransport(answers: Answers = DEMO_ANSWERS, delayMs = DELAY_MS): Transport {
  // A private copy, so cancelling a demo job lasts until the page is reloaded and never touches the import.
  const data: Answers = { "/machine": DEMO_MACHINE, ...structuredClone(answers) };
  const by = shiftTimes(data);
  return {
    kind: "demo",
    scope: "demo",
    async request<T>(method: Method, path: string, _body?: unknown, signal?: AbortSignal): Promise<T> {
      await wait(delayMs, signal);
      const route = path.split("?")[0] || "/";
      if (method === "POST") {
        const m = /^\/jobs\/([^/]+)\/cancel$/.exec(route);
        if (!m) throw new EngineError("forbidden", "The demo can't start jobs. Connect your own engine to run Mesh Doctor.", 403);
        const id = decodeURIComponent(m[1] ?? "");
        const list = data["/jobs"] as JobList | undefined;
        const job = list?.items.find((j) => j.id === id);
        if (!job) throw new EngineError("not-found", "no such job", 404);
        if (job.state !== "queued" && job.state !== "running") throw new EngineError("finished", "job already finished", 409);
        const now = new Date().toISOString();
        Object.assign(job, { state: "cancelled", finished: now, exitCode: null, progress: null } satisfies Partial<Job>);
        data[`/jobs/${id}`] = job;
        return structuredClone(job) as T;
      }
      if (route.startsWith("/repairs/") && route.endsWith("/report")) {
        const name = decodeURIComponent(route.slice("/repairs/".length, -"/report".length));
        const sample = RECORDED.find((s) => s.name === name);
        if (!sample) {
          throw new EngineError("not-found", `The demo has no recorded report of ${name}: only its finished repairs have one`, 404);
        }
        const doc = structuredClone((await sample.load()).default) as RecordedReport;
        if (!abTestFinished(data["/jobs"] as JobList | undefined, name)) withoutDocument(doc, "abtest");
        moveTimes(doc, by);
        // The engine builds a report when it's asked for one (meshdoctor report.build stamps the time), so it is new.
        doc.created = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
        return doc as T;
      }
      if (!(route in data)) throw new EngineError("not-found", "Not in the demo data", 404);
      return structuredClone(data[route]) as T;
    },
  };
}
