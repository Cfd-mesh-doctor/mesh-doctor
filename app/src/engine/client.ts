// SPDX-License-Identifier: GPL-3.0-or-later
// How the app reaches an engine. The real one is Mesh Doctor on this computer (http://localhost);
// the demo answers from recorded data. Screens only see a Transport, so both look the same to them.
import { NOT_THE_ENGINE, EngineError, isEngineCode } from "./errors";
import { localAccessState } from "./permission";
import type {
  AbtestDetail, AbtestList, AbtestLive, CaseJudge, CaseList, ClusterShape, EngineInfo, Job, JobList, JobRequest, JudgeAnswer,
  MachineInfo, Readiness, RepairList, RunDetail, RunList, RunLive, RunValidation, TemplateList, TransientPlan, VariantList,
} from "./types";
import { API_MAJOR } from "./types";
import type { Report } from "@/report/read";

export type Method = "GET" | "POST";

export interface Transport {
  readonly kind: "engine" | "demo";
  /** Keeps cached answers from different engines (and the demo) apart. */
  readonly scope: string;
  request<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
}

// Chrome's Local Network Access: says up front that the request goes to this computer.
type LocalRequestInit = RequestInit & { targetAddressSpace?: "loopback" | "local" | "public" };

const TIMEOUT_MS = 15_000;

export function httpTransport(engine: string, key: string, timeoutMs = TIMEOUT_MS): Transport {
  return {
    kind: "engine",
    scope: engine,
    async request<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const stop = () => ctrl.abort();
      signal?.addEventListener("abort", stop, { once: true });
      try {
        let res: Response;
        try {
          const init: LocalRequestInit = {
            method,
            headers: body === undefined ? { "X-MD-Key": key } : { "X-MD-Key": key, "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: ctrl.signal,
            cache: "no-store",
            credentials: "omit",
            mode: "cors",
            redirect: "error",
            referrerPolicy: "no-referrer",
            targetAddressSpace: "loopback",
          };
          res = await fetch(`${engine}/api/v1${path}`, init);
        } catch {
          if (signal?.aborted) throw new EngineError("aborted", "Cancelled");
          if (ctrl.signal.aborted) throw new EngineError("timeout", `No answer from ${engine} in ${timeoutMs / 1000} s`);
          // A network error says nothing more: not running, blocked by the browser, or this site not allowed.
          if ((await localAccessState()) === "denied") {
            throw new EngineError("permission-denied", "The browser blocked access to apps on this device");
          }
          throw new EngineError("unreachable", `Nothing answered at ${engine}`);
        }
        let doc: unknown;
        try {
          doc = await res.json();
        } catch {
          if (ctrl.signal.aborted && !signal?.aborted) throw new EngineError("timeout", "The answer took too long");
          throw new EngineError("bad-response", `HTTP ${res.status} ${NOT_THE_ENGINE}`, res.status);
        }
        if (!res.ok) {
          const err = (doc as { error?: { code?: unknown; message?: unknown } } | null)?.error;
          throw new EngineError(
            isEngineCode(err?.code) ? err.code : "bad-response",
            typeof err?.message === "string" ? err.message : `HTTP ${res.status}`,
            res.status,
          );
        }
        return doc as T;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
      }
    },
  };
}

