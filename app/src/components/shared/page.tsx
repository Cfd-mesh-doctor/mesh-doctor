// SPDX-License-Identifier: GPL-3.0-or-later
// Pieces every screen uses: its header, number tiles, the empty state.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatTile({ label, value, hint, icon: Icon, loading, tone }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; loading?: boolean;
  tone?: "primary" | "success" | "warning" | "danger";
}) {
  const ring = tone ? { primary: "text-primary", success: "text-success", warning: "text-warning", danger: "text-danger" }[tone] : "text-muted-foreground";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        {Icon && <Icon className={cn("size-4", ring)} aria-hidden />}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {loading ? <Skeleton className="h-8 w-20" /> : value}
      </div>
      {hint && <div className="mt-1 truncate text-xs text-muted-foreground">{loading ? <Skeleton className="h-3.5 w-28" /> : hint}</div>}
    </Card>
  );
}

export function EmptyState({ icon: Icon, title, children, action, className, heading: Heading = "h3" }: {
  icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; className?: string;
  /** The title's heading level: h1 when the empty state is the whole page (one that doesn't exist). */
  heading?: "h1" | "h2" | "h3";
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className="grid size-11 place-items-center rounded-xl bg-surface-2 ring-1 ring-border">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <Heading className="mt-4 text-sm font-semibold">{title}</Heading>
      {children && <div className="mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Rows of grey bars while a table loads. */
export function TableSkeleton({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-border" aria-busy>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-6 px-4 py-3.5">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cn("h-4", c === 0 ? "w-48" : "w-20")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A label above a value, for detail lists. A mono value (a path, an address, a key) wraps rather than being cut
 * off, as its end is often the part that tells it apart. It breaks at its hyphens or slashes first, and inside a
 * word only where a part doesn't fit on a line.
 */
export function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-sm", mono ? "font-mono text-[13px] wrap-anywhere" : "truncate")}>{children}</dd>
    </div>
  );
}
