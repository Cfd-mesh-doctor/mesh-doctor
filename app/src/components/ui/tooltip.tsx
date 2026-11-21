// SPDX-License-Identifier: GPL-3.0-or-later
import { Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";

export const TooltipProvider = T.Provider;

/** A short hint on hover or keyboard focus. */
export function Tip({ label, children, side = "top" }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-64 rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-pop"
        >
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
