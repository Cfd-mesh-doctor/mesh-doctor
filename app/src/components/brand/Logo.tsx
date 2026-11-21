// SPDX-License-Identifier: GPL-3.0-or-later
// The mark: a hexagon of mesh cells with one cell picked out, the same as the favicon.
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7 shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0e7c86" />
      <path d="M16 16 24.2 11.25v9.5z" fill="#86e3e8" />
      <g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
        <path d="M16 6.5 24.2 11.25v9.5L16 25.5l-8.2-4.75v-9.5z" />
        <path d="M16 6.5V25.5M7.8 11.25l16.4 9.5M24.2 11.25l-16.4 9.5" />
      </g>
    </svg>
  );
}

export function Logo({ className, tag }: { className?: string; tag?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight">Mesh Doctor</span>
      {tag && (
        <span className="rounded-md border border-border px-1.5 py-px text-[11px] font-medium text-muted-foreground">
          {tag}
        </span>
      )}
    </span>
  );
}
