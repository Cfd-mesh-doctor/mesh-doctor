// SPDX-License-Identifier: GPL-3.0-or-later
// Two runs' results compared (GET /compare, API 1.25): two cases from the cases folder (as a mesh study, one design at
// two mesh sizes, or not), or an A/B test's two runs (?abtest=), averaged over the same window: up to the shorter run's
// end, from the later of their judges' starts, unless the address asks for another (?from=&to=). For each force group
// in both, b's difference from a in N and in %, and whether it is real or inside the noise (both means' uncertainty and
// drift); a mesh study also says whether each force moves less between the meshes than it swings. Plain warnings come
// first. Two cases' forces are drawn over their runs on one chart for each force, the window shaded: dragging its edges
// asks for another, as From and To do. A case's results page opens it with that case as a (Compare…), to pick b.
import { ArrowLeft, ArrowLeftRight, Hourglass, RotateCcw, TriangleAlert } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { LineChart, type Band } from "@/components/charts/LineChart";
import { ErrorPanel } from "@/components/shared/ErrorPanel";
import { CamelCaseName, EmptyState, PageHeader } from "@/components/shared/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { useAppPath, useEngine } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { useComparison, useForceHistory, useResultsList } from "@/engine/hooks";
import type { CompareAsk, ComparedGroup, ComparedSide, Comparison } from "@/engine/types";
import { formatInt, formatNumber } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import { cn } from "@/lib/utils";
import {
  KIND_TEXT, askOf, comparePagePath, compareWindowText, meshCheck, named, sideText, sideWindowText, signed,
  signedPercent, verdictOf,
} from "./compareView";
import { FIELD } from "./dialogParts";
import { VerdictBadge } from "./Results";
import { resultsPagePath, windowNumber, windowProblem } from "./resultsView";
import { timeNumber } from "./solveStart";

const LINK = "font-medium text-primary underline-offset-4 hover:underline";

/** A line as each run's is drawn on the charts: a's solid, b's dashed. */
function LineSwatch({ dashed = false }: { dashed?: boolean }) {
  return (
    <svg width="24" height="6" viewBox="0 0 24 6" aria-hidden className="shrink-0">
      <line x1="0" x2="24" y1="3" y2="3" strokeWidth="2" strokeDasharray={dashed ? "5 4" : undefined}
        className={dashed ? "stroke-foreground" : "stroke-primary"} />
    </svg>
  );
}

/** Its plain warnings: meshes of different sizes in a design comparison, a half model against a whole one, vertical
 *  forces that point opposite ways, a run still drifting, too few values, groups only one has. */
