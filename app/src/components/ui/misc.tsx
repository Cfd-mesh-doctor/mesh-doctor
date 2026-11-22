// SPDX-License-Identifier: GPL-3.0-or-later
// Small pieces: progress bar, loading placeholder, text field, segmented control.
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Progress({ value, tone = "primary", label, className }: {
  value: number | null | undefined; tone?: "primary" | "success" | "danger" | "neutral"; label?: string; className?: string;
}) {
  const v = value == null || !Number.isFinite(value) ? null : Math.max(0, Math.min(1, value));
  const colour = { primary: "bg-primary", success: "bg-success", danger: "bg-danger", neutral: "bg-muted-foreground" }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v == null ? undefined : Math.round(v * 100)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-border", className)}
    >
      {/* With no value yet, a faint bar across the whole track: a third of it would read as 33 %, the more so when
          it stands still for those who ask for less motion. */}
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", colour, v == null && "w-full animate-pulse opacity-30")}
        style={v == null ? undefined : { width: `${v * 100}%` }}
      />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} aria-hidden />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm shadow-card placeholder:text-muted-foreground " +
          "focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0",
        className,
      )}
      {...props}
    />
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string;
}) {
  return (
    // On a narrow phone the options scroll sideways inside the control instead of widening the page.
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface-2 p-0.5 [scrollbar-width:none]"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1 text-[13px] font-medium whitespace-nowrap text-muted-foreground",
            "transition-colors hover:text-foreground sm:px-3",
            value === o.value && "bg-surface text-foreground shadow-card",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
