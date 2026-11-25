// SPDX-License-Identifier: GPL-3.0-or-later
// A solved case's results (GET /results/{case}, API 1.23): its total group's drag, downforce or lift, L/D and CdA over
// the averaging window, with how sure each mean is and how far it still drifts; the window, the judge's unless the
// address asks for another (?from=&to=), with the judge's verdict; every force group's forces and coefficients, and
// how far its residuals fell. Plain warnings come first. Its force charts (ForceCharts.tsx, API 1.24) show a group's
// forces over the whole run with the window shaded: dragging its edges, or moving them with the arrow keys, asks for
// another, as From and To do. While another window is being averaged, the last one's numbers stay, dimmed. Compare…
// opens the Compare screen with this case as a, to pick the case to compare it with.
import { ArrowLeft, ArrowLeftRight, ChartLine, Hourglass, RotateCcw, TriangleAlert } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { CamelCaseName, EmptyState, PageHeader, StatTile } from "@/components/shared/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { useAppPath, useEngine } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { useCaseResults } from "@/engine/hooks";
import type { CaseResults, ResultForce, ResultsWindow } from "@/engine/types";
import { formatCells, formatNumber, formatRelative } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import { cn } from "@/lib/utils";
import { comparePagePath } from "./compareView";
import { ForceCharts } from "./ForceCharts";
import { DriftBadge, VerdictBadge } from "./Results";
import {
  chartWindow, driftText, driftWarns, newtons, ordersText, plusMinus, resultsPagePath, spanText, totalGroup,
  verticalWord, windowNumber, windowOf, windowProblem, windowText,
} from "./resultsView";

const LINK = "font-medium text-primary underline-offset-4 hover:underline";

const N = (f: ResultForce | null | undefined) => (f ? `${newtons(f)} N` : "–");
const m2 = (x: number | null | undefined) => (x == null ? "–" : `${formatNumber(x)} m²`);

