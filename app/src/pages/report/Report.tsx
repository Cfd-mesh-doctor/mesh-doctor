// SPDX-License-Identifier: GPL-3.0-or-later
// The report viewer: open a report file (meshdoctor report <name>) and read what the repair changed and
// whether it helped the solver. The file is read in this tab and never uploaded: the site's security
// policy only lets the page talk to itself and to an engine on this computer. A sample report lives in the
// address (/report?sample=<name>), so a link opens it and Back leaves it.
import {
  Activity, Boxes, Check, FileJson, FileUp, FolderOpen, Move, ShieldCheck, Sparkles, TrendingDown, TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { PublicFooter, PublicHeader } from "@/components/layout/PublicChrome";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { PageHeader, StatTile } from "@/components/shared/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDateTime, formatInt, formatNumber } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import { aboutPage } from "@/pages/docs/entries";
import { cn } from "@/lib/utils";
import { HEAT, viewHeading, type MapSummary, type MapViewName } from "@/report/map";
import { ReportError, checkReport, fileBytes, readReport } from "@/report/read";
import { measureLabel, ratioChange, summarize, type ReportSummary } from "@/report/summary";
import { SAMPLES } from "@/report/samples";
import { AbCard, JudgeCard, ResidualCard } from "./AbCards";
import { ClustersCard, type ClusterSource } from "./Clusters";
import { MapMarks } from "./MapMarks";
import { Section } from "./Section";
import { changeText } from "./tone";
import { RepairMap } from "./RepairMap";

type State =
  | { kind: "empty" }
  | { kind: "reading"; file: string }
  | { kind: "error"; message: string }
  | { kind: "open"; summary: ReportSummary; from: string };

const ACCEPT = ".json,.gz,.html,.htm,application/json,application/gzip,text/html";


const SAMPLE_FROM = "the public Ahmed-body example (a sample)";
const SAMPLE_NAMES = SAMPLES.map((s) => s.name).join(" and ");

export function Report() {
  const [state, setState] = useState<State>({ kind: "empty" });
  const [over, setOver] = useState(false);
  const latest = useRef(0);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sampleName = params.get("sample");
  const sample = SAMPLES.find((s) => s.name === sampleName);
  const loaded = useQuery({
    queryKey: ["sample report", sampleName],
    queryFn: sample ? async () => summarize(checkReport((await sample.load()).default)) : skipToken,
    staleTime: Infinity,
  });
  // What the page shows: the sample the address names, else the file picked or dropped.
  const view: State =
    sampleName === null ? state
    : !sample ? { kind: "error", message: `There's no sample called "${sampleName.slice(0, 60)}": the samples are ${SAMPLE_NAMES}.` }
    : loaded.data ? { kind: "open", summary: loaded.data, from: SAMPLE_FROM }
    : loaded.isError ? {
      kind: "error",
      message: loaded.error instanceof ReportError
        ? loaded.error.message
        : "The sample couldn't be loaded. Check the connection and try again.",
    }
    : { kind: "reading", file: `the sample ${sampleName}` };
  useTitle(view.kind === "open" ? `Report ${view.summary.name}` : "Report viewer", aboutPage("/report"));

  const open = useCallback(async (file: File) => {
    const n = ++latest.current; // a second file picked while the first is read wins
    if (sampleName !== null) void navigate({ search: "" }, { replace: true }); // the file takes the sample's place
    setState({ kind: "reading", file: file.name });
    let next: State;
    try {
      const { report, from } = await readReport(await fileBytes(file), file.name);
      next = { kind: "open", summary: summarize(report), from };
    } catch (e) {
      if (!(e instanceof ReportError)) console.error("Mesh Doctor report viewer:", e);
      next = {
        kind: "error",
        message: e instanceof ReportError ? e.message : "This file couldn't be opened. Is it a Mesh Doctor report?",
      };
    }
    if (n !== latest.current) return;
    setState(next);
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
  }, [navigate, sampleName]);

  // A file dropped anywhere on the page opens, also over an open report.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes("Files"));
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setOver(true);
    };
    const onLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setOver(false);
      const file = e.dataTransfer?.files[0];
      if (file) void open(file);
    };
    document.addEventListener("dragenter", onOver);
    document.addEventListener("dragover", onOver);
    document.addEventListener("dragleave", onLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onOver);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, [open]);

  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        {view.kind === "open" ? (
          <ReportView
            summary={view.summary}
            from={view.from}
            action={sampleName !== null ? (
              <Button variant="secondary" asChild><Link to={{ search: "" }}><FolderOpen /> Open another report</Link></Button>
            ) : (
              <Button variant="secondary" onClick={() => setState({ kind: "empty" })}><FolderOpen /> Open another report</Button>
            )}
          />
        ) : (
          <>
            <PageHeader
              title="Report viewer"
              description="Open a Mesh Doctor report to see what a repair changed in the mesh, and whether it helped the solver."
            />
            <Card className={cn("border-2 border-dashed px-6 py-12 text-center transition-colors", over && "border-primary bg-primary-soft/40")}>
              <div className="mx-auto grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
                <FileUp className="size-6" aria-hidden />
              </div>
              <h2 className="mt-4 text-base font-semibold">Open a report</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                A <code>.mdreport.json</code>, <code>.json.gz</code> or exported <code>.html</code> file from{" "}
                <code>meshdoctor report</code>. Drop it anywhere on this page, or pick it:
              </p>
              <div className="mt-5">
                <Button asChild>
                  <label className="cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
                    <FolderOpen /> Choose a report file
                    <input
                      type="file"
                      accept={ACCEPT}
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = ""; // so the same file can be picked again
                        if (file) void open(file);
                      }}
                    />
                  </label>
                </Button>
              </div>
              {view.kind === "reading" && (
                <p className="mt-4 text-sm text-muted-foreground" role="status">Reading {view.file}…</p>
              )}
              {view.kind === "error" && (
                <div role="alert" className="mx-auto mt-5 max-w-lg rounded-lg border border-danger/25 bg-danger-soft/60 p-3 text-left text-sm">
                  {view.message}
                </div>
              )}
            </Card>
            <Card className="mt-4 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">No report at hand? Try a sample</h2>
                <p className="mt-0.5 text-[13.5px] text-muted-foreground">
                  Real reports from the public Ahmed-body example: one with a solver A/B test, one with a repair map.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 sm:shrink-0">
                {SAMPLES.map((s) => (
                  <Button key={s.name} variant="secondary" size="sm" asChild>
                    <Link to={`?sample=${s.name}`}><Sparkles /> {s.label}</Link>
                  </Button>
                ))}
              </div>
            </Card>
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card className="p-5">
                <ShieldCheck className="size-5 text-primary" aria-hidden />
                <h3 className="mt-3 text-sm font-semibold">Stays in this browser</h3>
                <p className="mt-1 text-[13.5px] text-muted-foreground">
                  The file is read right here and never uploaded. This site's security policy only lets the page talk to
                  itself and to an engine on your own computer.
                </p>
              </Card>
              <Card className="p-5">
                <FileJson className="size-5 text-primary" aria-hidden />
                <h3 className="mt-3 text-sm font-semibold">Make one</h3>
                <p className="mt-1 text-[13.5px] text-muted-foreground">On the PC that ran the repair:</p>
                <CopyCommand command="meshdoctor report <name>" className="mt-2" />
                <p className="mt-2 text-xs text-muted-foreground">
                  Add <code>--gzip</code> for a smaller file, or <code>--html</code> for one page to email.
                </p>
              </Card>
              <Card className="p-5">
                <TriangleAlert className="size-5 text-warning" aria-hidden />
                <h3 className="mt-3 text-sm font-semibold">Share it like the case</h3>
                <p className="mt-1 text-[13.5px] text-muted-foreground">
                  Folder paths are replaced when the report is made, but it still holds the case's coordinates, patch
                  and force-group names and its numbers.
                </p>
              </Card>
            </div>
          </>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}

