// SPDX-License-Identifier: GPL-3.0-or-later
// The Solve screen: OpenFOAM cases set up and run on the computer the engine runs on. It opens with Ready to solve?,
// the engine's self check (GET /check, API 1.4: what `meshdoctor check` prints, as JSON): each check with what it
// found, and a warning's or a problem's fix with its command to copy, then the largest mesh the free memory takes.
// Then New case: a case made from a template (API 1.5, NewCase.tsx), and Runs: each case Mesh Doctor made with its
// solve (API 1.6: GET /runs), what it is doing and how far it has come, a link to its page (Run.tsx) and Solve… for
// one not solved yet (SolveDialog.tsx), and Solve a case you made…, which solves a copy of one of yours (CopyDialog).
// A transient run of a solved run (started from that run's page) is listed as one, in seconds.
// Verify install, under Ready to solve?, solves the coarse Ahmed body as the accuracy check did and compares its drag
// (VerifyInstall.tsx). What the screen does next is listed under them until then.
import { CircleCheck, CircleX, CopyPlus, ExternalLink, FolderPlus, Play, RefreshCw, TriangleAlert } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { RunStateBadge } from "@/components/shared/badges";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { InlineCode, TextWithCode } from "@/components/shared/InlineCode";
import { PageHeader } from "@/components/shared/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, CardTitleRow } from "@/components/ui/card";
import { Progress, Skeleton } from "@/components/ui/misc";
import { useAppPath, useEngine } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { useCases, useJobs, useReadiness, useRuns } from "@/engine/hooks";
import { isActive, type Readiness, type ReadinessCheck } from "@/engine/types";
import { formatCount, formatDateTime, formatInt, formatRelative } from "@/lib/format";
import { DOCS } from "@/lib/site";
import { useTitle } from "@/lib/useTitle";
import { cn } from "@/lib/utils";
import { NewCaseDialog } from "./NewCase";
import { CopyDialog, SolveDialog } from "./SolveDialog";
import { CHECK_COMMAND, OLD_ENGINE, cellsAtMost, sentence } from "./readiness";
import {
  OLD_ENGINE_RUNS, atText, current, isTransient, madeFrom, ofText, runRows, solveStep, stretchFraction, type RunRow,
} from "./solveStart";
import { VerifyInstall } from "./VerifyInstall";

const STATE = {
  ok: { icon: CircleCheck, colour: "text-success", said: "OK" },
  warn: { icon: TriangleAlert, colour: "text-warning", said: "Warning" },
  fail: { icon: CircleX, colour: "text-danger", said: "Problem" },
} as const;

/** The checks' groups, in the engine's order; programs go under OpenFOAM, whose environment finds them. */
const SECTIONS: { title: string; groups: ReadinessCheck["group"][] }[] = [
  { title: "Python", groups: ["python"] },
  { title: "Folders", groups: ["folders"] },
  { title: "OpenFOAM", groups: ["openfoam", "programs"] },
  { title: "Memory", groups: ["memory"] },
];

function StateIcon({ state }: { state: ReadinessCheck["state"] }) {
  const s = STATE[state];
  return (
    <>
      <s.icon className={cn("mt-0.5 size-4 shrink-0", s.colour)} aria-hidden />
      <span className="sr-only">{s.said}: </span>
    </>
  );
}

