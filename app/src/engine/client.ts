// SPDX-License-Identifier: GPL-3.0-or-later
// How the app reaches an engine. The real one is Mesh Doctor on this computer (http://localhost);
// the demo answers from recorded data. Screens only see a Transport, so both look the same to them.
import { NOT_THE_ENGINE, EngineError, isEngineCode } from "./errors";
import { localAccessState } from "./permission";
import type {
  AbtestDetail, AbtestList, AbtestLive, CaseJudge, CaseList, ClusterShape, DiskInfo, DiskJob, DiskJobKind, EngineInfo, Job,
  JobList, JobRequest, JudgeAnswer, MachineInfo, PictureSet, PictureSetList, PicturesDeleted, Readiness, RepairList,
  ResultsList, ResultsWindow, RunDetail, RunList, RunLive, RunValidation, TemplateList, TransientPlan, VariantList,
  CaseResults, ForceHistory,
} from "./types";
import { API_MAJOR } from "./types";
import type { Report } from "@/report/read";

export type Method = "GET" | "POST";

export interface Transport {
  readonly kind: "engine" | "demo";
  /** Keeps cached answers from different engines (and the demo) apart. */
  readonly scope: string;
  request<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  /** A file the engine answers with as itself, not as JSON: a picture (API 1.17). Its refusals are JSON, as every
   * answer's. A transport without it (a test's) can't show pictures. */
  blob?(path: string, signal?: AbortSignal): Promise<Blob>;
}

// Chrome's Local Network Access: says up front that the request goes to this computer.
type LocalRequestInit = RequestInit & { targetAddressSpace?: "loopback" | "local" | "public" };

const TIMEOUT_MS = 15_000;

