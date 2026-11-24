// SPDX-License-Identifier: GPL-3.0-or-later
// Solving a case Mesh Doctor made, from the app (API 1.6): the iteration to solve to and, for a first solve, the
// processes, whether the solve fits in the memory of the engine's computer, then POST /jobs (a `solve` job) and the
// run's page. A continuation goes on from the latest iteration written, on the run's own processes. The demo can't
// start jobs: it says so and gives the command that does the same in a terminal.
import { FastForward, Play } from "lucide-react";
import { useId, useState } from "react";
import { useNavigate } from "react-router";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { Button } from "@/components/ui/button";
import { DialogActions, DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/misc";
import { useAppPath, useEngine } from "@/engine/context";
import { useCases, useJobs, useMachine, useStartJob } from "@/engine/hooks";
import { JOB_KIND_LABEL, isActive, type Run } from "@/engine/types";
import { machineFields } from "@/estimate/machine";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FIELD, GB, JobDialog, Note } from "./dialogParts";
import { stepMemory } from "./repairStart";
import { procChoices, solveCommand, suggestedProcs, suggestedTo, toProblem } from "./solveStart";

/** What the dialog solves: a case Mesh Doctor made, and its run once it has one (then the solve continues it). */
export interface SolveTarget {
  name: string;
  run: Pick<Run, "written" | "nProcs"> | null;
}

/** The Solve dialog, for a first solve or a continuation. It is made afresh each time it opens. */
export function SolveDialog({ open, onOpenChange, target }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: SolveTarget;
}) {
  return (
    <JobDialog open={open} onOpenChange={onOpenChange}>
      <SolveForm target={target} onDone={() => onOpenChange(false)} />
    </JobDialog>
  );
}

function SolveForm({ target, onDone }: { target: SolveTarget; onDone: () => void }) {
  const { mode } = useEngine();
  const to = useAppPath();
  const navigate = useNavigate();
  const cases = useCases();
  const jobs = useJobs();
  const machine = useMachine();
  const start = useStartJob();
  const id = useId();

  const { name } = target;
  const written = target.run?.written ?? 0;
  const first = written === 0;
  const [typed, setTyped] = useState(() => String(suggestedTo(written)));
  const problem = toProblem(typed, written);
  const cores = machine.data ? machineFields(machine.data).cores : undefined;
  const [picked, setPicked] = useState<number | null>(null);
  const np = picked ?? suggestedProcs(cores);
  const memory = stepMemory("solver", cases.data?.cells?.[name] ?? null, machine.data);
  const busy = jobs.data?.items.find((j) => isActive(j.state));
  const demo = mode === "demo";
  const computer = demo ? "the demo engine's computer" : "your engine's computer";
  const Computer = demo ? "The demo engine's computer" : "Your engine's computer";
  const ready = !demo && !problem && !busy && !start.isPending;
  const procs = target.run?.nProcs;

  const submit = () => {
    if (!ready) return;
    start.mutate(
      { kind: "solve", params: { name, to: Number(typed), ...(first ? { np } : {}) } },
      { onSuccess: () => { onDone(); void navigate(to(`/solve/${encodeURIComponent(name)}`)); } },
    );
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <DialogTitle>{first ? `Solve ${name}` : `Continue ${name}`}</DialogTitle>
      <DialogDescription>
        {first
          ? "The engine splits the case over the processes you pick, starts the flow with potentialFoam and runs "
            + "foamRun to the iteration you give, as the case's own Allrun does. It writes the solution about four "
            + "times on the way; Stop writes the iteration it has reached, and a later solve continues from the latest "
            + "one written."
          : `The solve continues from iteration ${formatInt(written)}, the latest written, ${
            procs && procs > 1 ? `on the run's ${procs} processes` : "unsplit, as the run was"}, to the iteration you `
            + "give."}
      </DialogDescription>

      <div className="mt-5 space-y-5">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-to`} className="text-sm font-medium">Solve to iteration</label>
          <Input
            id={`${id}-to`}
            value={typed}
            onChange={(e) => setTyped(e.target.value.trim())}
            inputMode="numeric"
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-to-hint`}
            autoComplete="off"
            className={cn("max-w-40 tabular-nums", problem && "border-danger")}
          />
          <p id={`${id}-to-hint`} className={cn("text-xs", problem ? "text-danger" : "text-muted-foreground")}>
            {problem ?? (first
              ? "Where the solve ends. Stop ends it sooner, and Continue goes on from where it ended."
              : `Past ${formatInt(written)}, the latest iteration written.`)}
          </p>
        </div>

        {first && (
          <div className="space-y-1.5">
            <label htmlFor={`${id}-np`} className="text-sm font-medium">Processes</label>
            <select id={`${id}-np`} className={cn(FIELD, "max-w-40")} value={np}
              onChange={(e) => setPicked(Number(e.target.value))} aria-describedby={`${id}-np-hint`}>
              {procChoices(cores).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <p id={`${id}-np-hint`} className="text-xs text-muted-foreground">
              {np === 1
                ? "One process solves the case as it is, unsplit."
                : `The case is split into ${np} parts (decomposePar), each solved by a process of its own (mpirun).`}
              {" "}A continuation keeps the same.{cores ? ` ${Computer} has ${cores} cores.` : ""}
            </p>
          </div>
        )}

        <div className="space-y-2">
          {memory ? (
            memory.fits ? (
              <Note tone="ok">
                The solve needs about <GB value={memory.need} /> of memory; {computer} has <GB value={memory.have} />
                {memory.limited ? " (its RAM limit)" : ""}.
              </Note>
            ) : (
              <Note tone="warn">
                The solve needs about <GB value={memory.need} /> of memory, more than {computer} can give it: a job may
                use 90&nbsp;% of its <GB value={memory.have} />{memory.limited ? " (its RAM limit)" : ""}. The engine
                refuses a solve that won&apos;t fit in its free memory.
              </Note>
            )
          ) : (
            <Note tone="info">
              {Computer} doesn&apos;t say how much memory it has, or the case&apos;s size isn&apos;t known, so the memory
              isn&apos;t checked here; the engine checks it when the solve starts.
            </Note>
          )}
          {busy && !demo && (
            <Note tone="warn">
              {JOB_KIND_LABEL[busy.kind] ?? busy.kind} {busy.name} is {busy.state === "queued" ? "waiting to start" : "running"}.
              The engine runs one big job at a time, to keep memory safe: solve this case when it has finished.
            </Note>
          )}
        </div>

        {demo && !problem && (
          <div className="space-y-2 rounded-lg border border-border bg-surface-2/50 p-3">
            <p className="text-[13px]">
              The demo can&apos;t start jobs. With your own engine paired, {first ? "Solve" : "Continue"} runs this on
              your computer; in a WSL or Linux terminal, this command does the same:
            </p>
            <CopyCommand command={solveCommand(name, Number(typed), first ? np : null)} />
          </div>
        )}
      </div>

      {start.isError && <ErrorPanel compact className="mt-4" error={start.error} />}

      <DialogActions>
        {demo ? (
          <DialogClose asChild>
            <Button variant="secondary">Close</Button>
          </DialogClose>
        ) : (
          <>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={!ready}>
              {first ? <Play aria-hidden /> : <FastForward aria-hidden />}
              {start.isPending ? "Starting…" : first ? "Solve" : "Continue"}
            </Button>
          </>
        )}
      </DialogActions>
    </form>
  );
}
