// SPDX-License-Identifier: GPL-3.0-or-later
// The size estimator: will a case fit in memory, how long will the solve take, what would a cloud machine
// cost? Rough answers from measured runs, worked out in the page (no engine needed, nothing is sent). The
// fields live in the address, so an estimate can be bookmarked or shared as a link.
import { Cloud, Cpu, Laptop, MemoryStick, RotateCcw, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { PublicFooter, PublicHeader } from "@/components/layout/PublicChrome";
import { PageHeader, StatTile } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatInt } from "@/lib/format";
import { useTitle } from "@/lib/useTitle";
import { cn } from "@/lib/utils";
import {
  CLOUD_VM, DEFAULTS, HEADROOM, LIMITS, SIMSCALE, coreHours, duration, estimate, gigabytes, money, parseField,
  type EstimateInput, type Field,
} from "@/estimate/estimate";

const FIELDS: { key: Field; param: string; label: string; unit: string; hint: string }[] = [
  { key: "cells", param: "cells", label: "Mesh size", unit: "million cells", hint: "The cell count checkMesh prints, in millions." },
  { key: "iterations", param: "iters", label: "Iterations", unit: "iterations", hint: "Steady car and wheel cases needed 1000 to 1500 or more to settle." },
  { key: "ram", param: "ram", label: "Memory for OpenFOAM", unit: "GB", hint: "What WSL may use: about 26 GB on a 32 GB PC." },
  { key: "cores", param: "cores", label: "Solver ranks on this computer", unit: "ranks", hint: "Physical cores, not threads." },
  { key: "price", param: "price", label: "Cloud machine price", unit: "$ per hour", hint: "12 vCPU, 96 GB; $0.84 is a custom N2 on Google Cloud at list price." },
];

const range = (k: Field) => {
  const { min, max, integer } = LIMITS[k];
  return `Enter ${integer ? "a whole number" : "a number"} from ${min} to ${formatInt(max)}.`;
};

export function Estimate() {
  useTitle("Size estimator");
  const [params, setParams] = useSearchParams();
  const text = (f: (typeof FIELDS)[number]) => params.get(f.param) ?? String(DEFAULTS[f.key]);
  const values = FIELDS.map((f) => [f.key, parseField(f.key, text(f))] as const);
  const input = values.every(([, v]) => v != null)
    ? (Object.fromEntries(values) as unknown as EstimateInput)
    : null;
  const result = input ? estimate(input) : null;
  const changed = FIELDS.some((f) => params.has(f.param));

  const set = (f: (typeof FIELDS)[number], value: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === String(DEFAULTS[f.key])) next.delete(f.param);
      else next.set(f.param, value);
      return next;
    }, { replace: true, preventScrollReset: true });

  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <PageHeader
          title="Size estimator"
          description={
            "Will a case fit in your computer's memory, how long will the solve take, and what would a cloud machine " +
            "cost? Rough answers (±30\u00a0%) from measured runs, worked out in this page: nothing is sent anywhere."
          }
        />
        {/* grid-cols-1, not the default: a wide table then scrolls inside its card instead of widening the page */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Your case</CardTitle>
                <CardDescription>The address keeps these, so a link brings the estimate back.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {FIELDS.map((f) => {
                const bad = parseField(f.key, text(f)) == null;
                const integer = LIMITS[f.key].integer;
                return (
                  <div key={f.key}>
                    <label htmlFor={`est-${f.key}`} className="text-[13px] font-medium">{f.label}</label>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Input
                        id={`est-${f.key}`}
                        value={text(f)}
                        onChange={(e) => set(f, e.target.value)}
                        inputMode={integer ? "numeric" : "decimal"}
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={bad || undefined}
                        aria-describedby={`est-${f.key}-hint`}
                        className={cn("w-28 tabular-nums", bad && "border-danger")}
                      />
                      <span className="text-sm text-muted-foreground">{f.unit}</span>
                    </div>
                    <p id={`est-${f.key}-hint`} className={cn("mt-1 text-xs", bad ? "text-danger" : "text-muted-foreground")}>
                      {bad ? range(f.key) : f.hint}
                    </p>
                  </div>
                );
              })}
              {changed && (
                <Button variant="secondary" size="sm"
                  onClick={() => setParams(new URLSearchParams(), { replace: true, preventScrollReset: true })}>
                  <RotateCcw /> Back to the example
                </Button>
              )}
            </CardContent>
          </Card>

          {!input || !result ? (
            <Card className="p-5 text-sm text-muted-foreground" role="status">
              Fill in every field with a number in range to see the estimate.
            </Card>
          ) : (
            <Results input={input} result={result} />
          )}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}

