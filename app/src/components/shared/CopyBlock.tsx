// SPDX-License-Identifier: GPL-3.0-or-later
// A block of code as a doc writes it, with a button in its corner that copies all of it, as the site's copy box does
// for a one-line command (CopyCommand.tsx). The button keeps its corner while a wide block scrolls under it.
import { Check, Copy } from "lucide-react";
import { useCopy } from "@/lib/useCopy";
import { cn } from "@/lib/utils";

/** The button's name, saying what it copies by the block's first line: "Copy the 2 lines starting “/plugin …”". */
export function copyBlockLabel(code: string): string {
  const lines = code.replace(/\n+$/, "").split("\n");
  const first = (lines.find((l) => l.trim()) ?? "").replace(/\s+/g, " ").trim();
  const shown = first.length > 40 ? `${first.slice(0, 40).trimEnd()}…` : first;
  return lines.length === 1 ? `Copy “${shown}”` : `Copy the ${lines.length} lines starting “${shown}”`;
}

export function CopyBlock({ code, className }: { code: string; className?: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className={cn("relative", className)}>
      <pre className="overflow-x-auto rounded-lg border border-border bg-surface-2 py-2.5 pr-11 pl-3 font-mono text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={() => void copy(code)}
        aria-label={copied ? "Copied" : copyBlockLabel(code)}
        className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-md bg-surface-2 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground print:hidden"
      >
        {copied ? <Check className="size-4 text-success" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
    </div>
  );
}
