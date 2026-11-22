// SPDX-License-Identifier: GPL-3.0-or-later
import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, overlayClassName, children, ...props }: ComponentProps<typeof D.Content> & {
  /** For a dialog that shows the screen behind it: the app tour lightens the shade. */
  overlayClassName?: string;
}) {
  return (
    <D.Portal>
      <D.Overlay
        className={cn("fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in", overlayClassName)}
      />
      <D.Content
        // A dialog never grows past the screen: a tall one (a job's details on a small phone) scrolls inside, rather
        // than losing its title above the screen and its buttons below it.
        className={cn(
          "fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 " +
            "-translate-y-1/2 overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-6 " +
            "shadow-pop focus:outline-none data-[state=open]:animate-pop-in",
          className,
        )}
        {...props}
      >
        {children}
        <D.Close className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground hover:bg-surface-2 hover:text-foreground">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof D.Title>) {
  return <D.Title className={cn("pr-8 text-base font-semibold", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof D.Description>) {
  return <D.Description className={cn("mt-2 text-sm text-muted-foreground", className)} {...props} />;
}

export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex justify-end gap-2">{children}</div>;
}

/** A panel that slides in from the left: the navigation on small screens. */
export const Sheet = D.Root;
export const SheetTitle = D.Title;

export function SheetContent({ className, children, ...props }: ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-fade-in" />
      <D.Content
        aria-describedby={undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-border bg-sidebar shadow-pop " +
            "focus:outline-none data-[state=open]:animate-slide-in",
          className,
        )}
        {...props}
      >
        {children}
        <D.Close className="absolute top-4 right-3 rounded-md p-1 text-muted-foreground hover:bg-surface-2 hover:text-foreground">
          <X className="size-4" />
          <span className="sr-only">Close navigation</span>
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