function Warnings({ warnings }: { warnings: string[] }) {
  return (
    <div role="note" className="mb-4 rounded-xl border border-warning/25 bg-warning-soft/60 p-4">
      <div className="flex gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Before you trust a difference</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
            {warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** What to compare: two cases with results (those the engine lists, and the two asked for), and whether they are a
 *  mesh study; Compare asks for them over their judges' window. */
function PickCard({ ask }: { ask: CompareAsk }) {
  const id = useId();
  const to = useAppPath();
  const navigate = useNavigate();
  const list = useResultsList();
  const [a, setA] = useState(ask.a ?? "");
  const [b, setB] = useState(ask.b ?? "");
  const [mesh, setMesh] = useState(ask.mesh);
  const [tried, setTried] = useState(false);
  const names = [...new Set([...(list.data?.items.map((d) => d.case) ?? []), ...[ask.a, ask.b].filter((x) => x != null)])];
  const problem = !a || !b ? "Pick two cases to compare." : a === b ? "Pick two different cases." : null;
  const shown = tried && problem;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (problem) return;
    void navigate(to(comparePagePath({ a, b, mesh })));
  }
  const select = (key: "a" | "b", value: string, set: (v: string) => void) => (
    <div className="min-w-0 flex-1 basis-48 space-y-1.5 sm:max-w-xs">
      <label htmlFor={`${id}-${key}`} className="block text-sm font-medium">Case {key}</label>
      <select id={`${id}-${key}`} className={FIELD} value={value} aria-describedby={`${id}-hint`}
        aria-invalid={shown && (!value || a === b) ? true : undefined} onChange={(e) => set(e.target.value)}>
        <option value="">{list.isPending ? "Reading the cases…" : "Pick a case"}</option>
        {names.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
  return (
    <Card className="mb-4">
      <CardHeader className="block">
        <CardTitle>What to compare</CardTitle>
        <CardDescription>Two cases with results, each difference b&apos;s less a&apos;s.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate aria-label="What to compare" className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            {select("a", a, setA)}
            {select("b", b, setB)}
            <Button type="submit" size="sm" className="mb-px">Compare</Button>
          </div>
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" checked={mesh} onChange={(e) => setMesh(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary" />
            <span>
              <span className="font-medium">A mesh study</span>
              <span className="block text-xs text-muted-foreground">
                One design at two mesh sizes: each force also says whether it moves less between the meshes than it
                swings. Two cases Mesh Doctor made from one template at two sizes are one without it.
              </span>
            </span>
          </label>
        </form>
        <p id={`${id}-hint`} className={cn("mt-2 text-xs", shown ? "text-danger" : "text-muted-foreground")}>
          {shown ? problem : list.isError
            ? "The engine didn't list its cases with results: pick from the two asked for, or go back to Results."
            : "The cases the Results screen lists: those with a force history."}
        </p>
      </CardContent>
    </Card>
  );
}

/** The window both are averaged over, in words; From and To ask for another (the address keeps it), and Their
 *  judges' window goes back. */
function CompareWindow({ ask, doc }: { ask: CompareAsk; doc: Comparison | undefined }) {
  const id = useId();
  const to = useAppPath();
  const navigate = useNavigate();
  const [from, setFrom] = useState(ask.from == null ? "" : String(ask.from));
  const [upTo, setUpTo] = useState(ask.to == null ? "" : String(ask.to));
  const problem = windowProblem(from, upTo);
  const [f, t] = [windowNumber(from), windowNumber(upTo)];
  const crossed = f != null && t != null && f >= t;
  const transient = doc?.a.transient;
  const unit = doc == null ? "" : transient ? " (s)" : " (iteration)";
  const hint = `The forces after From, up to and with To, in ${transient ? "seconds of flow" : doc ? "iterations"
    : "iterations or a transient run's seconds of flow"}. Leave From empty for the later of their judges' starts, and To `
    + "for the shorter run's end.";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (problem) return;
    void navigate(to(comparePagePath({ ...ask, from: f, to: t })));
  }
  const field = (key: "from" | "to", label: string, value: string, set: (v: string) => void, bad: boolean) => (
    <div className="space-y-1.5">
      <label htmlFor={`${id}-${key}`} className="block text-sm font-medium">{label}{unit}</label>
      <Input id={`${id}-${key}`} value={value} onChange={(e) => set(e.target.value.trim())} inputMode="decimal"
        aria-invalid={bad ? true : undefined} aria-describedby={`${id}-hint`} autoComplete="off"
        placeholder={key === "from" ? "judges'" : "end"} className={cn("w-32 tabular-nums", bad && "border-danger")} />
    </div>
  );
  return (
    <Card className="mb-4">
      <CardHeader className="block">
        <CardTitle>Averaging window</CardTitle>
        <CardDescription>{doc ? compareWindowText(doc) : "Pick the iterations or times to average both runs over."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate aria-label="Averaging window" className="flex flex-wrap items-end gap-3">
          {field("from", "From", from, setFrom, (from !== "" && f == null) || crossed)}
          {field("to", "To", upTo, setUpTo, (upTo !== "" && t == null) || crossed)}
          <Button type="submit" size="sm" className="mb-px">Average</Button>
          <Button type="button" variant="ghost" size="sm" className="mb-px" disabled={ask.from == null && ask.to == null}
            onClick={() => void navigate(to(comparePagePath({ ...ask, from: null, to: null })))}>
            <RotateCcw aria-hidden /> Their judges&apos; window
          </Button>
        </form>
        <p id={`${id}-hint`} className={cn("mt-2 text-xs", problem ? "text-danger" : "text-muted-foreground")}>
          {problem ?? hint}
        </p>
      </CardContent>
    </Card>
  );
}

/** One side: its name (a link to its results, for a case), whether it is steady, its cells, what it was made from,
 *  its values in the window and the judge's verdict; its own window where they share none. */
function Side({ tag, s, link, own }: { tag: "a" | "b"; s: ComparedSide; link: boolean; own: boolean }) {
  const to = useAppPath();
  return (
    <div className="min-w-0 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <LineSwatch dashed={tag === "b"} />
        <span className="text-xs font-semibold text-muted-foreground">{tag}</span>
        {link ? <Link to={to(resultsPagePath(s.case))} className={cn(LINK, "wrap-anywhere")}>{s.case}</Link>
          : <span className="font-medium wrap-anywhere">{s.case}</span>}
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">{sideText(s)}</p>
      {own && <p className="mt-1 text-[13px] text-muted-foreground">Averaged over {sideWindowText(s)}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        The judge&apos;s verdict <VerdictBadge verdict={s.verdict} />
      </div>
    </div>
  );
}

function SidesCard({ doc, links }: { doc: Comparison; links: boolean }) {
  return (
    <Card className="mb-4">
      <CardHeader className="block">
        <CardTitle>The two runs</CardTitle>
        <CardDescription>{KIND_TEXT[doc.kind]}: each difference below is b&apos;s less a&apos;s.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <Side tag="a" s={doc.a} link={links} own={doc.window == null} />
        <Side tag="b" s={doc.b} link={links} own={doc.window == null} />
      </CardContent>
    </Card>
  );
}

function GroupCell({ g, span }: { g: ComparedGroup; span: number }) {
  return (
    <TD rowSpan={span} className="align-top">
      <span className="font-medium wrap-anywhere"><CamelCaseName name={g.name} /></span>
      {g.total && <Badge tone="primary" className="ml-2">Total</Badge>}
      {g.nameB !== g.name && <div className="text-xs text-muted-foreground wrap-anywhere">in b: {g.nameB}</div>}
    </TD>
  );
}

/** Each force of each group in both: a's and b's means, b's difference in N and %, its noise and its verdict; and in a
 *  mesh study whether it moves less between the meshes than it swings. */
function DifferencesCard({ doc }: { doc: Comparison }) {
  const mesh = doc.kind === "mesh";
  const word = doc.vertical === "downforce" ? "Downforce" : "Lift";
  const rows = doc.groups.flatMap((g) => {
    const forces = ([["drag", "Drag", g.drag], ["vertical", word, g.vertical]] as const)
      .flatMap(([key, label, x]) => (x ? [{ key, label, x }] : []));
    return forces.map((f, i) => ({ g, ...f, first: i === 0, span: forces.length }));
  });
  return (
    <Card className="mb-4">
      <CardHeader className="block">
        <CardTitle>Differences</CardTitle>
        <CardDescription>
          b&apos;s mean less a&apos;s, for each force group in both, in N and in % of a&apos;s. It is real when it is
          larger than its noise: each mean&apos;s uncertainty (the 95 % interval of 5 batch means) or its drift between
          the window&apos;s two halves, whichever is larger, the two added in quadrature; else it is inside the noise. A
          force under 1 % of the total drag is marked small: judge it by its N, not its %.
          {mesh && " Between the meshes: whether each force moves less than it swings (the larger standard deviation), "
            + "the test of mesh independence."}
        </CardDescription>
      </CardHeader>
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Force group</TH>
            <TH>Force</TH>
            <TH className="hidden text-right sm:table-cell">a (N)</TH>
            <TH className="hidden text-right sm:table-cell">b (N)</TH>
            <TH className="text-right">b − a (N)</TH>
            <TH className="text-right">%</TH>
            <TH className="hidden text-right md:table-cell">Noise (N)</TH>
            <TH>Verdict</TH>
            {mesh && <TH>Between the meshes</TH>}
          </TR>
        </THead>
        <TBody>
          {rows.map(({ g, key, label, x, first, span }) => {
            const v = verdictOf(x);
            const m = meshCheck(x);
            return (
              <TR key={`${g.name}:${key}`}>
                {first && <GroupCell g={g} span={span} />}
                <TD className="whitespace-nowrap">
                  {label}{x.small && <Badge className="ml-2">small</Badge>}
                </TD>
                <TD className="hidden text-right tabular-nums sm:table-cell">{formatNumber(x.a)}</TD>
                <TD className="hidden text-right tabular-nums sm:table-cell">{formatNumber(x.b)}</TD>
                <TD className="text-right font-medium tabular-nums whitespace-nowrap">{signed(x.diff)}</TD>
                <TD className="text-right tabular-nums whitespace-nowrap">{signedPercent(x.pct)}</TD>
                <TD className="hidden text-right tabular-nums text-muted-foreground md:table-cell">
                  {formatNumber(x.noise, 2)}
                </TD>
                <TD><Badge tone={v.tone} className="whitespace-nowrap">{v.text}</Badge></TD>
                {mesh && <TD>{m ? <Badge tone={m.tone} className="whitespace-normal">{m.text}</Badge> : "–"}</TD>}
              </TR>
            );
          })}
        </TBody>
      </Table>
    </Card>
  );
}

/** Both cases' forces over their runs (GET /results/{case}/forces of each): one chart for each force, a's line solid
 *  and b's dashed, the window shaded; its edges ask for another. The total group's first; a picker gives the others. */
function CompareCharts({ doc, onWindow }: { doc: Comparison; onWindow: (from: number, to: number | null) => void }) {
  const id = useId();
  const ha = useForceHistory(doc.a.case);
  const hb = useForceHistory(doc.b.case);
  const [picked, setPicked] = useState(0);
  const g = doc.groups[picked] ?? doc.groups[0];
  if (!g) return null;
  if (ha.isPending || hb.isPending) {
    return (
      <Card className="mb-4 p-5">
        <p role="status" className="text-sm text-muted-foreground">Reading their force histories…</p>
      </Card>
    );
  }
  const ga = ha.data?.groups.find((x) => x.name === g.name);
  const gb = hb.data?.groups.find((x) => x.name === g.nameB);
  if (!ga || !gb) return null;                          // one of them can't chart its forces: the table still says
  const word = doc.vertical === "downforce" ? "Downforce" : "Lift";
  const w = doc.window;
  const band: Band | undefined = w?.from != null ? { from: w.from, to: w.to, label: "averaged", onChange: onWindow } : undefined;
  const t0 = Math.min(ga.t[0] ?? 0, gb.t[0] ?? 0);
  const t1 = Math.max(ga.t.at(-1) ?? 0, gb.t.at(-1) ?? 0);
  const transient = doc.a.transient;
  const chart = (what: string, key: "drag" | "vertical") => (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-sm font-medium">{what} (N)</figcaption>
      <LineChart height={220} label={`${what} of ${g.name} in both runs, in N`} band={band}
        yFrom={t1 > t0 ? t0 + (t1 - t0) / 10 : undefined}
        xLabel={transient ? "time (s)" : "iteration"} xFormat={transient ? timeNumber : formatInt}
        empty={`No ${what.toLowerCase()} written`}
        series={[
          { name: doc.a.case, stroke: "stroke-primary", swatch: "bg-primary", x: ga.t, y: ga[key] },
          { name: doc.b.case, stroke: "stroke-foreground", swatch: "bg-foreground", dashed: true, x: gb.t, y: gb[key] },
        ]} />
    </figure>
  );
  return (
    <Card className="mb-4">
      <CardHeader className="block">
        <CardTitle>Both runs&apos; forces</CardTitle>
        <CardDescription>
          {g.total ? "The total group's" : `The ${g.name} group's`} forces over each run, in N.
          {band && " The shaded part is the window both are averaged over: drag its edges, or move them with the arrow "
            + "keys, to average over another."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3">
          {doc.groups.length > 1 && (
            <div className="w-full max-w-xs space-y-1.5">
              <label htmlFor={`${id}-group`} className="block text-sm font-medium">Force group</label>
              <select id={`${id}-group`} className={FIELD} value={doc.groups.indexOf(g)}
                onChange={(e) => setPicked(Number(e.target.value))}>
                {doc.groups.map((x, i) => <option key={x.name} value={i}>{x.total ? `${x.name} (total)` : x.name}</option>)}
              </select>
            </div>
          )}
          <ul aria-label="Lines" className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
            <li className="flex min-w-0 items-center gap-2"><LineSwatch /><span className="wrap-anywhere">a: {doc.a.case}</span></li>
            <li className="flex min-w-0 items-center gap-2"><LineSwatch dashed /><span className="wrap-anywhere">b: {doc.b.case}</span></li>
          </ul>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {chart("Drag", "drag")}
          {doc.vertical && chart(word, "vertical")}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Each chart&apos;s scale fits the forces after the longer run&apos;s first tenth: larger ones before it run off
          its edges.
        </p>
      </CardContent>
    </Card>
  );
}

/** The last comparison's numbers, dimmed while another window is averaged. */
function Dim({ busy, children }: { busy: boolean; children: ReactNode }) {
  return <div className={cn("transition-opacity", busy && "opacity-60")} aria-busy={busy || undefined}>{children}</div>;
}

/** Why there is nothing to show: a case or A/B test it hasn't, two it won't compare (bad-request), nothing to average
 *  yet or a window it can't take (not-ready), or a comparison the demo didn't record (unavailable). */
function Refused({ code, message, demo }: { code: string; message: string; demo: boolean }) {
  const title = code === "unavailable" && demo ? "Not in the demo"
    : code === "not-ready" ? "Nothing to compare yet" : code === "not-found" ? "Nothing to compare" : "Can't compare these";
  return (
    <Card className="mb-4 p-5" role="status">
      <div className="flex gap-3">
        <Hourglass className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-sm wrap-anywhere text-muted-foreground">
            {message.charAt(0).toUpperCase() + message.slice(1)}
          </p>
        </div>
      </div>
    </Card>
  );
}

export function ComparePage() {
  const { mode } = useEngine();
  const to = useAppPath();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ask = askOf(params);
  const q = useComparison(ask);
  const doc = q.data;
  const e = q.isError ? asEngineError(q.error) : null;
  useTitle(doc ? `Compare ${doc.a.case} and ${doc.b.case}` : "Compare");

  const sub = [
    doc ? KIND_TEXT[doc.kind] : "Two runs' results over the same window",
    mode === "demo" && "recorded demo",
  ].filter((x): x is string => typeof x === "string");
  const header = (
    <PageHeader
      title={doc ? `${doc.a.case} against ${doc.b.case}` : ask.abtest != null ? `${ask.abtest}'s two runs` : "Compare"}
      description={sub.join(" · ")}
      actions={(
        <Button variant="secondary" asChild>
          {ask.abtest != null
            ? <Link to={to(`/abtests/${encodeURIComponent(ask.abtest)}`)}><ArrowLeft />A/B test</Link>
            : <Link to={to("/results")}><ArrowLeft />Results</Link>}
        </Button>
      )}
    />
  );
  // The forms start again from the address when it changes (Back, another pair, or Their judges' window).
  const pick = ask.abtest == null ? <PickCard key={`${ask.a}:${ask.b}:${ask.mesh}`} ask={ask} /> : null;
  const windowCard = <CompareWindow key={`${ask.from}:${ask.to}`} ask={ask} doc={doc} />;

  if (!named(ask)) {
    return (
      <>
        {header}
        {pick}
        <Card>
          <EmptyState icon={ArrowLeftRight} title={ask.a ? `Pick a case to compare with ${ask.a}` : "Pick two cases to compare"}>
            Both are averaged over the same window, and each force&apos;s difference is said to be real or inside the
            noise. Another case of the same design meshed at another size makes a mesh study.
          </EmptyState>
        </Card>
      </>
    );
  }
  if (!doc) {
    if (e?.code === "not-found" && e.message.startsWith("no such API route")) {
      return (
        <>
          {header}
          <Card>
            <EmptyState icon={ArrowLeftRight} title="Your engine can't compare runs yet">
              It is older than the Compare screen (it speaks API 1.24 or older). Update Mesh Doctor on your computer,
              then compare two runs here. Each case&apos;s own results are on the{" "}
              <Link to={to("/results")} className={LINK}>Results screen</Link>.
            </EmptyState>
          </Card>
        </>
      );
    }
    const asked = ask.from != null || ask.to != null;
    const said = e && ["bad-request", "not-found", "not-ready", "unavailable"].includes(e.code);
    return (
      <>
        {header}
        {said ? <Refused code={e.code} message={e.message} demo={mode === "demo"} />
          : q.isError ? <ErrorPanel className="mb-4" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
            : (
              <Card className="mb-4 p-5">
                <p role="status" className="text-sm text-muted-foreground">Comparing their forces…</p>
              </Card>
            )}
        {asked && windowCard}
        {pick}
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
      <SidesCard doc={doc} links={ask.abtest == null} />
      {doc.window && windowCard}
      <Dim busy={q.isPlaceholderData}><DifferencesCard doc={doc} /></Dim>
      {ask.abtest == null && (
        // an end let go at the shorter run's end, where the window ends anyway, isn't kept in the address
        <CompareCharts doc={doc} onWindow={(from, upTo) => void navigate(to(comparePagePath({
          ...ask, from, to: upTo != null && upTo < Math.min(doc.a.end, doc.b.end) ? upTo : null,
        })))} />
      )}
      {pick}
    </>
  );
}
