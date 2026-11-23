// SPDX-License-Identifier: GPL-3.0-or-later
// The Solve screen: OpenFOAM cases set up and run on the computer the engine runs on. It opens with Ready to solve?,
// the engine's self check (GET /check, API 1.4: what `meshdoctor check` prints, as JSON): each check with what it
// found, and a warning's or a problem's fix with its command to copy, then the largest mesh the free memory takes.
// What the screen does next (a new case from a template, its solve with live charts) is listed under it until then.
import { CircleCheck, CircleX, ExternalLink, RefreshCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { InlineCode, TextWithCode } from "@/components/shared/InlineCode";
import { PageHeader } from "@/components/shared/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, CardTitleRow } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { useAppPath, useEngine } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { useReadiness } from "@/engine/hooks";
import type { Readiness, ReadinessCheck } from "@/engine/types";
import { formatCount, formatDateTime } from "@/lib/format";
import { DOCS } from "@/lib/site";
import { useTitle } from "@/lib/useTitle";
import { cn } from "@/lib/utils";
import { CHECK_COMMAND, OLD_ENGINE, cellsAtMost, sentence } from "./readiness";

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

/** What this screen does next, until it does. */
function ComingNext() {
  return (
    <Card className="mt-6">
      <CardHeader className="block">
        <CardTitle>Coming next on this screen</CardTitle>
        <CardDescription>
          Until then, the worked example&apos;s scripts set up and solve a case in a terminal:{" "}
          <a href={DOCS.example} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            the Ahmed body <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>A new case from a template (the Ahmed body, or a wheel and a front wing), meshed in the cases folder.</li>
          <li>Its solve on this computer, with the residuals and forces drawn as it runs, the convergence judge, and Stop and Continue.</li>
          <li>A first run, guided from start to finish: the Ahmed body solved, then a repair and an A/B test of it.</li>
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
      <ComingNext />
    </>
  );
}
