// SPDX-License-Identifier: GPL-3.0-or-later
// A page's search box. "/" puts the cursor in it, as on most docs sites, unless another field has the cursor; while
// it is empty and not focused it shows that key (not on a phone, which has no keyboard to press it on).
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, type ComponentProps } from "react";
import { Input } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

/** className is for the box's place on the page (its margin, say); `icon` goes at the box's start (the app's Cases
 *  filter has a magnifier); the rest goes to the input. */
export function SearchInput({ className, value, icon: Icon, ...props }:
  Omit<ComponentProps<"input">, "type" | "ref"> & { icon?: LucideIcon }) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const at = e.target;
      if (at instanceof HTMLElement && (at.isContentEditable || at.closest("input, textarea, select"))) return;
      e.preventDefault();
      box.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className={cn("relative", className)}>
      {Icon && (
        <Icon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      )}
      <Input
        ref={box}
        type="search"
        className={cn("peer pr-9 [font-variant-ligatures:none]", Icon && "pl-9")}
        value={value}
        aria-keyshortcuts="/"
        {...props}
      />
      {!value && (
        <kbd
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-border bg-surface-2 px-1.5 font-mono text-xs leading-5 text-muted-foreground peer-focus:hidden sm:block"
        >
          /
        </kbd>
      )}
    </div>
  );
}
