// SPDX-License-Identifier: GPL-3.0-or-later
// A list of steps, each ticked off from what the engine lists: the Overview's Getting started, and Try it on the
// Ahmed body. Each step has a round mark (a tick, else its number), its state in words beside its title (not by
// colour alone), and on the step to do now, a button that does it here and the command that does the same.
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { CopyBlock } from "@/components/shared/CopyBlock";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { Badge, Dot } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Where a step is: ticked off, the one to do now, under way (its job is waiting or running), or waiting for the steps
 * before it. */
export type StepState = "done" | "next" | "running" | "later";

export interface Step {
  title: string;
  state: StepState;
  text: ReactNode;
  /** A button that does it here, on the step to do now. */
  action?: ReactNode;
  /** What to run, on the step to do now: one command, or a few lines. */
  command?: string;
  block?: string;
}

/** Each state's round mark: a tick, else the step's number. */
const MARK: Record<StepState, string> = {
  done: "bg-success-soft text-success",
  next: "bg-primary text-primary-foreground",
  running: "bg-primary-soft text-primary",
  later: "bg-surface-2 text-muted-foreground ring-1 ring-inset ring-border",
};

/** Each state in words, beside the step's title. A step that waits has none. */
function StepLabel({ state }: { state: StepState }) {
  if (state === "done") return <Badge tone="success">Done</Badge>;
  if (state === "next") return <Badge tone="primary">Next</Badge>;
  if (state === "running") return <Badge tone="primary"><Dot tone="primary" pulse />Running</Badge>;
  return null;
}

/** The steps, in order, as a card's list. */
export function StepList({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="divide-y divide-border border-t border-border">
      {steps.map((s, i) => (
        <li key={s.title} aria-current={s.state === "next" ? "step" : undefined} className="flex gap-3 px-5 py-3.5">
          <span aria-hidden
            className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold", MARK[s.state])}>
            {s.state === "done" ? <Check className="size-3.5" /> : i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className={cn("text-sm font-medium", s.state === "later" && "text-muted-foreground")}>{s.title}</h3>
              <StepLabel state={s.state} />
            </div>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{s.text}</p>
            {/* The way here, then the command for a terminal, as the text names them: side by side where both fit,
                so the step is no taller for its button (on a laptop's screen, the tour's box stays clear of the
                command); on a phone the command goes under it. */}
            {(s.action || s.command) && (
              <div className="mt-3 flex max-w-3xl flex-wrap items-center gap-2">
                {s.action}
                {s.command && <CopyCommand command={s.command} className="max-w-xl min-w-0 flex-1 basis-72" />}
              </div>
            )}
            {s.block && <CopyBlock code={s.block} className="mt-3 max-w-3xl" />}
          </div>
        </li>
      ))}
    </ol>
  );
}
