// SPDX-License-Identifier: GPL-3.0-or-later
// What an empty list of jobs says: where jobs start, and a way there; and where a repair run in a terminal shows, as it
// isn't a job.
import { ExternalLink, FolderOpen, ListChecks } from "lucide-react";
import { Link } from "react-router";
import { EmptyState } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { useAppPath, useEngineDashboard } from "@/engine/context";

/**
 * No job has been started yet. Repairs start from a case's Repair button (Cases) or New repair (Repairs), A/B tests
 * from a finished repair (Start an A/B test on the A/B tests screen, or the repair's report); the engine's own
 * dashboard starts both too, linked here in a new tab so the app stays where it is. A repair run in a terminal, as
 * Getting started says to, isn't a job: it shows with the repair runs on the Overview (`here`: this list is on the
 * Overview).
 */
export function NoJobsYet({ here = false }: { here?: boolean }) {
  const dashboard = useEngineDashboard();
  const to = useAppPath();
  return (
    <EmptyState
      icon={ListChecks}
      title="No jobs yet"
      action={(
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link to={to("/cases")}><FolderOpen aria-hidden /> Go to your cases</Link>
          </Button>
          {dashboard && (
            <Button variant="secondary" size="sm" asChild>
              <a href={dashboard} target="_blank" rel="noreferrer">
                Open the engine's dashboard <ExternalLink aria-hidden />
              </a>
            </Button>
          )}
        </div>
      )}
    >
      Repairs started with a case&apos;s Repair button, and A/B tests started from a finished repair, show here while
      they run, with their progress, as do those started from the engine&apos;s own dashboard. A repair run in a terminal
      isn&apos;t a job: it shows under Repair runs{" "}
      {here ? "on this page" : (
        <>on the <Link to={to()} className="font-medium text-primary underline-offset-4 hover:underline">Overview</Link></>
      )}{" "}
      once its copy is made.
    </EmptyState>
  );
}
