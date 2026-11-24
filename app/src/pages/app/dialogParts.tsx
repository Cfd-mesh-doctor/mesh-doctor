// SPDX-License-Identifier: GPL-3.0-or-later
// What the dialogs that start a job share: the dialog itself, which gives the focus back to the button that opened
// it, a <select>'s look, the lines that say how things stand, and an amount of memory kept on one line.
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { gigabytes } from "@/estimate/estimate";
import { cn } from "@/lib/utils";

/** A <select> that looks like the app's text fields. */
export const FIELD = "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm shadow-card " +
  "focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0";

/** An amount of memory, kept on one line ("25.0 GB", never "25.0" and "GB" on two). */
export function GB({ value }: { value: number }) {
  return <span className="whitespace-nowrap">{gigabytes(value)}</span>;
}

/** A line of the dialog that says how things stand, with an icon for its tone. */
export function Note({ tone, children }: { tone: "ok" | "warn" | "info"; children: ReactNode }) {
  const Icon = tone === "ok" ? CircleCheck : tone === "warn" ? CircleAlert : Info;
  return (
    <p className={cn("flex gap-2 text-[13px]", tone === "warn" ? "text-foreground" : "text-muted-foreground")}>
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0",
        tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-muted-foreground")} />
      <span>{children}</span>
    </p>
  );
}

/**
 * A dialog that starts a job. Its form is a child, made afresh each time it opens, so nothing typed last time
 * stays. Radix gives the focus back only to a Dialog.Trigger: this gives it back to the button that opened the
 * dialog, unless that is gone, as after a start that moved on to another screen.
 */
export function JobDialog({ open, onOpenChange, children, wide = false }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** Wider, for a table: a transient plan's. */
  wide?: boolean;
}) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={wide ? "max-w-3xl" : "max-w-lg"}
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (opener.current?.isConnected) opener.current.focus();
        }}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
