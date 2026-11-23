// SPDX-License-Identifier: GPL-3.0-or-later
// Starting an A/B test from the app, and running one longer. A test solves a finished repair's case twice on
// copies, on the original mesh and on the repaired one, or on the original mesh with other solver settings
// (GET /variants); the dialog says what runs and about how long it takes (the size estimator's time model), then
// POST /jobs, and the test's own page follows it. Running longer continues its second run to a later iteration. The
// demo can't start jobs: it says so and gives the command that does the same in a terminal.
import { FastForward, FlaskConical } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { Button } from "@/components/ui/button";
import { DialogActions, DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/misc";
import { abCommand, abExtendCommand } from "@/engine/commands";
import { useAppPath, useEngine } from "@/engine/context";
import {
  IDLE_POLL_MS, useAbtests, useCases, useJobs, useMachine, useRepairs, useStartJob, useVariants,
} from "@/engine/hooks";
import { JOB_KIND_LABEL, isActive, type Job } from "@/engine/types";
import { caseName } from "@/engine/verdict";
import { duration } from "@/estimate/estimate";
import { formatCount, formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  AB_EXTEND_MAX, AB_INITS, AB_ITERS, abRanks, abTestName, extendTarget, itersProblem, runSeconds, targetProblem,
  testableRuns, wholeNumber, type AbInit,
} from "./abStart";
import { FIELD, GB, JobDialog, Note } from "./dialogParts";
import { caseCells, stepMemory } from "./repairStart";

/** The line that says a big job is under way, so this one waits: the engine runs one at a time. */
function BusyNote({ job }: { job: Job }) {
  return (
    <Note tone="warn">
      {JOB_KIND_LABEL[job.kind] ?? job.kind} {job.name} is {job.state === "queued" ? "waiting to start" : "running"}. The
      engine runs one big job at a time, to keep memory safe: start this one when it has finished.
    </Note>
  );
}

/** What the demo says in place of Start, with the command that does the same in a terminal. */
function DemoNote({ command, start }: { command: string | null; start: string }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2/50 p-3">
      <p className="text-[13px]">
        The demo can&apos;t start jobs. With your own engine paired, {start} runs this on your computer
        {command ? "; in a WSL or Linux terminal, this command does the same:" : "."}
      </p>
      {command && <CopyCommand command={command} />}
    </div>
  );
}

/**
 * The A/B test dialog, for repair run `run` or, without one, a list of the finished runs (the first with no test
 * yet picked). It is made afresh each time it opens.
 */
export function StartAbTestDialog({ open, onOpenChange, run = null }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run?: string | null;
}) {
  return (
    <JobDialog open={open} onOpenChange={onOpenChange}>
      <StartAbTestForm run={run} onDone={() => onOpenChange(false)} />
    </JobDialog>
  );
}

