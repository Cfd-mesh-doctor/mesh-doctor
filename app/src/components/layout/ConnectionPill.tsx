// SPDX-License-Identifier: GPL-3.0-or-later
// The engine's state in one glance: connected (and its version), offline, blocked, or demo data.
import { Link } from "react-router";
import { Dot } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { useAppPath, useEngine } from "@/engine/context";
import { cn } from "@/lib/utils";
import { useConnection } from "./connection";

export function ConnectionPill({ className }: { className?: string }) {
  const c = useConnection();
  const { mode } = useEngine();
  const to = useAppPath();
  return (
    <Tip label={c.detail} side="bottom">
      <Link
        to={mode === "demo" ? "/connect" : to("/settings")}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-full border border-border bg-surface px-3 text-[13px] font-medium " +
            "shadow-card transition-colors hover:bg-surface-2",
          className,
        )}
      >
        <Dot tone={c.tone} pulse={c.pulse && c.tone !== "success"} />
        {c.label}
      </Link>
    </Tip>
  );
}