/** The engine's refusal in an answer that isn't ok: its code and message, else the HTTP status. */
function refusal(doc: unknown, status: number): EngineError {
  const err = (doc as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  return new EngineError(
    isEngineCode(err?.code) ? err.code : "bad-response",
    typeof err?.message === "string" ? err.message : `HTTP ${status}`,
    status,
  );
}

/** An answer's JSON document, or the engine's refusal. `late`: the time ran out while it was being read. */
async function readJson<T>(res: Response, late: () => boolean): Promise<T> {
  let doc: unknown;
  try {
    doc = await res.json();
  } catch {
    if (late()) throw new EngineError("timeout", "The answer took too long");
    throw new EngineError("bad-response", `HTTP ${res.status} ${NOT_THE_ENGINE}`, res.status);
  }
  if (!res.ok) throw refusal(doc, res.status);
  return doc as T;
}

/** A file the engine answers with as itself (a picture), or its refusal, which is JSON as ever. */
async function readFile(res: Response, late: () => boolean): Promise<Blob> {
  if (!res.ok) return readJson<never>(res, late);
  if (!(res.headers.get("Content-Type") ?? "").startsWith("image/")) {
    throw new EngineError("bad-response", `HTTP ${res.status} without the engine's picture`, res.status);
  }
  try {
    return await res.blob();
  } catch {
    if (late()) throw new EngineError("timeout", "The answer took too long");
    throw new EngineError("bad-response", "The picture broke off on its way", res.status);
  }
}

export function httpTransport(engine: string, key: string, timeoutMs = TIMEOUT_MS): Transport {
  /** One request, its answer read by `read` within the time allowed. */
  async function send<T>(method: Method, path: string, body: unknown, signal: AbortSignal | undefined,
    read: (res: Response, late: () => boolean) => Promise<T>): Promise<T> {
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
      return await read(res, () => ctrl.signal.aborted && !signal?.aborted);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
  }
  return {
    kind: "engine",
    scope: engine,
    request: <T>(method: Method, path: string, body?: unknown, signal?: AbortSignal) =>
      send(method, path, body, signal, readJson<T>),
    blob: (path: string, signal?: AbortSignal) => send("GET", path, undefined, signal, readFile),
  };
}

/** A set of pictures' address in the API: its case and its set (the time pictured, `_mean` for a mean flow's). */
const setPath = (name: string, set: string) => `/pictures/${encodeURIComponent(name)}/${encodeURIComponent(set)}`;

/** GET /results/{case}, with the window's from and to where they are asked for. */
export function resultsPath(name: string, w: ResultsWindow): string {
  const q = new URLSearchParams();
  if (w.from != null) q.set("from", String(w.from));
  if (w.to != null) q.set("to", String(w.to));
  const s = q.toString();
  return `/results/${encodeURIComponent(name)}${s ? `?${s}` : ""}`;
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
  /** The free space for a new case, and with `name`, what solving that case takes on the disk (API 1.7): a transient
   * run's stretch writing `writes` times (API 1.10; an older engine leaves it out, and says four). */
  disk: (t: Transport, name: string | null, signal?: AbortSignal, writes?: number) =>
    t.request<DiskInfo>("GET", name != null
      ? `/disk?case=${encodeURIComponent(name)}${writes != null ? `&writes=${writes}` : ""}`
      : "/disk", undefined, signal),
  /** What a solve that makes its case from `template` at `size` (else the template's own) takes on the disk, as the
   * engine's disk guard counts it, and the free space for it (API 1.13): Verify install's. An older engine leaves
   * `template` out of its answer. */
  templateDisk: (t: Transport, template: string, size?: string, signal?: AbortSignal) =>
    t.request<DiskInfo>("GET", `/disk?${new URLSearchParams(size ? { template, size } : { template })}`, undefined,
      signal),
  /** What a repair, an A/B test, its continuation or a new case writes on the disk, as the engine's disk guard counts
   * it before the job starts, and the free space where it writes (API 1.12), from the params the job would start
   * with: a repair's source, an A/B test's repair run and settings, the test and the iteration it continues to, a
   * new case's template and size. An older engine answers not-found. */
  diskJob: (t: Transport, kind: DiskJobKind, query: Record<string, string | number>, signal?: AbortSignal) =>
    t.request<DiskJob>("GET", `/disk/${kind}?${new URLSearchParams(
      Object.entries(query).map(([k, v]) => [k, String(v)]))}`, undefined, signal),
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
  /** The sets of pictures in the engine's workspace, newest first, or only case `of`'s (API 1.17); an older engine
   * answers not-found. */
  pictureSets: (t: Transport, of: string | null, signal?: AbortSignal) =>
    t.request<PictureSetList>("GET", of == null ? "/pictures" : `/pictures?case=${encodeURIComponent(of)}`, undefined,
      signal),
  /** One set: each picture's file and what it shows, and what was left out. */
  pictureSet: (t: Transport, name: string, set: string, signal?: AbortSignal) =>
    t.request<PictureSet>("GET", setPath(name, set), undefined, signal),
  /** One picture of a set, by its file as the set lists it (`<kind>/<name>.png`): the PNG itself. */
  picture: (t: Transport, name: string, set: string, file: string, signal?: AbortSignal): Promise<Blob> =>
    t.blob ? t.blob(`${setPath(name, set)}/${file.split("/").map(encodeURIComponent).join("/")}`, signal)
      : Promise.reject(new EngineError("unsupported", "This connection can't show pictures")),
  /** Deletes a set Mesh Doctor made, with its job's log; the case is never touched. */
  deletePictures: (t: Transport, name: string, set: string) =>
    t.request<PicturesDeleted>("POST", `${setPath(name, set)}/delete`),
  /** Each case's results over the judge's window, newest first, and the cases still waiting (API 1.23); an older
   * engine answers not-found. */
  resultsList: (t: Transport, signal?: AbortSignal) => t.request<ResultsList>("GET", "/results", undefined, signal),
  /** One case's results over a window: the judge's while from and to are null. */
  caseResults: (t: Transport, name: string, w: ResultsWindow, signal?: AbortSignal) =>
    t.request<CaseResults>("GET", resultsPath(name, w), undefined, signal),
  /** One case's force history for charts (API 1.24); an older engine answers not-found. */
  forceHistory: (t: Transport, name: string, signal?: AbortSignal) =>
    t.request<ForceHistory>("GET", `/results/${encodeURIComponent(name)}/forces`, undefined, signal),
};
