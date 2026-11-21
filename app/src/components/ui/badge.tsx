// SPDX-License-Identifier: GPL-3.0-or-later
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium [&_svg]:size-3.5",
  {
    variants: {
      tone: {
        neutral: "bg-surface-2 text-muted-foreground ring-1 ring-inset ring-border",
        primary: "bg-primary-soft text-primary",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-danger-soft text-danger",
        info: "bg-info-soft text-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({ className, tone, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** A small round status light. pulse: for something happening now. */
export function Dot({ tone = "neutral", pulse = false, className }: { tone?: BadgeTone; pulse?: boolean; className?: string }) {
  const colour = {
    neutral: "bg-muted-foreground", primary: "bg-primary", success: "bg-success",
    warning: "bg-warning", danger: "bg-danger", info: "bg-info",
  }[tone];
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden>
      {pulse && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", colour)} />}
      <span className={cn("relative inline-flex size-2 rounded-full", colour)} />
    </span>
  );
}
