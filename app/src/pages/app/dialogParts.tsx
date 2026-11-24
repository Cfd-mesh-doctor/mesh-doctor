// SPDX-License-Identifier: GPL-3.0-or-later
// What the dialogs that start a job share: the dialog itself, which gives the focus back to the button that opened
// it, a <select>'s look, the lines that say how things stand, an amount of memory or disk space kept on one line, and
// the line that says what a job takes on the disk.
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { DiskJob } from "@/engine/types";
import { gigabytes } from "@/estimate/estimate";
import { cn } from "@/lib/utils";
import { diskSpace } from "./solveStart";

/** A <select> that looks like the app's text fields. */
export const FIELD = "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm shadow-card " +
  "focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0";

/** An amount of memory, kept on one line ("25.0 GB", never "25.0" and "GB" on two). */
export function GB({ value }: { value: number }) {
  return <span className="whitespace-nowrap">{gigabytes(value)}</span>;
}

/** An amount of disk space, kept on one line ("2.4 GB", never "2.4" and "GB" on two). */
export function Space({ mb }: { mb: number }) {
  return <span className="whitespace-nowrap">{diskSpace(mb)}</span>;
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

/** The disk a job writes on, as its dialog says it (GET /disk/{kind}'s `folder`). */
const WHERE = { workspace: "the disk the engine's workspace is on", cases: "the disk the cases are on" } as const;

/**
 * What a job takes on the disk, as the engine's disk guard counts it before the job starts, and whether that fits with
 * what the engine keeps free (GET /disk/{kind}, API 1.12): `needs` says what takes it ("The copy and its repair need"),
 * `refuses` the job the engine turns away when it doesn't ("a repair"). Nothing when the engine doesn't say: an
 * engine before API 1.12, or a size or free space it can't measure, which its disk guard lets through.
 */
export function DiskNote({ disk, needs, refuses }: { disk: DiskJob | undefined; needs: string; refuses: string }) {
  if (!disk || disk.needMb == null || disk.freeMb == null) return null;
  const where = WHERE[disk.folder];
  return disk.needMb + disk.keepMb <= disk.freeMb ? (
    <Note tone="ok">
      {needs} about <Space mb={disk.needMb} /> of disk space; {where} has <Space mb={disk.freeMb} /> free.
    </Note>
  ) : (
    <Note tone="warn">
      {needs} about <Space mb={disk.needMb} /> of disk space, more than {where} can give: it
      has <Space mb={disk.freeMb} /> free, and the engine keeps <Space mb={disk.keepMb} /> of that for everything else.
      Delete runs or results you no longer need: the engine refuses {refuses} that won&apos;t fit.
    </Note>
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