/** An open report. The app shows a repair's report from the engine with it too (pages/app/RepairReport). */
export function ReportView({ summary: s, from, action, abCommand, clusterSource }: {
  summary: ReportSummary;
  from: string;
  action: ReactNode;
  /** A run of your own engine with no A/B test yet: the command for one, offered where its result will show. */
  abCommand?: string | null;
  /** Where the run's cluster shapes come from (the app); a report file has none, so its list has no 3D view. */
  clusterSource?: ClusterSource | null;
}) {
  const sub = [
    s.caseName && `mesh ${s.caseName}`,
    s.cells != null && `${formatInt(s.cells)} cells`,
    s.profile && `${s.profile} profile`,
    s.finished && `repaired ${formatDateTime(s.finished)}`,
    `from ${from}`,
  ].filter((x): x is string => typeof x === "string");
  const ratio = s.ab?.meanRatio ?? null;
  const r = ratioChange(ratio);
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-primary">Mesh Doctor report</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight break-words">{s.name}</h1>
          <p className="mt-1 text-sm break-words text-muted-foreground">{sub.join(" · ")}</p>
        </div>
        <div className="print:hidden">{action}</div>
      </div>

      {/* grid-cols-1, not the default: a wide table then scrolls inside its card instead of widening the page */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label="checkMesh numbers improved" value={s.improved.length} hint={`${s.unchanged.length} unchanged`}
          icon={TrendingUp} tone={s.improved.length ? "success" : undefined} />
        <StatTile label="Numbers made worse" value={s.regressions.length}
          hint={s.regressions.length ? s.regressions.map(measureLabel).join(", ") : "none"}
          icon={TrendingDown} tone={s.regressions.length ? "danger" : "success"} />
        <StatTile label="Problem clusters" value={`${formatInt(s.clustersBefore)} → ${formatInt(s.clustersAfter)}`}
          hint="before → after the repair" icon={Boxes} tone={s.clustersAfter < s.clustersBefore ? "success" : undefined} />
        <StatTile label="Largest point move" value={s.maxMoveMm == null ? "–" : `${formatNumber(s.maxMoveMm, 3)} mm`}
          hint="inside the mesh; the CAD is untouched" icon={Move} />
        {s.ab && (
          <StatTile label="Residuals, repaired ÷ original" value={ratio == null ? "–" : `${ratio.toFixed(2)}×`}
            hint="mean over the fields; below 1× is better" icon={Activity}
            tone={r === "better" ? "success" : r === "worse" ? "danger" : undefined} />
        )}
        <StatTile label="Source case"
          value={s.sourceUnchanged === true ? "Unchanged" : s.sourceUnchanged === false ? "Changed" : "–"}
          hint="checked by its fingerprint" icon={ShieldCheck}
          tone={s.sourceUnchanged === true ? "success" : s.sourceUnchanged === false ? "danger" : undefined} />
      </div>

      <Section title="Verdict">
        <Card className="mt-4" data-tour="verdict">
          <CardHeader><CardTitle>Verdict</CardTitle></CardHeader>
          <CardContent>
            <p className="text-[15px] leading-relaxed">{s.sentence}</p>
            {s.improved.length + s.regressions.length + s.unchanged.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="checkMesh numbers">
                {s.improved.map((k) => (
                  <li key={`i-${k}`}><Badge tone="success"><Check aria-hidden /><span className="sr-only">Better:</span>{measureLabel(k)}</Badge></li>
                ))}
                {s.regressions.map((k) => (
                  <li key={`r-${k}`}><Badge tone="danger"><TriangleAlert aria-hidden /><span className="sr-only">Worse:</span>{measureLabel(k)}</Badge></li>
                ))}
                {s.unchanged.map((k) => (
                  <li key={`u-${k}`}><Badge><span className="sr-only">Unchanged:</span>{measureLabel(k)}</Badge></li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </Section>

      {s.map && (
        <Section title="Where the mesh was repaired">
          <MapCard map={s.map} />
        </Section>
      )}

      {(s.clusters.before.length > 0 || s.clusters.after.length > 0) && (
        <Section title="Problem clusters">
          <ClustersCard clusters={s.clusters} source={clusterSource} />
        </Section>
      )}

      {/* Two columns only when there is an A/B test, or the command for one, to sit beside checkMesh. */}
      <div className={cn("mt-4 grid grid-cols-1 items-start gap-4", (s.ab || abCommand) && "lg:grid-cols-2")}>
        <Section title="checkMesh, before and after the repair">
          <CheckMeshCard rows={s.checkMesh} />
        </Section>
        {s.ab ? (
          <Section title="Did it help the solver?">
            <AbCard ab={s.ab} />
          </Section>
        ) : abCommand && (
          <Section title="Did it help the solver?">
            <AbNextCard command={abCommand} />
          </Section>
        )}
      </div>

      {s.ab && s.ab.history.fields.length > 0 && (
        <Section title="Residuals, original vs repaired mesh">
          <ResidualCard history={s.ab.history} />
        </Section>
      )}

      {s.judge && (
        <Section title="Is the repaired-mesh run converged?">
          <JudgeCard judge={s.judge} />
        </Section>
      )}

      <Section title="About this file">
        <AboutCard about={s.about} />
      </Section>
    </>
  );
}

function CheckMeshCard({ rows }: { rows: ReportSummary["checkMesh"] }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>checkMesh, before and after the repair</CardTitle>
          <CardDescription>Green is better after the repair, red is worse. Counts and maxima should go down, minima up.</CardDescription>
        </div>
      </CardHeader>
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">This repair result has no checkMesh numbers.</p>
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Measure</TH>
              <TH className="text-right">Before</TH>
              <TH className="text-right">After</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.key}>
                <TD>{row.label}</TD>
                <TD className="text-right tabular-nums">{formatNumber(row.before)}</TD>
                <TD className={cn("text-right tabular-nums", changeText(row.change))}>
                  {formatNumber(row.after)}
                  {row.change && <span className="sr-only"> ({row.change})</span>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

/** The next step for a run of your own engine that has no A/B test yet: the command, with the names filled in. */
function AbNextCard({ command }: { command: string }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Did it help the solver?</CardTitle>
          <CardDescription>Not tested yet</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          The A/B solver test runs your case twice, on the original mesh and on the repaired one, with the same
          settings, and compares how they converge. Run it in a WSL or Linux terminal: its result shows up in this
          report.
        </p>
        <CopyCommand command={command} className="mt-3" />
      </CardContent>
    </Card>
  );
}

function MapKey({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5">{mark}{children}</span>;
}

function MapCard({ map }: { map: MapSummary }) {
  const [viewName, setViewName] = useState<MapViewName>(map.views[0]!.name);
  const view = map.views.find((v) => v.name === viewName) ?? map.views[0]!;
  // The last heat layer first, as the engine's own map page does; "none" hides them.
  const [layerKey, setLayerKey] = useState(String(map.layers.length - 1));
  const layer = map.layers[Number(layerKey)] ?? null;
  const n = (k: number) => formatInt(k);
  return (
    <Card className="mt-4">
      <CardHeader className="flex-wrap">
        <div className="min-w-0">
          <CardTitle>Where the mesh was repaired</CardTitle>
          <CardDescription>
            Every wall face of the model, seen from the {view.name === "side" ? "side" : "top"} ({viewHeading(view)});
            darker grey is a finer mesh.<span className="print:hidden"> Point at a mark for details.</span>
          </CardDescription>
        </div>
        {/* The switches do nothing on paper: printed, the caption names the view and the key names the heat layer. */}
        <div className="flex max-w-full flex-wrap gap-2 print:hidden">
          {map.views.length > 1 && (
            <Segmented label="View" value={view.name} onChange={setViewName}
              options={map.views.map((v) => ({ value: v.name, label: v.name === "side" ? "Side" : "Top" }))} />
          )}
          {map.layers.length > 0 && (
            <Segmented label="Heat layer" value={layerKey} onChange={setLayerKey}
              options={[...map.layers.map((l, i) => ({ value: String(i), label: l.label })), { value: "-1", label: "None" }]} />
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <MapKey mark={<span className="size-2.5 rounded-full border-[1.5px] border-chart-3" aria-hidden />}>
            found and repaired ({n(map.before.length)})
          </MapKey>
          <MapKey mark={<span className="size-2.5 rounded-full bg-info" aria-hidden />}>
            left after the repair ({n(map.after.length)})
          </MapKey>
          {layer && (
            <MapKey mark={
              <span className="flex gap-px" aria-hidden>
                {HEAT.map((c) => <span key={c} className="size-2 rounded-full" style={{ background: c }} />)}
              </span>
            }>
              cells whose residual swung most (weak to strong)
              <span className="hidden print:inline">, heat layer {layer.label}</span>
            </MapKey>
          )}
        </div>
        <RepairMap map={map} view={view} layer={layer} />
        {map.notes.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{map.notes.join(" ")}</p>}
        <MapMarks map={map} />
      </CardContent>
    </Card>
  );
}

function AboutCard({ about }: { about: ReportSummary["about"] }) {
  const made = [
    about.created && `Made ${formatDateTime(about.created)}`,
    about.meshdoctor && `by Mesh Doctor ${about.meshdoctor}`,
    about.openfoam && `with OpenFOAM ${about.openfoam}`,
  ].filter(Boolean).join(" ");
  const problems = about.documents.filter((d) => d.problem);
  return (
    <Card className="mt-4">
      <CardHeader>
        <div>
          <CardTitle>About this file</CardTitle>
          <CardDescription>
            {made && `${made}. `}
            {about.pathsReplaced != null && `${formatInt(about.pathsReplaced)} folder paths on the worker were replaced before it was written. `}
            It still holds the case's coordinates, patch and force-group names and numbers: share it like the case itself.
          </CardDescription>
        </div>
      </CardHeader>
      {about.documents.length > 0 && (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Document</TH>
              <TH>Version</TH>
              <TH className="text-right">Size</TH>
              <TH>sha256</TH>
            </TR>
          </THead>
          <TBody>
            {about.documents.map((d) => (
              <TR key={d.key}>
                <TD>{d.label}</TD>
                <TD className="tabular-nums">{d.version}</TD>
                <TD className="text-right tabular-nums">{d.bytes == null ? "–" : `${formatInt(d.bytes / 1000)} kB`}</TD>
                <TD className="font-mono text-xs" title={d.sha256}>{d.sha256.slice(0, 12) || "–"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {problems.map((d) => (
        <p key={d.key} className="flex gap-2 border-t border-border px-5 py-3 text-[13px] text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>The {d.label.toLowerCase()} doesn't match its schema: {d.problem}</span>
        </p>
      ))}
    </Card>
  );
}
