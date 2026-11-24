// SPDX-License-Identifier: GPL-3.0-or-later
// Solving a case Mesh Doctor made, from the app (API 1.6): the iteration to solve to and, for a first solve, the
// processes, whether the solve fits in the memory of the engine's computer, then POST /jobs (a `solve` job) and the
// run's page. A continuation goes on from the latest iteration written, on the run's own processes. A case you made is
// solved through a copy (CopyDialog): the case and the copy's name, then the same; the job makes the copy first, as a
// new case of its own. Verify install (VerifyDialog) makes the coarse Ahmed body from its template and solves it to
// iteration 2,000, as the accuracy check did: its name and processes, then the same, in one job. The demo can't start
// jobs: it says so and gives the command that does the same in a terminal.
import { CopyPlus, FastForward, Play, ShieldCheck } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { Button } from "@/components/ui/button";
import { DialogActions, DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/misc";
import { useAppPath, useEngine } from "@/engine/context";
import { useCases, useJobs, useMachine, useRuns, useStartJob } from "@/engine/hooks";
import { JOB_KIND_LABEL, isActive, type Run } from "@/engine/types";
import { machineFields } from "@/estimate/machine";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FIELD, GB, JobDialog, Note } from "./dialogParts";
import { stepMemory } from "./repairStart";
import {
  FIRST_TO, copyName, copyNameProblem, copyTaken, procChoices, solveCommand, suggestedProcs, suggestedTo, toProblem,
  yourCases,
} from "./solveStart";
import { VERIFY, VERIFY_CELLS, verifyCommand, verifyName, verifyNameProblem, verifyProcs, verifyTaken } from "./verify";

/** What the dialog solves: a case Mesh Doctor made, and its run once it has one (then the solve continues it). */
export interface SolveTarget {
  name: string;
  run: Pick<Run, "written" | "nProcs"> | null;
  /** The iteration to suggest (Try it on the Ahmed body's short solve), when past what is written. */
  to?: number;
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

/** The dialog that solves a copy of a case you made, the first of yours picked unless `source` says. It is made
 * afresh each time it opens. */
export function CopyDialog({ open, onOpenChange, source }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: string;
}) {
  return (
    <JobDialog open={open} onOpenChange={onOpenChange}>
      <CopyForm source={source} onDone={() => onOpenChange(false)} />
    </JobDialog>
  );
}

/** The Verify install dialog: the coarse Ahmed body made from its template and solved to iteration 2,000, under a
 * free name (verify-install, then -2, -3…). It is made afresh each time it opens; `onStarted` hears the job's name. */
export function VerifyDialog({ open, onOpenChange, onStarted }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted?: (name: string) => void;
}) {
  return (
    <JobDialog open={open} onOpenChange={onOpenChange}>
      <VerifyForm onDone={(name) => { onOpenChange(false); onStarted?.(name); }} />
    </JobDialog>
  );
}

/** What the dialogs need: the engine and its computer, the big job it runs now, and starting a solve job. */
function useSolveStart() {
  const { mode } = useEngine();
  const to = useAppPath();
  const navigate = useNavigate();
  const cases = useCases();
  const jobs = useJobs();
  const machine = useMachine();
  const start = useStartJob();
  const demo = mode === "demo";
  return {
    demo, cases, jobs, machine, start,
    cores: machine.data ? machineFields(machine.data).cores : undefined,
    busy: jobs.data?.items.find((j) => isActive(j.state)),
    computer: demo ? "the demo engine's computer" : "your engine's computer",
    Computer: demo ? "The demo engine's computer" : "Your engine's computer",
    /** The run's page, once its job has started. */
    open: (name: string) => void navigate(to(`/solve/${encodeURIComponent(name)}`)),
  };
}
type SolveStart = ReturnType<typeof useSolveStart>;

