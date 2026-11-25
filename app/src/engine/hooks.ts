// SPDX-License-Identifier: GPL-3.0-or-later
// Data for the screens. Answers are cached per engine; jobs refresh every 3 s while one is active.
import { QueryClient, keepPreviousData, skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { useEngine } from "./context";
import { asEngineError } from "./errors";
import {
  isActive, type AbtestDetail, type CaseResults, type DiskJobKind, type ForceHistory, type Job, type JobList,
  type JobRequest, type PictureSet, type PictureSetList, type ResultsList, type ResultsWindow, type RunDetail,
} from "./types";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Try again only when the engine may simply not be up yet; a refusal stays a refusal.
        retry: (count, err) => count < 2 && asEngineError(err).transient,
        retryDelay: (n) => Math.min(1000 * 2 ** n, 4000),
        staleTime: 5_000,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

export const ACTIVE_POLL_MS = 3_000;
export const IDLE_POLL_MS = 15_000;

export function jobsPollInterval(data: JobList | undefined): number {
  return data?.items.some((j) => isActive(j.state)) ? ACTIVE_POLL_MS : IDLE_POLL_MS;
}

export function useEngineInfo() {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "info"],
    queryFn: transport ? ({ signal }) => api.info(transport, signal) : skipToken,
    refetchInterval: 20_000,
  });
}

export function useCases() {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "cases"],
    queryFn: transport ? ({ signal }) => api.cases(transport, signal) : skipToken,
    staleTime: 15_000,
    // While the engine has none, ask again now and then: a first case (the README's First run, say) then shows by
    // itself, and the Overview's Getting started ticks it off.
    refetchInterval: (q) => (q.state.data?.items.length === 0 ? IDLE_POLL_MS : false),
  });
}

export function useJobs() {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "jobs"],
    queryFn: transport ? ({ signal }) => api.jobs(transport, signal) : skipToken,
    refetchInterval: (q) => jobsPollInterval(q.state.data),
  });
}

/** The repair runs. With `enabled` false they aren't asked for (what's cached still shows): for a part of the app that
 * needs them only now and then, as the tour does. */
export function useRepairs(enabled = true) {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "repairs"],
    queryFn: transport && enabled ? ({ signal }) => api.repairs(transport, signal) : skipToken,
    refetchInterval: IDLE_POLL_MS,
  });
}

/** The A/B tests, with each one's step and outcome (API 1.3). Asked for again every `every` ms: the screen asks
 * every 3 s while an A/B job runs, as the Jobs screen does. */
export function useAbtests(every: number) {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "abtests"],
    queryFn: transport ? ({ signal }) => api.abtests(transport, signal) : skipToken,
    refetchInterval: every,
  });
}

/** One A/B test, asked for again as often as `every` says for its last answer (false: not again), so its residuals
 * grow while it runs. */
export function useAbtest(name: string, every: (last: AbtestDetail | undefined) => number | false) {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "abtest", name],
    queryFn: transport ? ({ signal }) => api.abtest(transport, name, signal) : skipToken,
    refetchInterval: (q) => every(q.state.data),
  });
}

/** The live monitor of an A/B test's repaired-mesh run, every 3 s while `enabled` (while that run solves), so it
 * needs no retries of its own. A server with no live monitor (the demo has none) says so once: it isn't asked again. */
export function useAbtestLive(name: string, enabled: boolean) {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "abtest-live", name],
    queryFn: transport && enabled ? ({ signal }) => api.abtestLive(transport, name, signal) : skipToken,
    retry: false,
    refetchInterval: (q) => {
      const code = q.state.status === "error" ? asEngineError(q.state.error).code : null;
      return code === "unavailable" || code === "not-found" ? false : ACTIVE_POLL_MS;
    },
  });
}

/** The judge on one run of an A/B test, once that run has ended (`enabled`). An extension continues the repaired-mesh
 * run, so `version` (where that run ends) is part of the key: a longer run is judged again. */
