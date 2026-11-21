// SPDX-License-Identifier: GPL-3.0-or-later
// What went wrong, in plain words, with the fix and a way to try again.
import { CircleExclamationPoint, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { explain } from "@/engine/errors";
import { cn } from "@/lib/utils";
import { CopyCommand } from "./CopyCommand";

export function ErrorPanel({ error, onRetry, retrying, className, compact }: {
  error: unknown; onRetry?: () => void; retrying?: boolean; className?: string; compact?: boolean;
}) {
  const e = explain(error);
  return (
    <div role="alert" className={cn("rounded-xl border border-danger/25 bg-danger-soft/60 p-4", compact ? "" : "sm:p-5", className)}>
      <div className="flex gap-3">
        <CircleExclamationPoint className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{e.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{e.hint}</p>
          {e.command && <CopyCommand command={e.command} className="mt-3 max-w-md bg-surface" />}
          {onRetry && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry} disabled={retrying}>
              <RefreshCw className={cn(retrying && "animate-spin")} />
              {retrying ? "Trying…" : "Try again"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