function ToField({ id, typed, onChange, problem, hint }: {
  id: string; typed: string; onChange: (typed: string) => void; problem: string | null; hint: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={`${id}-to`} className="text-sm font-medium">Solve to iteration</label>
      <Input
        id={`${id}-to`}
        value={typed}
        onChange={(e) => onChange(e.target.value.trim())}
        inputMode="numeric"
        aria-invalid={problem ? true : undefined}
        aria-describedby={`${id}-to-hint`}
        autoComplete="off"
        className={cn("max-w-40 tabular-nums", problem && "border-danger")}
      />
      <p id={`${id}-to-hint`} className={cn("text-xs", problem ? "text-danger" : "text-muted-foreground")}>
        {problem ?? hint}
      </p>
    </div>
  );
}

function ProcsField({ id, np, onPick, s }: { id: string; np: number; onPick: (np: number) => void; s: SolveStart }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={`${id}-np`} className="text-sm font-medium">Processes</label>
      <select id={`${id}-np`} className={cn(FIELD, "max-w-40")} value={np}
        onChange={(e) => onPick(Number(e.target.value))} aria-describedby={`${id}-np-hint`}>
        {procChoices(s.cores).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <p id={`${id}-np-hint`} className="text-xs text-muted-foreground">
        {np === 1
          ? "One process solves the case as it is, unsplit."
          : `The case is split into ${np} parts (decomposePar), each solved by a process of its own (mpirun).`}
        {" "}A continuation keeps the same.{s.cores ? ` ${s.Computer} has ${s.cores} cores.` : ""}
      </p>
    </div>
  );
}

/** Whether the solve (or, for a case it makes from a template, its mesh: `step` snappy) fits in the memory of the
 * engine's computer, and the big job it runs now, if any. */