export function useAbtestJudge(name: string, side: "base" | "fixed", enabled: boolean, version: number | null = null) {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "abtest-judge", name, side, version],
    queryFn: transport && enabled ? ({ signal }) => api.abtestJudge(transport, name, side, signal) : skipToken,
    staleTime: 5 * 60_000,
  });
}

/** The computer the engine runs on (API 1.1): its memory and cores, for the size estimator and the repair dialog's
 * memory check. It hardly changes, so it's asked for again only every five minutes. */
export function useMachine(enabled = true) {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "machine"],
    queryFn: transport && enabled ? ({ signal }) => api.machine(transport, signal) : skipToken,
    staleTime: 5 * 60_000,
  });
}

/** What solving case `name` takes on the disk, and the free space the engine's disk guard checks a solve against (API
 * 1.7), for the solve dialogs, with a transient run's stretch writing `writes` times (API 1.10); null: not asked. An
 * engine before API 1.7 has no such route (not-found) and doesn't check the disk: the dialogs then say nothing of
 * it. */
export function useDisk(name: string | null, writes?: number) {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "disk", name, writes ?? null],
    queryFn: transport && name != null ? ({ signal }) => api.disk(transport, name, signal, writes) : skipToken,
    staleTime: 30_000,
    // the same case's answer while one for other times written comes, not another case's
    placeholderData: (previous, query) => (query?.queryKey[2] === name ? previous : undefined),
  });
}

/** What a solve that makes its case from `template` (at `size`, else the template's own) takes on the disk, and the
 * free space for it (GET /disk?template=, API 1.13), for Verify install's dialog; null: not asked. An older engine
 * leaves it out of its answer, and the dialog then says nothing of the disk. */
export function useTemplateDisk(template: string | null, size?: string) {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "disk-template", template, size ?? null],
    queryFn: transport && template != null
      ? ({ signal }) => api.templateDisk(transport, template, size, signal) : skipToken,
    staleTime: 30_000,
  });
}

/** The param of a job a GET /disk/{kind} answer is for: while it stays the same, the last answer shows while the next
 * comes (other iterations, another mesh size), but never another case's, run's or template's. */
const DISK_SUBJECT: Record<DiskJobKind, string> = {
  repair: "source", abtest: "name", abextend: "name", case: "template", pictures: "name",
};

/** What a repair, an A/B test, its continuation or a new case writes on the disk, as the engine's disk guard counts it
 * before the job starts, and the free space there (API 1.12), for the job's dialog, from the params it would start
 * the job with; null: not asked. An engine before API 1.12 has no such route (not-found) and doesn't check the disk
 * for these jobs: the dialogs then say nothing of it. */
export function useDiskJob(kind: DiskJobKind, query: Record<string, string | number> | null) {
  const { transport } = useEngine();
  const subject = DISK_SUBJECT[kind];
  return useQuery({
    queryKey: [transport?.scope, "disk-job", kind, query],
    queryFn: transport && query ? ({ signal }) => api.diskJob(transport, kind, query, signal) : skipToken,
    staleTime: 30_000,
    placeholderData: (previous, last) =>
      query && (last?.queryKey[3] as Record<string, unknown> | null | undefined)?.[subject] === query[subject]
        ? previous : undefined,
  });
}

/** Is the engine's computer ready to repair, test and solve (API 1.4)? The engine runs its self check for each answer
 * (it loads OpenFOAM's settings in a shell: a second or two), so it isn't asked on a timer: once the page opens, when
 * Check again says so, and when the page is come back to after a while, as after fixing something in a terminal. */
export function useReadiness() {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "check"],
    queryFn: transport ? ({ signal }) => api.readiness(transport, signal) : skipToken,
    staleTime: 10_000,
  });
}

/** The cases the engine can make (API 1.5): its templates, which change only with the engine itself. */
export function useTemplates(enabled = true) {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "templates"],
    queryFn: transport && enabled ? ({ signal }) => api.templates(transport, signal) : skipToken,
    staleTime: Infinity,
  });
}

