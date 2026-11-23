// SPDX-License-Identifier: GPL-3.0-or-later
// Data for the screens. Answers are cached per engine; jobs refresh every 3 s while one is active.
import { QueryClient, skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { useEngine } from "./context";
import { asEngineError } from "./errors";
import { isActive, type AbtestDetail, type Job, type JobList, type JobRequest } from "./types";

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

/** Starts a job. The new job goes into the jobs list at once, so the Jobs screen and an A/B test's page can follow it
 * before the next refresh; then the jobs and the repair runs are asked for again, and after an A/B job the A/B
 * tests. */
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
      if (body.kind !== "repair") {
        void qc.invalidateQueries({ queryKey: [transport?.scope, "abtests"] });
        void qc.invalidateQueries({ queryKey: [transport?.scope, "abtest"] });
      }
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
