// SPDX-License-Identifier: GPL-3.0-or-later
// What went wrong, in plain words, with the fix, a way to try again, and the problem's page in Troubleshooting.
import { CircleExclamationPoint, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { explain } from "@/engine/errors";
import { cn } from "@/lib/utils";
import { CopyCommand } from "./CopyCommand";
import { TextWithCode } from "./InlineCode";

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
          <p className="mt-1 text-sm text-muted-foreground"><TextWithCode text={e.hint} /></p>
          {e.command && <CopyCommand command={e.command} className="mt-3 max-w-md bg-surface" />}
          {(onRetry || e.troubleshooting) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {onRetry && (
                <Button variant="secondary" size="sm" onClick={onRetry} disabled={retrying}>
                  <RefreshCw className={cn(retrying && "animate-spin")} />
                  {retrying ? "Trying…" : "Try again"}
                </Button>
              )}
              {/* Troubleshooting opened at this one problem (it finds a problem by the message it quotes), in a new tab
                  so this page and its Try again stay as they are. */}
              {e.troubleshooting && (
                <a
                  href={`/troubleshooting?${new URLSearchParams({ q: e.title })}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  How to fix this <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