/** The solver-setting presets an A/B test's second run can use. They change only with Mesh Doctor itself, so they
 * are asked for once, while `enabled` (the A/B test dialog is open). */
export function useVariants(enabled = true) {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "variants"],
    queryFn: transport && enabled ? ({ signal }) => api.variants(transport, signal) : skipToken,
    staleTime: 30 * 60_000,
  });
}

/** An answer that asking again won't change: an engine older than the route (not-found), or a server with no live
 * monitor (unavailable). */
function refused(status: string, error: unknown, codes: readonly string[]): boolean {
  return status === "error" && codes.includes(asEngineError(error).code);
}

/** The solves of the cases Mesh Doctor made (API 1.6): asked for again every 3 s while one solves, or while a solve
 * job is `active` (it may not have written its run yet), else every 15 s. An engine before API 1.6 has none to list
 * (not-found): it isn't asked again. */
export function useRuns(active: boolean) {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "runs"],
    queryFn: transport ? ({ signal }) => api.runs(transport, signal) : skipToken,
    refetchInterval: (q) => {
      if (refused(q.state.status, q.state.error, ["not-found"])) return false;
      return active || q.state.data?.items.some((r) => r.state === "running") ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    },
  });
}

/** One run, asked for again as often as `every` says for its last answer (false: not again): every 3 s while it
 * solves, or while a solve job of it waits to start and it has no run yet. */
export function useRun(name: string, every: (last: RunDetail | undefined) => number | false) {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "run", name],
    queryFn: transport ? ({ signal }) => api.run(transport, name, signal) : skipToken,
    refetchInterval: (q) => every(q.state.data),
  });
}

/** A run's page data (its residuals, forces, pace and live judge), every `every` ms while it solves (false: not
 * again). `version` (its state and where it ended) is part of the key, so a run that has ended is asked for once
 * more, for its last iterations; the last answer shows until the new one comes. A server with no live monitor
 * (unavailable) and a run it doesn't have (not-found) say so once: neither is asked again. */
export function useRunLive(name: string, version: string, every: number | false, enabled = true) {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "run-live", name, version],
    queryFn: transport && enabled ? ({ signal }) => api.runLive(transport, name, signal) : skipToken,
    retry: false,
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (refused(q.state.status, q.state.error, ["unavailable", "not-found"]) ? false : every),
  });
}

/** The judge on a case's solve (GET /judge?case=), once its run has ended (`enabled`). A run continued further ends
 * somewhere else, so `version` (the iteration it ended at) is part of the key: it is judged again. */
export function useCaseJudge(name: string, enabled: boolean, version: number | null = null) {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "case-judge", name, version],
    queryFn: transport && enabled ? ({ signal }) => api.caseJudge(transport, name, signal) : skipToken,
    staleTime: 5 * 60_000,
  });
}

/** Verify install's comparison of a run (GET /runs/{name}/validation), once the run has ended (`enabled`). A run
 * continued further ends somewhere else, so `version` (the iteration it ended at) is part of the key. A refusal (an
 * engine from before the route, a run not made from the template) isn't asked again. */
export function useRunValidation(name: string, enabled: boolean, version: number | null = null) {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "run-validation", name, version],
    queryFn: transport && enabled ? ({ signal }) => api.runValidation(transport, name, signal) : skipToken,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** The transient plan of case `name` (GET /tplans/{name}), asked for when `enabled`. `version` names its newest
 * tplan job as it stands (its id and state), so a plan just made is asked for as its job ends. A not-found (no plan
 * yet) isn't asked again until then. */