function Notes({ s, cells, what, step = "solver" }: {
  s: SolveStart; cells: number | null; what: string; step?: "solver" | "snappy";
}) {
  const memory = stepMemory(step, cells, s.machine.data);
  const { busy, computer, Computer } = s;
  const needs = step === "snappy" ? "Its mesh, more than its solve, needs" : "The solve needs";
  return (
    <div className="space-y-2">
      {memory ? (
        memory.fits ? (
          <Note tone="ok">
            {needs} about <GB value={memory.need} /> of memory; {computer} has <GB value={memory.have} />
            {memory.limited ? " (its RAM limit)" : ""}.
          </Note>
        ) : (
          <Note tone="warn">
            {needs} about <GB value={memory.need} /> of memory, more than {computer} can give it: a job may
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
      {busy && !s.demo && (
        <Note tone="warn">
          {JOB_KIND_LABEL[busy.kind] ?? busy.kind} {busy.name} is {busy.state === "queued" ? "waiting to start" : "running"}.
          The engine runs one big job at a time, to keep memory safe: {what} when it has finished.
        </Note>
      )}
    </div>
  );
}

/** In the demo, in place of starting the job: the command that does the same in a terminal. */
function DemoCommand({ verb, command }: { verb: string; command: string }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2/50 p-3">
      <p className="text-[13px]">
        The demo can&apos;t start jobs. With your own engine paired, {verb} runs this on your computer; in a WSL or
        Linux terminal, this command does the same:
      </p>
      <CopyCommand command={command} />
    </div>
  );
}

function Actions({ s, ready, children }: { s: SolveStart; ready: boolean; children: ReactNode }) {
  return (
    <DialogActions>
      {s.demo ? (
        <DialogClose asChild>
          <Button variant="secondary">Close</Button>
        </DialogClose>
      ) : (
        <>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button type="submit" disabled={!ready}>{children}</Button>
        </>
      )}
    </DialogActions>
  );
}

function SolveForm({ target, onDone }: { target: SolveTarget; onDone: () => void }) {
  const s = useSolveStart();
  const id = useId();
  const { name } = target;
  const written = target.run?.written ?? 0;
  const first = written === 0;
  const [typed, setTyped] = useState(() => String(target.to != null && target.to > written ? target.to : suggestedTo(written)));
  const problem = toProblem(typed, written);
  const [picked, setPicked] = useState<number | null>(null);
  const np = picked ?? suggestedProcs(s.cores);
  const ready = !s.demo && !problem && !s.busy && !s.start.isPending;
  const procs = target.run?.nProcs;

  const submit = () => {
    if (!ready) return;
    s.start.mutate(
      { kind: "solve", params: { name, to: Number(typed), ...(first ? { np } : {}) } },
      { onSuccess: () => { onDone(); s.open(name); } },
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
        <ToField id={id} typed={typed} onChange={setTyped} problem={problem}
          hint={first
            ? "Where the solve ends. Stop ends it sooner, and Continue goes on from where it ended."
            : `Past ${formatInt(written)}, the latest iteration written.`} />
        {first && <ProcsField id={id} np={np} onPick={setPicked} s={s} />}
        <Notes s={s} cells={s.cases.data?.cells?.[name] ?? null} what="solve this case" />
        {s.demo && !problem && (
          <DemoCommand verb={first ? "Solve" : "Continue"} command={solveCommand(name, Number(typed), first ? np : null)} />
        )}
      </div>

      {s.start.isError && <ErrorPanel compact className="mt-4" error={s.start.error} />}

      <Actions s={s} ready={ready}>
        {first ? <Play aria-hidden /> : <FastForward aria-hidden />}
        {s.start.isPending ? "Starting…" : first ? "Solve" : "Continue"}
      </Actions>
    </form>
  );
}

function VerifyForm({ onDone }: { onDone: (name: string) => void }) {
  const s = useSolveStart();
  const runs = useRuns(false);
  const id = useId();
  const taken = useMemo(() => verifyTaken(s.cases.data?.items, runs.data?.items, s.jobs.data?.items),
    [s.cases.data, runs.data, s.jobs.data]);
  const [typedName, setTypedName] = useState<string | null>(null);      // null: the free name suggested
  const name = typedName ?? verifyName(taken);
  const nameProblem = verifyNameProblem(name, taken);
  const [picked, setPicked] = useState<number | null>(null);
  const np = picked ?? verifyProcs(s.cores);
  const ready = !s.demo && !nameProblem && !s.busy && !s.start.isPending;

  const submit = () => {
    if (!ready) return;
    s.start.mutate(
      { kind: "solve", params: { name, template: VERIFY.template, size: VERIFY.size, to: VERIFY.to, np } },
      { onSuccess: () => onDone(name) },
    );
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <DialogTitle>Verify install</DialogTitle>
      <DialogDescription>
        The engine makes the coarse Ahmed body from its template (about {formatInt(VERIFY_CELLS)} cells), then solves
        it to iteration {formatInt(VERIFY.to)}, as the accuracy check&apos;s run of that mesh was: about 15 minutes on
        6 processes. Its drag is then compared with that run&apos;s and the wind tunnel&apos;s, on this screen.
      </DialogDescription>

      <div className="mt-5 space-y-5">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">Name</label>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(e) => setTypedName(e.target.value.trim())}
            aria-invalid={nameProblem ? true : undefined}
            aria-describedby={`${id}-name-hint`}
            autoComplete="off"
            spellCheck={false}
            className={cn("font-mono", nameProblem && "border-danger")}
          />
          <p id={`${id}-name-hint`} className={cn("text-xs", nameProblem ? "text-danger" : "text-muted-foreground")}>
            {nameProblem ?? "A new case in the cases folder: the job makes it there, then solves it."}
          </p>
        </div>
        <ProcsField id={id} np={np} onPick={setPicked} s={s} />
        <Notes s={s} cells={VERIFY_CELLS} what="verify the install" step="snappy" />
        {s.demo && !nameProblem && <DemoCommand verb="Verify install" command={verifyCommand(name, np)} />}
      </div>

      {s.start.isError && <ErrorPanel compact className="mt-4" error={s.start.error} />}

      <Actions s={s} ready={ready}>
        <ShieldCheck aria-hidden />
        {s.start.isPending ? "Starting…" : "Verify install"}
      </Actions>
    </form>
  );
}

function CopyForm({ source: asked, onDone }: { source?: string; onDone: () => void }) {
  const s = useSolveStart();
  const id = useId();
  const yours = useMemo(() => yourCases(s.cases.data), [s.cases.data]);
  const [picked, setPicked] = useState<string | null>(asked ?? null);
  const source = picked ?? yours[0] ?? null;
  const taken = useMemo(() => copyTaken(s.cases.data?.items, s.jobs.data?.items), [s.cases.data, s.jobs.data]);
  const [typedName, setTypedName] = useState<string | null>(null);      // null: the name suggested for the case
  const name = typedName ?? (source ? copyName(source, taken) : "");
  const nameProblem = copyNameProblem(name, taken);
  const [typed, setTyped] = useState(() => String(FIRST_TO));
  const problem = toProblem(typed, 0);
  const [picks, setPicks] = useState<number | null>(null);
  const np = picks ?? suggestedProcs(s.cores);
  const cells = source != null ? s.cases.data?.cells?.[source] ?? null : null;
  const ready = !s.demo && source != null && !nameProblem && !problem && !s.busy && !s.start.isPending;

  const submit = () => {
    if (!ready || source == null) return;
    s.start.mutate(
      { kind: "solve", params: { name, source, to: Number(typed), np } },
      { onSuccess: () => { onDone(); s.open(name); } },
    );
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <DialogTitle>Solve a copy of a case you made</DialogTitle>
      <DialogDescription>
        Mesh Doctor never changes a case you made. The engine copies its mesh and settings, not its results, into a new
        case in its cases folder, then solves the copy as Solve does: split over the processes you pick, started with
        potentialFoam, then foamRun to the iteration you give. A later solve continues the copy.
      </DialogDescription>

      <div className="mt-5 space-y-5">
        {s.cases.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">Asking the engine for its cases…</p>
        ) : s.cases.isError ? (
          <ErrorPanel compact error={s.cases.error} onRetry={() => void s.cases.refetch()} retrying={s.cases.isFetching} />
        ) : source == null ? (
          <Note tone="info">
            {s.demo ? "The demo engine's" : "Your engine's"} cases folder has no case of yours with a mesh. Put one
            there, and it shows here.
          </Note>
        ) : (
          <>
            <div className="space-y-1.5">
              <label htmlFor={`${id}-case`} className="text-sm font-medium">Case</label>
              <select id={`${id}-case`} className={FIELD} value={source} onChange={(e) => setPicked(e.target.value)}
                aria-describedby={`${id}-case-hint`}>
                {yours.map((n) => {
                  const size = s.cases.data?.cells?.[n];
                  return <option key={n} value={n}>{size ? `${n} (about ${formatInt(size)} cells)` : n}</option>;
                })}
              </select>
              <p id={`${id}-case-hint`} className="text-xs text-muted-foreground">
                One of yours in the engine&apos;s cases folder. A copy needs its mesh joined (not only split onto
                processors), its initial fields (a 0 or 0.orig folder) and a steady foamRun setup.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`${id}-name`} className="text-sm font-medium">Name of the copy</label>
              <Input
                id={`${id}-name`}
                value={name}
                onChange={(e) => setTypedName(e.target.value.trim())}
                aria-invalid={nameProblem ? true : undefined}
                aria-describedby={`${id}-name-hint`}
                autoComplete="off"
                spellCheck={false}
                className={cn("font-mono", nameProblem && "border-danger")}
              />
              <p id={`${id}-name-hint`} className={cn("text-xs", nameProblem ? "text-danger" : "text-muted-foreground")}>
                {nameProblem ?? "A new case in the cases folder: the copy is solved there, and later continued."}
              </p>
            </div>

            <ToField id={id} typed={typed} onChange={setTyped} problem={problem}
              hint="Where the solve ends. Stop ends it sooner, and Continue goes on from where it ended." />
            <ProcsField id={id} np={np} onPick={setPicks} s={s} />
            <Notes s={s} cells={cells} what="solve the copy" />
            {s.demo && !problem && !nameProblem && (
              <DemoCommand verb="Solve a copy" command={solveCommand(name, Number(typed), np, source)} />
            )}
          </>
        )}
      </div>

      {s.start.isError && <ErrorPanel compact className="mt-4" error={s.start.error} />}

      <Actions s={s} ready={ready}>
        <CopyPlus aria-hidden />
        {s.start.isPending ? "Starting…" : "Solve a copy"}
      </Actions>
    </form>
  );
}