/** Its plain warnings: a drift over 1 %, a symmetry plane, no q. */
function Warnings({ warnings }: { warnings: string[] }) {
  return (
    <div role="note" className="mb-4 rounded-xl border border-warning/25 bg-warning-soft/60 p-4">
      <div className="flex gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Before you compare it</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** The total group's numbers: its drag and vertical force with how sure each is and its drift, L/D and CdA. */
function Headline({ doc }: { doc: CaseResults }) {
  const g = totalGroup(doc);
  const word = verticalWord(doc);
  const sure = (f: ResultForce | null | undefined) =>
    [plusMinus(f) && `${plusMinus(f)} N`, f?.drift != null && `drift ${driftText(f.drift)}`]
      .filter((x): x is string => typeof x === "string" && x !== "").join(" · ") || undefined;
  const warn = (f: ResultForce | null | undefined) => driftWarns(f, doc);
  return (
    <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile label="Drag" value={N(g?.drag)} hint={sure(g?.drag)}
        tone={warn(g?.drag) ? "warning" : undefined} icon={warn(g?.drag) ? TriangleAlert : undefined} />
      <StatTile label={word} value={N(g?.vertical)} hint={sure(g?.vertical)}
        tone={warn(g?.vertical) ? "warning" : undefined} icon={warn(g?.vertical) ? TriangleAlert : undefined} />
      <StatTile label="L/D" value={formatNumber(g?.LD, 3)} hint={`${word} over drag`} />
      <StatTile label="CdA" value={m2(g?.CdA)}
        hint={g?.Cd != null ? `Cd ${formatNumber(g.Cd)}, over its forceCoeffs's ${m2(g.Aref)}` : "Its drag over q"} />
    </div>
  );
}

/** The window: the one the numbers are over, in words, with the judge's verdict; From and To ask for another (the
 * address keeps it), and The judge's window goes back. */
function WindowCard({ name, doc, w }: { name: string; doc: CaseResults | undefined; w: ResultsWindow }) {
  const id = useId();
  const to = useAppPath();
  const navigate = useNavigate();
  const [from, setFrom] = useState(w.from == null ? "" : String(w.from));
  const [upTo, setUpTo] = useState(w.to == null ? "" : String(w.to));
  const problem = windowProblem(from, upTo);
  const [f, t] = [windowNumber(from), windowNumber(upTo)];
  const crossed = f != null && t != null && f >= t;
  const judges = w.from == null && w.to == null;
  const unit = doc == null ? "" : doc.transient ? " (s)" : " (iteration)";
  const hint = `The forces after From, up to and with To, in ${doc?.transient ? "seconds of flow" : doc ? "iterations"
    : "iterations or a transient run's seconds of flow"}. Leave From empty for the judge's window, and To for the end.`;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (problem) return;
    void navigate(to(resultsPagePath(name, { from: f, to: t })));
  }
  const field = (key: "from" | "to", label: string, value: string, set: (v: string) => void, bad: boolean) => (
    <div className="space-y-1.5">
      <label htmlFor={`${id}-${key}`} className="block text-sm font-medium">{label}{unit}</label>
      <Input
        id={`${id}-${key}`}
        value={value}
        onChange={(e) => set(e.target.value.trim())}
        inputMode="decimal"
        aria-invalid={bad ? true : undefined}
        aria-describedby={`${id}-hint`}
        autoComplete="off"
        placeholder={key === "from" ? "judge's" : "end"}
        className={cn("w-32 tabular-nums", bad && "border-danger")}
      />
    </div>
  );

  return (
    <Card className="mb-4">
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>Averaging window</CardTitle>
          <CardDescription>{doc ? windowText(doc) : "Pick the iterations or times to average its forces over."}</CardDescription>
        </div>
        {doc && (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            The judge&apos;s verdict <VerdictBadge verdict={doc.verdict} />
          </div>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate aria-label="Averaging window" className="flex flex-wrap items-end gap-3">
          {field("from", "From", from, setFrom, (from !== "" && f == null) || crossed)}
          {field("to", "To", upTo, setUpTo, (upTo !== "" && t == null) || crossed)}
          <Button type="submit" size="sm" className="mb-px">Average</Button>
          <Button type="button" variant="ghost" size="sm" className="mb-px" disabled={judges}
            onClick={() => void navigate(to(resultsPagePath(name)))}>
            <RotateCcw aria-hidden /> The judge&apos;s window
          </Button>
        </form>
        <p id={`${id}-hint`} className={cn("mt-2 text-xs", problem ? "text-danger" : "text-muted-foreground")}>
          {problem ?? hint}
        </p>
      </CardContent>
    </Card>
  );
}

/** A force's three cells: its mean ± how sure it is, its standard deviation (from md) and its drift. */
function ForceCells({ f, doc }: { f: ResultForce | null; doc: CaseResults }) {
  return (
    <>
      <TD className="text-right tabular-nums whitespace-nowrap">
        {newtons(f)}
        <div className="text-xs text-muted-foreground">{plusMinus(f)}</div>
      </TD>
      <TD className="hidden text-right tabular-nums text-muted-foreground md:table-cell">{formatNumber(f?.sd, 3)}</TD>
      <TD className="text-right">
        {driftWarns(f, doc) ? <DriftBadge drift={f?.drift ?? null} />
          : <span className="text-[13px] tabular-nums text-muted-foreground">{driftText(f?.drift)}</span>}
      </TD>
    </>
  );
}

const patchesText = (p: string[] | null) => (p ? p.join(", ") : "its patches aren't named in system/");

function GroupName({ g }: { g: CaseResults["groups"][number] }) {
  return (
    <TD>
      <span className="font-medium wrap-anywhere"><CamelCaseName name={g.name} /></span>
      {g.total && <Badge tone="primary" className="ml-2">Total</Badge>}
      <div className="text-xs text-muted-foreground wrap-anywhere">{patchesText(g.patches)}</div>
    </TD>
  );
}

function ForcesCard({ doc }: { doc: CaseResults }) {
  const word = verticalWord(doc);
  return (
    <Card className="mb-4">
      <CardHeader>
        <div>
          <CardTitle>Forces</CardTitle>
          <CardDescription>
            Each force group&apos;s mean over the window, in N, ± how sure it is (the 95 % interval of 5 batch means,
            from 25 values), its standard deviation, and its drift: how far it changed between the window&apos;s two
            halves.
          </CardDescription>
        </div>
      </CardHeader>
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Force group</TH>
            <TH className="text-right">Drag (N)</TH>
            <TH className="hidden text-right md:table-cell">sd</TH>
            <TH className="text-right">Drift</TH>
            <TH className="text-right">{word} (N)</TH>
            <TH className="hidden text-right md:table-cell">sd</TH>
            <TH className="text-right">Drift</TH>
            <TH className="text-right">L/D</TH>
          </TR>
        </THead>
        <TBody>
          {doc.groups.map((g) => (
            <TR key={g.name}>
              <GroupName g={g} />
              <ForceCells f={g.drag} doc={doc} />
              <ForceCells f={g.vertical} doc={doc} />
              <TD className="text-right tabular-nums">{formatNumber(g.LD, 3)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

function CoefficientsCard({ doc }: { doc: CaseResults }) {
  const word = verticalWord(doc);
  const q = doc.q == null
    ? "Without its freestream speed (0/U) and density (rhoInf), CdA and ClA can't be worked out."
    : `CdA and ClA are each force over q, ½ ρ U² = ${formatNumber(doc.q)} Pa (ρ ${formatNumber(doc.rho)} kg/m³, `
      + `U ${formatNumber(doc.Uinf)} m/s).`;
  return (
    <Card className="mb-4">
      <CardHeader>
        <div>
          <CardTitle>Coefficients</CardTitle>
          <CardDescription>
            {q} Cd and Cl are over ½ ρ U² Aref of the forceCoeffs function object that covers its patches; ClA and Cl
            are of its {word.toLowerCase()}.
          </CardDescription>
        </div>
      </CardHeader>
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Force group</TH>
            <TH className="text-right">CdA (m²)</TH>
            <TH className="text-right">ClA (m²)</TH>
            <TH className="hidden text-right sm:table-cell">Aref (m²)</TH>
            <TH className="text-right">Cd</TH>
            <TH className="text-right">Cl</TH>
          </TR>
        </THead>
        <TBody>
          {doc.groups.map((g) => (
            <TR key={g.name}>
              <GroupName g={g} />
              <TD className="text-right tabular-nums">{formatNumber(g.CdA)}</TD>
              <TD className="text-right tabular-nums">{formatNumber(g.ClA)}</TD>
              <TD className="hidden text-right tabular-nums sm:table-cell">{formatNumber(g.Aref)}</TD>
              <TD className="text-right tabular-nums">{formatNumber(g.Cd)}</TD>
              <TD className="text-right tabular-nums">{formatNumber(g.Cl)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

function ResidualsCard({ doc }: { doc: CaseResults }) {
  const fields = Object.entries(doc.residuals);
  if (!fields.length) return null;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Residuals</CardTitle>
          <CardDescription>
            How far each fell up to the window&apos;s end: from the largest of its first 10 values to the median of its
            last 20.
          </CardDescription>
        </div>
      </CardHeader>
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Field</TH>
            <TH className="text-right">First</TH>
            <TH className="text-right">Final</TH>
            <TH className="text-right">Fell</TH>
          </TR>
        </THead>
        <TBody>
          {fields.map(([field, r]) => (
            <TR key={field}>
              <TD className="font-mono text-[13px]">{field}</TD>
              <TD className="text-right tabular-nums">{formatNumber(r.first, 3)}</TD>
              <TD className="text-right tabular-nums">{formatNumber(r.final, 3)}</TD>
              <TD className="text-right tabular-nums whitespace-nowrap">{ordersText(r.orders)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

/** The last window's numbers, dimmed while another is averaged. */
function Dim({ busy, children }: { busy: boolean; children: ReactNode }) {
  return <div className={cn("transition-opacity", busy && "opacity-60")} aria-busy={busy || undefined}>{children}</div>;
}

/** Why there are no numbers to show: nothing to average yet, or a window it can't take (not-ready), or one the demo
 * didn't record (unavailable). */
function Refused({ code, message, demo }: { code: string; message: string; demo: boolean }) {
  const title = code === "unavailable" && demo ? "Not in the demo" : "Nothing to average";
  return (
    <Card className="p-5" role="status">
      <div className="flex gap-3">
        <Hourglass className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-sm wrap-anywhere text-muted-foreground">{message}</p>
        </div>
      </div>
    </Card>
  );
}

export function CaseResultsPage() {
  const { name = "" } = useParams();
  useTitle(`Results of ${name}`);
  const { mode } = useEngine();
  const to = useAppPath();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const w = windowOf(params);
  const q = useCaseResults(name, w);
  const doc = q.data;
  const e = q.isError ? asEngineError(q.error) : null;

  const sub = [
    "Results",
    doc && `${doc.transient ? "Transient" : "Steady"}, ${spanText(doc)}`,
    doc?.cells != null && `${formatCells(doc.cells)} cells`,
    doc?.updated && `forces written ${formatRelative(doc.updated)}`,
    mode === "demo" && "recorded demo",
  ].filter((x): x is string => typeof x === "string");
  const header = (
    <PageHeader
      title={name}
      description={sub.join(" · ")}
      actions={(
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" asChild>
            <Link to={to("/results")}><ArrowLeft />Results</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link to={to(comparePagePath({ a: name }))}><ArrowLeftRight />Compare…</Link>
          </Button>
        </div>
      )}
    />
  );
  // The form starts again from the address's window when it changes (Back, or The judge's window).
  const windowCard = <WindowCard key={`${w.from}:${w.to}`} name={name} doc={doc} w={w} />;
  // The charts' window is the address's as soon as it changes, while the numbers for it are still being averaged.
  const charts = (
    <ForceCharts name={name} window={chartWindow(w, doc)}
      onWindow={(from, upTo) => void navigate(to(resultsPagePath(name, { from, to: upTo })))} />
  );

  if (!doc) {
    if (e?.code === "not-found") {
      const old = e.message.startsWith("no such API route");
      return (
        <>
          {header}
          <Card>
            <EmptyState icon={ChartLine} title={old ? "Your engine can't show results yet" : "No such case"}>
              {old ? "It is older than the Results screen (it speaks API 1.22 or older). Update Mesh Doctor on your "
                + "computer, then see them here." : `The engine has no case ${name} in its cases folder: it may have `
                + "been renamed or deleted. "}
              {!old && <Link to={to("/results")} className={LINK}>See the cases with results</Link>}
            </EmptyState>
          </Card>
        </>
      );
    }
    const asked = w.from != null || w.to != null;
    return (
      <>
        {header}
        {asked && windowCard}
        {e && (e.code === "not-ready" || e.code === "unavailable") ? (
          <>
            <Refused code={e.code} message={e.message} demo={mode === "demo"} />
            {/* the run's forces, to move the window back to where there are some */}
            <div className="mt-4">{charts}</div>
          </>
        ) : q.isError ? (
          <ErrorPanel error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
        ) : (
          <Card className="p-5">
            <p role="status" className="text-sm text-muted-foreground">Averaging its forces…</p>
          </Card>
        )}
      </>
    );
  }

  return (
    <>
      {header}
      {q.isError && (
        <ErrorPanel compact className="mb-4" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      )}
      {doc.warnings.length > 0 && <Warnings warnings={doc.warnings} />}
      {windowCard}
      <Dim busy={q.isPlaceholderData}><Headline doc={doc} /></Dim>
      {charts}
      <Dim busy={q.isPlaceholderData}>
        <ForcesCard doc={doc} />
        <CoefficientsCard doc={doc} />
        <ResidualsCard doc={doc} />
      </Dim>
    </>
  );
}