/** The API calls the screens use; each one is a route in the engine's OpenAPI document. */
export const api = {
  async info(t: Transport, signal?: AbortSignal): Promise<EngineInfo> {
    const info = await t.request<EngineInfo>("GET", "/", undefined, signal);
    const major = Number(String(info?.apiVersion ?? "").split(".")[0]);
    if (major !== API_MAJOR) {
      throw new EngineError(
        "incompatible",
        `This app speaks API ${API_MAJOR}.x; the engine reports ${info?.apiVersion || "no version"}. ` +
          (major > API_MAJOR ? "Reload the app to get the newest version." : "Update Mesh Doctor (git pull) and restart it."),
      );
    }
    return info;
  },
  cases: (t: Transport, signal?: AbortSignal) => t.request<CaseList>("GET", "/cases", undefined, signal),
  jobs: (t: Transport, signal?: AbortSignal) => t.request<JobList>("GET", "/jobs?limit=200", undefined, signal),
  job: (t: Transport, id: string, signal?: AbortSignal) =>
    t.request<Job>("GET", `/jobs/${encodeURIComponent(id)}`, undefined, signal),
  cancelJob: (t: Transport, id: string) => t.request<Job>("POST", `/jobs/${encodeURIComponent(id)}/cancel`),
  /** Starts a job; the engine answers with it, queued (202). Every job works on copies of a case. */
  startJob: (t: Transport, body: JobRequest) => t.request<Job>("POST", "/jobs", body),
  repairs: (t: Transport, signal?: AbortSignal) => t.request<RepairList>("GET", "/repairs", undefined, signal),
  report: (t: Transport, name: string, signal?: AbortSignal) =>
    t.request<Report>("GET", `/repairs/${encodeURIComponent(name)}/report`, undefined, signal),
  /** One defect cluster's shapes, before or after the repair, numbered as the repair lists them (from 0). */
  cluster: (t: Transport, name: string, id: number, tag: "before" | "after", signal?: AbortSignal) =>
    t.request<ClusterShape>("GET", `/repairs/${encodeURIComponent(name)}/clusters/${id}?tag=${tag}`, undefined, signal),
  abtests: (t: Transport, signal?: AbortSignal) => t.request<AbtestList>("GET", "/abtests", undefined, signal),
  abtest: (t: Transport, name: string, signal?: AbortSignal) =>
    t.request<AbtestDetail>("GET", `/abtests/${encodeURIComponent(name)}`, undefined, signal),
  /** The live monitor of an A/B test's repaired-mesh run. */
  abtestLive: (t: Transport, name: string, signal?: AbortSignal) =>
    t.request<AbtestLive>("GET", `/abtests/${encodeURIComponent(name)}/live`, undefined, signal),
  /** The judge on one run of an A/B test: the original mesh's (base) or the repaired one's (fixed). */
  abtestJudge: (t: Transport, name: string, side: "base" | "fixed", signal?: AbortSignal) =>
    t.request<JudgeAnswer>("GET", `/abtests/${encodeURIComponent(name)}/judge?side=${side}`, undefined, signal),
  /** The solver-setting presets an A/B test's second run can use: on the original mesh, in place of the case's own. */
  variants: (t: Transport, signal?: AbortSignal) => t.request<VariantList>("GET", "/variants", undefined, signal),
  /** The computer the engine runs on (API 1.1); an older engine answers not-found. */
  machine: (t: Transport, signal?: AbortSignal) => t.request<MachineInfo>("GET", "/machine", undefined, signal),
  /** The engine's self check (API 1.4), run for this answer; an older engine answers not-found. */
  readiness: (t: Transport, signal?: AbortSignal) => t.request<Readiness>("GET", "/check", undefined, signal),
  templates: (t: Transport, signal?: AbortSignal) => t.request<TemplateList>("GET", "/templates", undefined, signal),
  /** The solves of the cases Mesh Doctor made (API 1.6); an older engine answers not-found. */
  runs: (t: Transport, signal?: AbortSignal) => t.request<RunList>("GET", "/runs", undefined, signal),
  run: (t: Transport, name: string, signal?: AbortSignal) =>
    t.request<RunDetail>("GET", `/runs/${encodeURIComponent(name)}`, undefined, signal),
  /** A run's page data: its residuals and forces, the solver's pace and the live judge. */
  runLive: (t: Transport, name: string, signal?: AbortSignal) =>
    t.request<RunLive>("GET", `/runs/${encodeURIComponent(name)}/live`, undefined, signal),
  /** Verify install: a run of the Ahmed body template against the wind tunnel and the accuracy check's run. */
  runValidation: (t: Transport, name: string, signal?: AbortSignal) =>
    t.request<RunValidation>("GET", `/runs/${encodeURIComponent(name)}/validation`, undefined, signal),
  /** The transient plan a tplan job made of a case (API 1.6); not-found before one. */
  transientPlan: (t: Transport, name: string, signal?: AbortSignal) =>
    t.request<TransientPlan>("GET", `/tplans/${encodeURIComponent(name)}`, undefined, signal),
  /** Stops a run: the solver writes the iteration it is at and ends, and a continuation starts from there. */
  stopRun: (t: Transport, name: string) => t.request<RunDetail>("POST", `/runs/${encodeURIComponent(name)}/stop`),
  /** The judge on a case's solve, over all its solver logs: is it converged? */
  caseJudge: (t: Transport, name: string, signal?: AbortSignal) =>
    t.request<CaseJudge>("GET", `/judge?case=${encodeURIComponent(name)}`, undefined, signal),
};