export function useTransientPlan(name: string, enabled: boolean, version: string | null = null) {
  const { transport } = useEngine();
  return useQuery({
    queryKey: [transport?.scope, "tplan", name, version],
    queryFn: transport && enabled ? ({ signal }) => api.transientPlan(transport, name, signal) : skipToken,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** Each case's results over the judge's window (GET /results, API 1.23), asked for again every 15 s: a run that
 * solves writes its forces as it goes. An engine before API 1.23 has none to list (not-found): it isn't asked again. */
export function useResultsList() {
  const { transport } = useEngine();
  return useQuery<ResultsList>({
    queryKey: [transport?.scope, "results"],
    queryFn: transport ? ({ signal }) => api.resultsList(transport, signal) : skipToken,
    refetchInterval: (q) => (refused(q.state.status, q.state.error, ["not-found"]) ? false : IDLE_POLL_MS),
  });
}

/** One case's results over window `w` (GET /results/{case}), every 15 s while it answers (its key is under the list's,
 * so it is asked for again with it). While another window of the same case is asked for, the last answer shows
 * (isPlaceholderData), never another case's. A refusal (no such case, nothing to average yet, a window it can't
 * take) isn't asked again until the window changes. */
export function useCaseResults(name: string, w: ResultsWindow) {
  const { transport } = useEngine();
  return useQuery<CaseResults>({
    queryKey: [transport?.scope, "results", name, w.from, w.to],
    queryFn: transport ? ({ signal }) => api.caseResults(transport, name, w, signal) : skipToken,
    retry: false,
    placeholderData: (last, lastQuery) => (lastQuery?.queryKey[2] === name ? last : undefined),
    refetchInterval: (q) => (q.state.status === "error" ? false : IDLE_POLL_MS),
  });
}

/** One case's force history for its charts (GET /results/{case}/forces, API 1.24), every 15 s while it answers, as
 * its results are: a run that solves writes its forces as it goes. A refusal (an engine before API 1.24, no such case,
 * no forces yet) isn't asked again. */
export function useForceHistory(name: string) {
  const { transport } = useEngine();
  return useQuery<ForceHistory>({
    queryKey: [transport?.scope, "results", name, "forces"],
    queryFn: transport ? ({ signal }) => api.forceHistory(transport, name, signal) : skipToken,
    retry: false,
    refetchInterval: (q) => (q.state.status === "error" ? false : IDLE_POLL_MS),
  });
}

/** The sets of pictures (API 1.17), or only case `of`'s: asked for again every 3 s while a picture job waits or runs
 * (`making`, or a set listed with its job under way), else every 15 s. An engine before API 1.17 has none to list
 * (not-found): it isn't asked again. */
export function usePictureSets(making: boolean, of: string | null = null) {
  const { transport } = useEngine();
  return useQuery<PictureSetList>({
    queryKey: [transport?.scope, "pictures", of],
    queryFn: transport ? ({ signal }) => api.pictureSets(transport, of, signal) : skipToken,
    refetchInterval: (q) => refused(q.state.status, q.state.error, ["not-found"]) ? false
      : making || q.state.data?.items.some((s) => s.job != null && isActive(s.job.state)) ? ACTIVE_POLL_MS : IDLE_POLL_MS,
  });
}

/** One set of pictures: asked for again every 3 s while a job makes it (`making`, given the set as it is now, or while
 * the engine answers that it is being made the first time, not-ready), else every 15 s, and not again once the engine
 * has none (not-found); not asked for at all unless `enabled`. Its key is under the sets', so it is asked for again
 * with them. */
export function usePictureSet(name: string, set: string, making: (now: PictureSet | undefined) => boolean, enabled = true) {
  const { transport } = useEngine();
  return useQuery<PictureSet>({
    queryKey: [transport?.scope, "pictures", "set", name, set],
    queryFn: transport && enabled ? ({ signal }) => api.pictureSet(transport, name, set, signal) : skipToken,
    retry: false,
    refetchInterval: (q) => making(q.state.data) || refused(q.state.status, q.state.error, ["not-ready"]) ? ACTIVE_POLL_MS
      : refused(q.state.status, q.state.error, ["not-found"]) ? false : IDLE_POLL_MS,
  });
}

/** One picture of a set, the PNG itself, once `enabled` (once it scrolls into view). A set made again holds new
 * pictures under the same names, so `made` (when the set was made) is part of its key. It stays cached for ten
 * minutes once no picture shows it. `keep`: the picture asked for before stays while this one loads (a cut over time
 * moving on to its next written time). */
export function usePicture(name: string, set: string, made: string | null, file: string, enabled: boolean, keep = false) {
  const { transport } = useEngine();
  return useQuery<Blob>({
    queryKey: [transport?.scope, "picture", name, set, made, file],
    queryFn: transport && enabled ? ({ signal }) => api.picture(transport, name, set, file, signal) : skipToken,
    placeholderData: keep ? keepPreviousData : undefined,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: false,
  });
}

/** Deletes a set of pictures Mesh Doctor made. The set leaves the lists at once and its own answer goes (its page,
 * opened again, asks the engine afresh); then the sets are asked for again. */
export function useDeletePictures() {
  const { transport } = useEngine();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, set }: { name: string; set: string }) => {
      if (!transport) throw new Error("not connected");
      return api.deletePictures(transport, name, set);
    },
    onSuccess: (_done, { name, set }) => {
      qc.setQueriesData<PictureSetList>(
        { queryKey: [transport?.scope, "pictures"], predicate: (q) => q.queryKey.length === 3 },
        (old) => old && { ...old, items: old.items.filter((s) => !(s.case === name && s.set === set)) },
      );
      qc.removeQueries({ queryKey: [transport?.scope, "pictures", "set", name, set], exact: true });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [transport?.scope, "pictures"] }),
  });
}

