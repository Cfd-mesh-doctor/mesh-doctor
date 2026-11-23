// SPDX-License-Identifier: GPL-3.0-or-later
// A command to run in WSL or a Linux terminal, with a copy button.
import { Check, Copy } from "lucide-react";
import { useCopy } from "@/lib/useCopy";
import { cn } from "@/lib/utils";

export function CopyCommand({ command, className, prompt = "$" }: { command: string; className?: string; prompt?: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className={cn("group flex items-center gap-2 rounded-lg border border-border bg-surface-2 py-1.5 pr-1.5 pl-3 font-mono text-[13px]", className)}>
      <span className="text-muted-foreground select-none" aria-hidden>{prompt}</span>
      {/* scroll-fade: when the command is longer than the box, a fade where it is cut off (index.css). */}
      <code className="scroll-fade min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{command}</code>
      <button
        type="button"
        onClick={() => void copy(command)}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
        aria-label={copied ? "Copied" : `Copy “${command}”`}
      >
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