/** One line of the list: its state, its name, and what was found, with anything more under that. */
function Row({ state, label, children }: { state: ReadinessCheck["state"]; label: ReactNode; children: ReactNode }) {
  return (
    <li className="flex gap-3 py-2.5">
      <StateIcon state={state} />
      <div className="min-w-0 flex-1 text-sm sm:flex sm:gap-4">
        <div className="font-medium text-foreground sm:w-36 sm:shrink-0">{label}</div>
        <div className="min-w-0 flex-1 text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

/** A check, and for a warning or a problem its fix and the command for it. */
function CheckRow({ check }: { check: ReadinessCheck }) {
  return (
    <Row state={check.state} label={check.label}>
      <p className={cn(check.state !== "ok" && "text-foreground")}>{check.found}</p>
      {check.fix && <p className="mt-1"><TextWithCode text={sentence(check.fix)} /></p>}
      {check.command && <CopyCommand command={check.command} className="mt-2 max-w-md" />}
    </Row>
  );
}

/** The programs: each one missing on its own line with its fix, the ones found together on one. */
function Programs({ checks }: { checks: ReadinessCheck[] }) {
  const ok = checks.filter((c) => c.state === "ok");
  const not = checks.filter((c) => c.state !== "ok");
  return (
    <>
      {not.map((c) => <CheckRow key={c.id} check={c} />)}
      {ok.length > 0 && (
        <Row state="ok" label="Programs">
          <p>{ok.length === checks.length ? `All ${checks.length} found` : `${ok.length} of ${checks.length} found`}</p>
          <p className="mt-1 font-mono text-[12px] wrap-anywhere">{ok.map((c) => c.label).join(" · ")}</p>
        </Row>
      )}
    </>
  );
}

/** The memory, and the largest mesh a repair or a solve can take in it, by the engine's own RAM guard. */
function MemoryRow({ check, memory }: { check: ReadinessCheck; memory: Readiness["memory"] }) {
  const to = useAppPath();
  const { repair, solve } = memory.cells;
  const limited = memory.limitMb != null && memory.availableMb === memory.limitMb;
  return (
    <Row state={check.state} label={check.label}>
      <p className={cn(check.state !== "ok" && "text-foreground")}>
        {check.found}
        {limited && <> (the engine&apos;s RAM limit, <InlineCode text="ram_limit_mb" />)</>}
      </p>
      {check.fix && <p className="mt-1"><TextWithCode text={sentence(check.fix)} /></p>}
      {repair != null && solve != null && (
        <p className="mt-1">
          Enough to repair a mesh of up to about {cellsAtMost(repair)} cells, or to solve one of up to about{" "}
          {cellsAtMost(solve)}, by the engine&apos;s RAM guard, which stops a job that wouldn&apos;t fit. How long a
          solve takes: the{" "}
          <Link to={to("/estimate")} className="font-medium text-primary hover:underline">size estimator</Link>.
        </p>
      )}
    </Row>
  );
}

function Verdict({ doc }: { doc: Readiness }) {
  const problems = doc.checks.filter((c) => c.state === "fail").length;
  const warnings = doc.checks.filter((c) => c.state === "warn").length;
  if (!doc.ready) {
    return <Badge tone="danger"><CircleX aria-hidden /> {formatCount(problems || 1, "problem")} to fix</Badge>;
  }
  if (warnings) return <Badge tone="warning"><TriangleAlert aria-hidden /> Ready, {formatCount(warnings, "warning")}</Badge>;
  return <Badge tone="success"><CircleCheck aria-hidden /> Ready</Badge>;
}

function Checks({ doc }: { doc: Readiness }) {
  const memory = doc.checks.find((c) => c.group === "memory");
  return (
    <div className="space-y-4">
      {SECTIONS.map((s) => {
        const checks = doc.checks.filter((c) => s.groups.includes(c.group));
        if (checks.length === 0) return null;
        const programs = checks.filter((c) => c.group === "programs");
        const foamMissing = s.title === "OpenFOAM" && programs.length === 0;
        return (
          <section key={s.title} aria-label={s.title}>
            <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{s.title}</h3>
            <ul className="divide-y divide-border">
              {checks.filter((c) => c.group !== "programs" && c.group !== "memory").map((c) => <CheckRow key={c.id} check={c} />)}
              {programs.length > 0 && <Programs checks={programs} />}
              {s.title === "Memory" && memory && <MemoryRow check={memory} memory={doc.memory} />}
            </ul>
            {foamMissing && (
              <p className="mt-1 text-[13px] text-muted-foreground">
                The programs a repair, an A/B test and a solve run are checked once OpenFOAM is found.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ReadinessCard() {
  const { mode } = useEngine();
  const readiness = useReadiness();
  const doc = readiness.data;
  const old = readiness.isError && !doc && asEngineError(readiness.error).code === "not-found";
  const whose = mode === "demo" ? "the demo engine's computer" : "the engine's computer";
  return (
    <Card>
      <CardHeader className="block">
        <CardTitleRow>
          <CardTitle>Ready to solve?</CardTitle>
          {doc ? <Verdict doc={doc} /> : old ? <Badge>Not checked</Badge> : readiness.isPending ? <Skeleton className="h-5 w-16" /> : null}
        </CardTitleRow>
        <CardDescription>
          What {whose} has: Python, its folders, OpenFOAM 14 and the programs a repair, an A/B test and a solve run, and
          the memory that&apos;s free. A warning doesn&apos;t stop a job; a problem does, until it&apos;s fixed.
          {doc && <> Checked {formatDateTime(doc.checked)}.</>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {doc ? (
          <Checks doc={doc} />
        ) : old ? (
          <div className="text-sm text-muted-foreground">
            <p>
              <TextWithCode text={OLD_ENGINE} />
            </p>
            <CopyCommand command={CHECK_COMMAND} className="mt-3 max-w-sm" />
          </div>
        ) : readiness.isError ? (
          <ErrorPanel compact error={readiness.error} onRetry={() => void readiness.refetch()} retrying={readiness.isFetching} />
        ) : (
          <div className="space-y-3" aria-busy>
            <p role="status" className="text-sm text-muted-foreground">Checking the engine&apos;s computer…</p>
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className={cn("h-4", i % 2 ? "w-56" : "w-72")} />)}
          </div>
        )}
      </CardContent>
      {doc && (
        <CardFooter className="flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => void readiness.refetch()} disabled={readiness.isFetching}>
            <RefreshCw className={cn(readiness.isFetching && "animate-spin")} /> {readiness.isFetching ? "Checking…" : "Check again"}
          </Button>
          <span className="text-muted-foreground">
            It checks again when you come back to this page. In a terminal: <InlineCode text={CHECK_COMMAND} />
          </span>
        </CardFooter>
      )}
    </Card>
  );
}

/** A case to try things on, made from a template: the button that opens the New case dialog. The tour's Solve step
 * rings it. */
function NewCase() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="mt-6" data-tour="new-case">
      <CardHeader className="block">
        <CardTitle>New case</CardTitle>
        <CardDescription>
          A ready-made case from a template: the Ahmed body, the standard shape for car aerodynamics, or a wheel and a
          front wing. The engine copies it into its cases folder and meshes it; it then shows on Cases, where a repair
          and an A/B test take it.
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex-wrap">
        <Button size="sm" onClick={() => setOpen(true)}>
          <FolderPlus aria-hidden /> New case
        </Button>
        <span className="text-muted-foreground">
          In a terminal, <InlineCode text="meshdoctor new" /> lists the templates.
        </span>
      </CardFooter>
      <NewCaseDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}

/** What a run's line says under its name: where it is, or where it ended; a transient run's, in seconds, and what it
 * is a transient run of. */
function runLine(row: RunRow, cells: number | null | undefined): string {
  const { run, shown } = row;
  const now = current(run, shown);
  const from = madeFrom(row.made);
  const made = [from && from.charAt(0).toUpperCase() + from.slice(1), cells != null && `about ${formatInt(cells)} cells`]
    .filter((x): x is string => typeof x === "string").join(", ");
  const transient = isTransient(run) || row.made?.transientOf != null;
  const at = (n: number) => atText(n, transient);
  const when = run?.finished ? `, ${formatRelative(run.finished)}` : "";
  const of = transient && from ? ` (${from})` : "";
  switch (shown) {
    case "unsolved": return made || "Not solved yet";
    case "queued": return "Waiting to start";
    case "running":
      return [solveStep(now?.step) ?? "Starting",
        now?.iteration != null && now.end != null && ofText(now.iteration, now.end, transient)]
        .filter(Boolean).join(" · ") + of;
    case "done": return `Solved to ${at(run?.written ?? 0)}${when}${of}`;
    case "stopped": return `Stopped at ${at(run?.written ?? 0)}${when}${of}`;
    case "cancelled": return `Cancelled${run?.written ? `, written to ${at(run.written)}`
      : ` before it wrote ${transient ? "a time" : "an iteration"}`}${when}`;
    case "failed": return `Stopped with an error${run?.written ? `, written to ${at(run.written)}` : ""}${when}`;
    case "interrupted": return `Its job is gone, written to ${at(run?.written ?? 0)}`;
  }
}

/** One case Mesh Doctor made, with its solve: a link to the run's page once it has one, else Solve…. */
function RunItem({ row, cells, onSolve }: { row: RunRow; cells: number | null | undefined; onSolve: () => void }) {
  const to = useAppPath();
  const page = row.run != null || row.job != null;
  const now = current(row.run, row.shown);
  const fraction = now && row.shown === "running" ? stretchFraction(now) : undefined;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {page ? (
            <Link to={to(`/solve/${encodeURIComponent(row.name)}`)}
              className="font-mono text-[13px] font-medium text-primary underline-offset-4 hover:underline">{row.name}</Link>
          ) : (
            <span className="font-mono text-[13px] font-medium">{row.name}</span>
          )}
          <RunStateBadge state={row.shown} />
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">{runLine(row, cells)}</p>
        {row.shown === "running" && (
          <Progress className="mt-2 max-w-xs" value={fraction} label={`Progress of the solve of ${row.name}`} />
        )}
      </div>
      {row.shown === "unsolved" && (
        <Button size="sm" variant="secondary" onClick={onSolve} aria-label={`Solve ${row.name}`}>
          <Play aria-hidden /> Solve…
        </Button>
      )}
    </li>
  );
}

/** The cases Mesh Doctor made, each with its solve (API 1.6): the ones made with New case, and the copies it solves
 * of cases you made, which it never changes (Solve a case you made…). */
function Runs() {
  const jobs = useJobs();
  const cases = useCases();
  const active = jobs.data?.items.some((j) => j.kind === "solve" && isActive(j.state)) ?? false;
  const runs = useRuns(active);
  const [solving, setSolving] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const to = useAppPath();
  const old = runs.isError && !runs.data && asEngineError(runs.error).code === "not-found";
  const rows = useMemo(() => runRows(cases.data?.made, runs.data?.items, jobs.data?.items), [cases.data, runs.data, jobs.data]);
  const loading = runs.isPending || cases.isPending;
  return (
    <Card className="mt-6">
      <CardHeader className="block">
        <CardTitle>Runs</CardTitle>
        <CardDescription>
          The solves of the cases Mesh Doctor made, on the engine&apos;s computer: the ones made with New case, and
          copies of cases you made. A run&apos;s page draws its residuals and forces as it solves and says whether it
          has converged; Stop ends it where it has reached, and Continue goes on from there. A solved run&apos;s page
          plans a transient run of it, and starts one: it is listed here too, in seconds.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {old ? (
          <p className="text-sm text-muted-foreground"><TextWithCode text={OLD_ENGINE_RUNS} /></p>
        ) : runs.isError ? (
          <ErrorPanel compact error={runs.error} onRetry={() => void runs.refetch()} retrying={runs.isFetching} />
        ) : loading ? (
          <div className="space-y-3" aria-busy>
            <p role="status" className="text-sm text-muted-foreground">Asking the engine for its runs…</p>
            <Skeleton className="h-4 w-64" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to solve here yet: make a case with New case above, or solve a copy of a case you made. New
            here? <Link to={to("/first-run")} className="font-medium text-primary underline-offset-4 hover:underline">
            Try it on the Ahmed body</Link>, step by step.
          </p>
        ) : (
          <ul className="-my-3 divide-y divide-border" aria-label="Runs">
            {rows.map((r) => (
              <RunItem key={r.name} row={r} cells={cases.data?.cells?.[r.name]} onSolve={() => setSolving(r.name)} />
            ))}
          </ul>
        )}
        {cases.isError && !old && (
          <ErrorPanel compact className="mt-3" error={cases.error} onRetry={() => void cases.refetch()} retrying={cases.isFetching} />
        )}
      </CardContent>
      <CardFooter className="flex-wrap">
        <Button size="sm" variant="secondary" onClick={() => setCopying(true)} disabled={old}>
          <CopyPlus aria-hidden /> Solve a case you made…
        </Button>
        <span className="text-muted-foreground">
          Mesh Doctor never changes it: it solves a copy. In a terminal, <InlineCode text="meshdoctor solve <case>" />{" "}
          solves a case made here, and <InlineCode text="meshdoctor solve <your-case> <name>" /> a copy of yours.
        </span>
      </CardFooter>
      {solving && (
        <SolveDialog open onOpenChange={(o) => { if (!o) setSolving(null); }}
          target={{ name: solving, run: null, transientOf: cases.data?.made?.[solving]?.transientOf }} />
      )}
      {copying && <CopyDialog open onOpenChange={(o) => { if (!o) setCopying(false); }} />}
    </Card>
  );
}

/** What this screen does next, until it does. */
function ComingNext() {
  const to = useAppPath();
  return (
    <Card className="mt-6">
      <CardHeader className="block">
        <CardTitle>Coming next on this screen</CardTitle>
        <CardDescription>
          A first run from start to finish is on{" "}
          <Link to={to("/first-run")} className="font-medium text-primary underline-offset-4 hover:underline">
            Try it on the Ahmed body</Link>, each step started here; in a terminal, the worked example shows the same:{" "}
          <a href={DOCS.example} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            the Ahmed body <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            A transient run&apos;s averaged flow (its mean and how much it swings) for pictures and results. A solved
            run&apos;s page plans and starts one already, with the cells that set its time step (where they are, by
            which wall, how fast the flow is there, and a cell set of them), and its page follows it in seconds: its
            time step and Courant number, and its forces averaged from when they settled.
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

export function Solve() {
  useTitle("Solve");
  return (
    <>
      <PageHeader
        title="Solve"
        description="Set up and run OpenFOAM cases on the computer the engine runs on. First, whether it has everything a solve needs."
      />
      <ReadinessCard />
      <VerifyInstall />
      <NewCase />
      <Runs />
      <ComingNext />
    </>
  );
}
