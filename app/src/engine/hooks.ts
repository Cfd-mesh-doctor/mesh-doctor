// SPDX-License-Identifier: GPL-3.0-or-later
// Data for the screens. Answers are cached per engine; jobs refresh every 3 s while one is active.
import { QueryClient, skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { useEngine } from "./context";
import { asEngineError } from "./errors";
import { isActive, type JobList } from "./types";

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