function StartAbTestForm({ run, onDone }: { run: string | null; onDone: () => void }) {
  const { mode } = useEngine();
  const to = useAppPath();
  const navigate = useNavigate();
  const repairs = useRepairs();
  const cases = useCases();
  const jobs = useJobs();
  const machine = useMachine();
  const variants = useVariants();
  const tests = useAbtests(IDLE_POLL_MS);
  const start = useStartJob();
  const id = useId();

  const runs = useMemo(() => testableRuns(repairs.data?.items), [repairs.data]);
  const existing = useMemo(() => new Set(tests.data?.items ?? []), [tests.data]);
  const [picked, setPicked] = useState<string | null>(run);
  // The run asked for, else the first with no A/B test yet, else the first.
  const chosen = picked != null ? runs.find((r) => r.name === picked) ?? null
    : runs.find((r) => !existing.has(r.name)) ?? runs[0] ?? null;
  const [variant, setVariant] = useState("");
  const [itersText, setItersText] = useState(String(AB_ITERS.initial));
  const [init, setInit] = useState<AbInit>("auto");
  const [replace, setReplace] = useState(false);

  const source = caseName(chosen?.source);
  const cells = source ? caseCells(source, cases.data?.cells, repairs.data?.items) ?? chosen?.nCells ?? null : null;
  const iters = wholeNumber(itersText);
  const problem = itersProblem(itersText);
  const preset = variants.data?.items.find((v) => v.name === variant);
  const name = chosen ? abTestName(chosen, variant) : "";
  const taken = existing.has(name);
  const seconds = !problem && iters != null ? runSeconds(cells, iters, machine.data) : null;
  const ranks = abRanks(machine.data);
  const memory = stepMemory("solver", cells, machine.data);
  const busy = jobs.data?.items.find((j) => isActive(j.state));
  const demo = mode === "demo";
  const computer = demo ? "the demo engine's computer" : "your engine's computer";
  const Computer = demo ? "The demo engine's computer" : "Your engine's computer";
  const ready = !demo && !!chosen && !problem && (!taken || replace) && !busy && !start.isPending;

  const submit = () => {
    if (!ready || !chosen || iters == null) return;
    start.mutate({ kind: "abtest", params: { name: chosen.name, iters, init, variant, replace: taken && replace } }, {
      onSuccess: (job) => {
        onDone();
        void navigate(to(`/abtests/${encodeURIComponent(job.name)}`));
      },
    });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <DialogTitle>{run ? `Start an A/B test of ${run}` : "Start an A/B test"}</DialogTitle>
      <DialogDescription>
        The engine solves a repaired case twice with the same settings, on copies: on the original mesh and on the
        repaired one, to see whether the repair helps the solver. The case itself is never changed.
      </DialogDescription>

      {repairs.isError ? (
        <ErrorPanel compact className="mt-4" error={repairs.error} onRetry={() => repairs.refetch()} retrying={repairs.isFetching} />
      ) : repairs.isPending ? (
        <p role="status" className="mt-5 text-sm text-muted-foreground">Asking the engine for its repair runs…</p>
      ) : !chosen ? (
        <div className="mt-5">
          <Note tone="info">
            {run
              ? `${run} can't be tested from here: the engine has no finished repair of that name with a source case it finds by its folder's name.`
              : "There is no finished repair to test yet: an A/B test compares a repaired mesh with its original, so repair a case first."}
          </Note>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {!run && (
            <div className="space-y-1.5">
              <label htmlFor={`${id}-run`} className="text-sm font-medium">Repair run</label>
              <select id={`${id}-run`} className={FIELD} value={chosen.name} onChange={(e) => setPicked(e.target.value)}>
                {runs.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">
                {[`case ${source}`, cells != null && `${formatInt(cells)} cells`,
                  existing.has(chosen.name) && "it has an A/B test already"].filter(Boolean).join(" · ")}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor={`${id}-variant`} className="text-sm font-medium">Second run</label>
            <select id={`${id}-variant`} className={FIELD} value={variant} onChange={(e) => setVariant(e.target.value)}
              aria-describedby={`${id}-variant-hint`}>
              <option value="">Repaired mesh, the case&apos;s own settings</option>
              {variants.data?.items.map((v) => <option key={v.name} value={v.name}>Original mesh, {v.label}</option>)}
            </select>
            <p id={`${id}-variant-hint`} className="text-xs text-muted-foreground">
              {variant
                ? `Tests the solver settings, not the repair: both runs solve the original mesh, the second with these settings. The test is called ${name}.`
                : variants.isError
                  ? "Tests the repair: only the mesh differs. The engine didn't say which other solver settings it has."
                  : "Tests the repair: both runs use the case's own settings, so only the mesh differs."}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={`${id}-iters`} className="text-sm font-medium">Iterations</label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${id}-iters`}
                  value={itersText}
                  onChange={(e) => setItersText(e.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={`${id}-iters-hint`}
                  className={cn("w-28 tabular-nums", problem && "border-danger")}
                />
                <span className="text-sm text-muted-foreground">each run</span>
              </div>
              <p id={`${id}-iters-hint`} className={cn("text-xs", problem ? "text-danger" : "text-muted-foreground")}>
                {problem ?? `${AB_ITERS.min} to ${formatInt(AB_ITERS.max)}; the runs are compared over their last quarter.`}
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${id}-init`} className="text-sm font-medium">Both runs start from</label>
              <select id={`${id}-init`} className={FIELD} value={init} onChange={(e) => setInit(e.target.value as AbInit)}
                aria-describedby={`${id}-init-hint`}>
                {AB_INITS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p id={`${id}-init-hint`} className="text-xs text-muted-foreground">
                The case&apos;s folder of start fields: auto takes 0.warm when the case has one. The engine refuses a
                folder the case doesn&apos;t have.
              </p>
            </div>
          </div>

          {taken && (
            <div className="space-y-2">
              <Note tone="warn">
                The engine has an A/B test called {name} already. Starting this one replaces it: its results are deleted.
              </Note>
              <label className="flex items-center gap-2 pl-6 text-[13px] font-medium">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)}
                  className="size-4 accent-primary" />
                Replace {name}
              </label>
            </div>
          )}

          <div className="space-y-2">
            <Note tone="info">
              {problem ? "Each run solves the iterations above, on its own copy of the case." : (
                <>
                  {variant
                    ? `Solves the original mesh of ${source} twice, ${formatInt(iters ?? 0)} iterations each: with the case's settings, then with ${preset?.label ?? variant}.`
                    : `Solves ${source} twice, ${formatInt(iters ?? 0)} iterations each: on the original mesh, then on the repaired mesh of ${chosen.name}.`}{" "}
                  {seconds != null
                    ? `About ${duration(2 * seconds)} in all on ${formatCount(ranks, "solver rank")}${variant ? ", or half that when an earlier test solved the first run with the same iterations and start" : ""}.`
                    : "How long isn't known here: the case's size isn't."}
                </>
              )}
            </Note>
            {memory ? (
              memory.fits ? (
                <Note tone="ok">
                  Needs about <GB value={memory.need} /> of memory; {computer} has <GB value={memory.have} />
                  {memory.limited ? " (its RAM limit)" : ""}.
                </Note>
              ) : (
                <Note tone="warn">
                  Needs about <GB value={memory.need} /> of memory, more than {computer} can give it: a job may use
                  90&nbsp;% of its <GB value={memory.have} />{memory.limited ? " (its RAM limit)" : ""}. The engine
                  refuses a test that won&apos;t fit in its free memory.
                </Note>
              )
            ) : (
              <Note tone="info">
                {cells == null ? "The case's size isn't known" : `${Computer} doesn't say how much memory it has`},
                so the memory isn&apos;t checked here; the engine checks it when the test starts.
              </Note>
            )}
            {busy && !demo && <BusyNote job={busy} />}
          </div>

          {demo && !problem && (
            <DemoNote start="Start A/B test" command={abCommand(source, chosen.name, { iters: iters ?? undefined, init, variant })} />
          )}
        </div>
      )}

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
              <FlaskConical aria-hidden />
              {start.isPending ? "Starting…" : "Start A/B test"}
            </Button>
          </>
        )}
      </DialogActions>
    </form>
  );
}