function Results({ input: i, result: e }: { input: EstimateInput; result: ReturnType<typeof estimate> }) {
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatTile label="Biggest memory need" value={gigabytes(e.peak.gb)} icon={MemoryStick}
          hint={`${e.peak.label}; ${e.peak.fits ? "fits in" : "too big for"} ${i.ram} GB`}
          tone={e.peak.fits ? "success" : "danger"} />
        <StatTile label="Solve on this computer" value={duration(e.local.seconds)} icon={Laptop}
          hint={`${formatInt(i.cores)} ranks; ${e.local.fits ? "fits in memory" : "does not fit in memory"}`}
          tone={e.local.fits ? undefined : "danger"} />
        <StatTile label="Solve on a cloud machine" value={duration(e.cloud.seconds)} icon={Cloud}
          hint={`about ${money(e.cloud.cost)} at ${money(i.price)} an hour`} />
        <StatTile label="SimScale Community plan" value={`${coreHours(e.simscale.coreHours)} core h`} icon={Cpu}
          hint={e.simscale.tooBig ? `above its limit of about ${SIMSCALE.maxCells}\u00a0M cells` : "meshing and solving"}
          tone={e.simscale.tooBig ? "warning" : undefined} />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Memory, step by step</CardTitle>
            <CardDescription>
              For {formatInt(i.cells * 1e6)} cells. A step fits when it needs less than {HEADROOM * 100}&nbsp;% of
              the {i.ram} GB, leaving room for Windows and the rest.
            </CardDescription>
          </div>
        </CardHeader>
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Step</TH>
              <TH className="text-right">Needs</TH>
              <TH>With {i.ram} GB</TH>
            </TR>
          </THead>
          <TBody>
            {e.memory.map((s) => (
              <TR key={s.key}>
                <TD>
                  <span className="font-medium">{s.label}</span>
                  <span className="block text-xs text-muted-foreground">{s.note}</span>
                </TD>
                <TD className="text-right whitespace-nowrap tabular-nums">{gigabytes(s.gb)}</TD>
                <TD className="whitespace-nowrap">
                  <MemoryBar share={s.gb / i.ram} fits={s.fits} />
                  <span className={cn("text-[13px] font-medium", s.fits ? "text-success" : "text-danger")}>
                    {s.fits ? "fits" : "too big"}
                  </span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card>
        <CardHeader><CardTitle>Time and cost</CardTitle></CardHeader>
        <CardContent className="divide-y divide-border pt-0">
          <Row icon={Laptop} title={`On this computer, ${formatInt(i.cores)} ranks`} value={duration(e.local.seconds)}
            note={"Measured on a laptop-class CPU: a 0.84\u00a0M-cell Ahmed body ran at about 1.3 s per iteration on 6 ranks."}
            warn={!e.local.fits && `The solver needs ${gigabytes(e.memory[1]!.gb)}, more than ${HEADROOM * 100}\u00a0% of ` +
              `${i.ram} GB: use a cloud machine or a smaller mesh.`} />
          <Row icon={Cloud} title={`Cloud machine, ${CLOUD_VM.vcpus} vCPU and ${CLOUD_VM.ram} GB, ${CLOUD_VM.ranks} ranks`}
            value={`${duration(e.cloud.seconds)}, ${money(e.cloud.cost)}`}
            note={`At ${money(i.price)} an hour, with about ${CLOUD_VM.setupSeconds / 60} min to install, download, ` +
              "decompose and upload. Measured on a 31\u00a0M-cell car at 67 s per iteration."}
            warn={!e.cloud.decomposeFits && `decomposePar needs about ${gigabytes(e.cloud.decomposeGB)}, more than ` +
              "the machine can give: decompose on a computer with more memory first, or use a bigger machine."} />
          <Row icon={Cpu} title="SimScale Community plan" value={`${coreHours(e.simscale.coreHours)} core hours`}
            note={`Meshing plus ${formatInt(i.iterations)} iterations, from 3.8 to 10\u00a0M-cell runs.`}
            warn={e.simscale.tooBig && `Above about ${SIMSCALE.maxCells}\u00a0M cells the plan's solver ran out of memory: ` +
              "trim the mesh."} />
        </CardContent>
      </Card>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Every number comes from a real run: OpenFOAM 14, incompressible steady k-omega SST on snappyHexMesh meshes.
        Treat them as ±30&nbsp;%: the CPU, the mesh quality and the function objects all change the time.
      </p>
    </div>
  );
}

function MemoryBar({ share, fits }: { share: number; fits: boolean }) {
  return (
    <span className="relative mr-2 hidden h-2 w-24 rounded-full bg-surface-2 align-middle ring-1 ring-border ring-inset sm:inline-block" aria-hidden>
      <span className={cn("absolute inset-y-0 left-0 rounded-full", fits ? "bg-success" : "bg-danger")}
        style={{ width: `${Math.min(1, share) * 100}%` }} />
      <span className="absolute -inset-y-0.5 w-px bg-muted-foreground" style={{ left: `${HEADROOM * 100}%` }} />
    </span>
  );
}

function Row({ icon: Icon, title, value, note, warn }: {
  icon: LucideIcon; title: string; value: string; note: string; warn: string | false;
}) {
  return (
    <div className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm font-semibold tabular-nums">about {value}</p>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
        {warn && <Warn>{warn}</Warn>}
      </div>
    </div>
  );
}

function Warn({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 flex gap-1.5 rounded-lg bg-warning-soft px-2.5 py-1.5 text-xs text-foreground">
      <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
