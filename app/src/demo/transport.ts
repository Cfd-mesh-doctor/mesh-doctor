// SPDX-License-Identifier: GPL-3.0-or-later
// The demo: answers recorded from a real engine (the public Ahmed-body example, see fixtures.json's
// "_about"), served without any engine. It can cancel its own jobs; it cannot start anything.
import type { Method, Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import type { Job, JobList } from "@/engine/types";
import { toMillis } from "@/lib/format";
import recorded from "./fixtures.json";

type Answers = Record<string, unknown>;

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

/** Moves every recorded time so the newest is a few minutes ago: the demo always looks recent. */
export function shiftTimes(data: Answers, now = Date.now()): void {
  let newest = -Infinity;
  eachTime(data, (t) => {
    newest = Math.max(newest, t);
    return t;
  });
  if (!Number.isFinite(newest)) return;
  const by = now - 4 * 60_000 - newest;
  eachTime(data, (t) => t + by);
}

export function demoTransport(answers: Answers = (recorded as { answers: Answers }).answers, delayMs = DELAY_MS): Transport {
  // A private copy, so cancelling a demo job lasts until the page is reloaded and never touches the import.
  const data: Answers = structuredClone(answers);
  shiftTimes(data);
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
      if (!(route in data)) throw new EngineError("not-found", "Not in the demo data", 404);
      return structuredClone(data[route]) as T;
    },
  };
}