/** What the A/B test's page knows of the test it continues. */
export interface ExtendTarget {
  /** the test's name */
  name: string;
  /** the iteration its second run is at now */
  at: number;
  /** each run's iterations in the test */
  iters: number | null;
  /** the source case's folder on the engine's computer */
  source: string | null;
  /** the second run's solver-setting variant, if it has one */
  variant: string | null;
  /** seconds an iteration of the second run took, when measured */
  pace: number | null;
}

/** The dialog that runs an A/B test's second run longer. It is made afresh each time it opens. */
export function ExtendAbTestDialog({ open, onOpenChange, test }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  test: ExtendTarget;
}) {
  return (
    <JobDialog open={open} onOpenChange={onOpenChange}>
      <ExtendAbTestForm test={test} onDone={() => onOpenChange(false)} />
    </JobDialog>
  );
}

function ExtendAbTestForm({ test, onDone }: { test: ExtendTarget; onDone: () => void }) {
  const { mode } = useEngine();
  const cases = useCases();
  const repairs = useRepairs();
  const jobs = useJobs();
  const machine = useMachine();
  const start = useStartJob();
  const id = useId();

  const at = Math.floor(test.at);
  const [targetText, setTargetText] = useState(String(extendTarget(at, test.iters)));
  const target = wholeNumber(targetText);
  const atEnd = at >= AB_EXTEND_MAX;
  const problem = atEnd ? null : targetProblem(targetText, at);
  const source = caseName(test.source);
  const cells = source ? caseCells(source, cases.data?.cells, repairs.data?.items) : null;
  const more = !problem && target != null ? target - at : null;
  const seconds = more != null ? runSeconds(cells, more, machine.data, test.pace) : null;
  const busy = jobs.data?.items.find((j) => isActive(j.state));
  const demo = mode === "demo";
  const ready = !demo && !atEnd && !problem && !busy && !start.isPending;
  const which = test.variant ? `the original mesh with ${test.variant} settings` : "the repaired mesh";

  const submit = () => {
    if (!ready || target == null) return;
    start.mutate({ kind: "abextend", params: { name: test.name, to: target } }, { onSuccess: () => onDone() });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <DialogTitle>Run {test.name} longer</DialogTitle>
      <DialogDescription>
        The engine continues the test&apos;s second run, on {which}, from where it stopped, and judges it again. The first
        run stays as it is.
      </DialogDescription>

      <div className="mt-5 space-y-5">
        {atEnd ? (
          <Note tone="info">
            The second run is at iteration {formatInt(at)}, the furthest the engine continues a run.
          </Note>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor={`${id}-to`} className="block text-sm font-medium">Continue to iteration</label>
            <Input
              id={`${id}-to`}
              value={targetText}
              onChange={(e) => setTargetText(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={problem ? true : undefined}
              aria-describedby={`${id}-to-hint`}
              className={cn("block w-28 tabular-nums", problem && "border-danger")}
            />
            <p id={`${id}-to-hint`} className={cn("text-xs", problem ? "text-danger" : "text-muted-foreground")}>
              {problem ?? `The second run is at iteration ${formatInt(at)}; the engine goes up to ${formatInt(AB_EXTEND_MAX)}.`}
            </p>
          </div>
        )}

        {!atEnd && (
          <div className="space-y-2">
            {more != null && (
              <Note tone="info">
                Solves {formatInt(more)} more iteration{more === 1 ? "" : "s"} on the second run&apos;s copy
                {seconds != null
                  ? `, about ${duration(seconds)}${test.pace ? ` at the ${test.pace.toFixed(2)} s an iteration it took so far` : ""}.`
                  : ". How long isn't known here: the case's size isn't."}
              </Note>
            )}
            {busy && !demo && <BusyNote job={busy} />}
          </div>
        )}

        {demo && !atEnd && !problem && target != null && (
          <DemoNote start="Continue" command={abExtendCommand(test.name, target)} />
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
              <FastForward aria-hidden />
              {start.isPending ? "Starting…" : "Continue"}
            </Button>
          </>
        )}
      </DialogActions>
    </form>
  );
}
