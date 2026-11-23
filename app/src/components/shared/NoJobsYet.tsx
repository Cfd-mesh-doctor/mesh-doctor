// SPDX-License-Identifier: GPL-3.0-or-later
// What an empty list of jobs says: where jobs start, and a way there; and where a repair run in a terminal shows, as it
// isn't a job.
import { ExternalLink, ListChecks } from "lucide-react";
import { Link } from "react-router";
import { EmptyState } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { useAppPath, useEngineDashboard } from "@/engine/context";

/**
 * No job has been started yet. Until this app can start them, repairs and A/B tests start from the engine's own
 * dashboard, linked here in a new tab so the app stays where it is. A repair run in a terminal, as Getting started
 * says to, isn't a job: it shows with the repair runs on the Overview (`here`: this list is on the Overview).
 */
export function NoJobsYet({ here = false }: { here?: boolean }) {
  const dashboard = useEngineDashboard();
  const to = useAppPath();
  return (
    <EmptyState
      icon={ListChecks}
      title="No jobs yet"
      action={dashboard && (
        <Button variant="secondary" size="sm" asChild>
          <a href={dashboard} target="_blank" rel="noreferrer">
            Open the engine's dashboard <ExternalLink aria-hidden />
          </a>
        </Button>
      )}
    >
      Repairs and A/B tests started from the engine's own dashboard show here while they run, with their progress. A
      repair run in a terminal isn't a job: it shows under Repair runs{" "}
      {here ? "on this page" : (
        <>on the <Link to={to()} className="font-medium text-primary underline-offset-4 hover:underline">Overview</Link></>
      )}{" "}
      once its copy is made.
    </EmptyState>
  );
}
