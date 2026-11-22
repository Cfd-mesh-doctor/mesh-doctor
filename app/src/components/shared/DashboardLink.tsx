// SPDX-License-Identifier: GPL-3.0-or-later
// "the engine's dashboard" in a sentence: where repairs and A/B tests start until this app can start them.
import { ExternalLink } from "lucide-react";
import { useEngineDashboard } from "@/engine/context";

/**
 * On your own engine, a link that opens its dashboard in a new tab, so the app stays where it is. The demo has no
 * engine to open: there it is the words alone.
 */
export function DashboardLink() {
  const dashboard = useEngineDashboard();
  if (!dashboard) return <>the engine's dashboard</>;
  return (
    <a href={dashboard} target="_blank" rel="noreferrer"
      className="font-medium whitespace-nowrap text-primary underline-offset-4 hover:underline">
      the engine's dashboard
      <ExternalLink className="ml-0.5 inline size-3 align-[-1px]" aria-hidden />
    </a>
  );
}
