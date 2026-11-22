// SPDX-License-Identifier: GPL-3.0-or-later
// What an empty list of jobs says: where jobs start, and a way there.
import { ExternalLink, ListChecks } from "lucide-react";
import { EmptyState } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { useEngine, usePairing } from "@/engine/context";

/**
 * No job has been started yet. Until this app can start them, repairs and A/B tests start from the engine's own
 * dashboard (its Mesh Doctor page, with Copy + detect + correct and Run A/B), linked here in a new tab so the app stays
 * where it is.
 */
export function NoJobsYet() {
  const { mode } = useEngine();
  const { pairing } = usePairing();
  return (
    <EmptyState
      icon={ListChecks}
      title="No jobs yet"
      action={mode === "engine" && pairing && (
        <Button variant="secondary" size="sm" asChild>
          <a href={`${pairing.engine}/meshdoctor`} target="_blank" rel="noreferrer">
            Open the engine's dashboard <ExternalLink aria-hidden />
          </a>
        </Button>
      )}
    >
      Repairs and A/B tests started from the engine's own dashboard show here while they run, with their progress.
    </EmptyState>
  );
}