/** Stops a run: the solver writes the iteration it is at and ends. The run's answer goes into its page at once; then
 * it, the runs and the jobs are asked for again. */
export function useStopRun() {
  const { transport } = useEngine();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => {
      if (!transport) throw new Error("not connected");
      return api.stopRun(transport, name);
    },
    onSuccess: (run: RunDetail, name) => qc.setQueryData([transport?.scope, "run", name], run),
    onSettled: (_run, _error, name) => {
      void qc.invalidateQueries({ queryKey: [transport?.scope, "run", name] });
      void qc.invalidateQueries({ queryKey: [transport?.scope, "runs"] });
      void qc.invalidateQueries({ queryKey: [transport?.scope, "jobs"] });
    },
  });
}

/** Starts a job. The new job goes into the jobs list at once, so the Jobs screen and an A/B test's page can follow it
 * before the next refresh; then the jobs and the repair runs are asked for again, after an A/B job the A/B tests,
 * and after a solve the runs. */
export function useStartJob() {
  const { transport } = useEngine();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: JobRequest) => {
      if (!transport) throw new Error("not connected");
      return api.startJob(transport, body);
    },
    onSuccess: (job: Job) => {
      qc.setQueryData<JobList>([transport?.scope, "jobs"], (old) =>
        old && { ...old, items: [job, ...old.items.filter((j) => j.id !== job.id)] });
    },
    onSettled: (_job, _error, body) => {
      void qc.invalidateQueries({ queryKey: [transport?.scope, "jobs"] });
      void qc.invalidateQueries({ queryKey: [transport?.scope, "repairs"] });
      if (body.kind === "case") void qc.invalidateQueries({ queryKey: [transport?.scope, "cases"] });
      if (body.kind === "abtest" || body.kind === "abextend") {
        void qc.invalidateQueries({ queryKey: [transport?.scope, "abtests"] });
        void qc.invalidateQueries({ queryKey: [transport?.scope, "abtest"] });
      }
      if (body.kind === "solve") {
        void qc.invalidateQueries({ queryKey: [transport?.scope, "runs"] });
        void qc.invalidateQueries({ queryKey: [transport?.scope, "run", body.params.name] });
      }
      if (body.kind === "pictures") void qc.invalidateQueries({ queryKey: [transport?.scope, "pictures"] });
    },
  });
}

export function useCancelJob() {
  const { transport } = useEngine();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      if (!transport) throw new Error("not connected");
      return api.cancelJob(transport, id);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [transport?.scope, "jobs"] }),
  });
}
