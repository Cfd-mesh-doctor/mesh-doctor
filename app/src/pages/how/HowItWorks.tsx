// SPDX-License-Identifier: GPL-3.0-or-later
// "How it works": the repair and the checks that it helped, step by step, from docs/how-it-works.md. The tables
// come from tables.ts, which a test keeps equal to the doc's.
import {
  ArrowRight, Box, Calculator, ChartLine, CirclePlay, FileSearch, FlaskConical, Gauge, Info, LayoutDashboard,
  ScanSearch, Wrench, type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { PublicFooter, PublicHeader } from "@/components/layout/PublicChrome";
import { PageContents } from "@/components/shared/PageContents";
import { PageHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { DocTableView } from "@/components/shared/DocTable";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DOCS } from "@/lib/site";
import { useTitle } from "@/lib/useTitle";
import { aboutPage } from "@/pages/docs/entries";
import { HeadingLink } from "@/pages/docs/HeadingLink";
import { COMMANDS, PROFILES, VERDICTS } from "./tables";

const SECTIONS = [
  { id: "detect", title: "Detect", icon: ScanSearch },
  { id: "highlight", title: "Highlight", icon: Box },
  { id: "correct", title: "Correct", icon: Wrench },
  { id: "ab-test", title: "Did it help? The A/B test", icon: FlaskConical },
  { id: "judge", title: "The convergence judge", icon: Gauge },
  { id: "hotspots", title: "Hotspots and the map", icon: ChartLine },
  { id: "dashboard", title: "The dashboard", icon: LayoutDashboard },
] as const satisfies readonly { id: string; title: string; icon: LucideIcon }[];

type Section = (typeof SECTIONS)[number];

const link = "font-medium text-primary underline-offset-4 hover:underline";
const list = "list-disc space-y-1.5 pl-5 marker:text-muted-foreground";

function Doc({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className={link}>{children}</a>;
}

function Step({ s, n, children }: { s: Section; n: number; children: ReactNode }) {
  return (
    <section id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-20 border-t border-border pt-10">
      <div className="group flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
          <s.icon className="size-[18px]" aria-hidden />
        </span>
        <h2 id={`${s.id}-title`} className="text-xl font-semibold tracking-tight">
          <span className="mr-2 font-mono text-sm font-normal text-muted-foreground" aria-hidden>0{n}</span>
          {s.title}
        </h2>
        <HeadingLink id={s.id} title={s.title} />
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <h3 className="pt-2 text-base font-semibold">{children}</h3>;
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-border bg-surface-2/60 p-4 text-sm leading-relaxed">
      <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** A face's badness, from fine to turned inside out. */
function BadnessScale() {
  return (
    <figure className="rounded-xl border border-border bg-surface p-4">
      <div className="grid grid-cols-1 gap-1 text-xs font-medium sm:grid-cols-[1fr_2fr_1fr]">
        <div className="rounded-md bg-success-soft px-3 py-2 text-success">1 or less: meets every target</div>
        <div className="rounded-md bg-warning-soft px-3 py-2 text-warning">over 1: misses a target</div>
        <div className="rounded-md bg-danger-soft px-3 py-2 text-danger">100 or more: an inverted pyramid</div>
      </div>
      <figcaption className="mt-3 text-[13px] text-muted-foreground">
        A face's <strong className="font-semibold text-foreground">badness</strong> is its worst metric divided by
        its target, for example <code>nonOrtho / 65</code> or <code>0.05 / weight</code>.
      </figcaption>
    </figure>
  );
}

/** What `full` runs, in order. */
function Pipeline() {
  const steps = ["copy", "checkMesh", "fix", "checkMesh", "result.json"];
  return (
    <ol className="flex flex-wrap items-center gap-2 text-[13px]" aria-label="What full runs, in order">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-2">
          {i > 0 && <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />}
          <span className="rounded-md border border-border bg-surface px-2 py-1 font-mono">{s}</span>
        </li>
      ))}
    </ol>
  );
}

export function HowItWorks() {
  useTitle("How it works", aboutPage("/how-it-works"));
  const [detect, highlight, correct, abTest, judge, hotspots, dashboard] = SECTIONS;
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <PageHeader
          title="How Mesh Doctor works"
          description={
            "The repair looks only at the mesh and needs no simulation results. The checks that it helped run or " +
            "read a simulation. Here is each step, and the command behind it."
          }
        />
        {/* grid-cols-1, not the default: a wide table then scrolls inside its card instead of widening the page */}
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
          <aside className="rounded-xl border border-border bg-surface p-3 shadow-card lg:sticky lg:top-24 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
            <PageContents sections={SECTIONS} numbered />
          </aside>

          <article className="max-w-3xl min-w-0 space-y-10 text-[15px] leading-7 break-words">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card className="p-5">
                <Wrench className="size-5 text-primary" aria-hidden />
                <p className="mt-3 font-semibold">The repair</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Finds bad faces, shows where they are and corrects them on a copy. It needs only the mesh.
                </p>
              </Card>
              <Card className="p-5">
                <FlaskConical className="size-5 text-primary" aria-hidden />
                <p className="mt-3 font-semibold">The checks that it helped</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Solve both meshes and compare them, judge convergence, and draw the repairs over where the flow
                  won't settle.
                </p>
              </Card>
            </div>

            <Card className="overflow-hidden">
              <CardHeader>
                <div>
                  <CardTitle>Each step is a command</CardTitle>
                  <CardDescription>
                    They all run on your PC: on the command line, or started from the engine's pages.
                  </CardDescription>
                </div>
              </CardHeader>
              <div className="border-t border-border">
                <DocTableView table={COMMANDS} caption="What each command needs and gives" />
              </div>
            </Card>

            <Step s={detect} n={1}>
              <p>
                <code>foamMeshDoctor</code>, an OpenFOAM 14 utility, scores every face with OpenFOAM's own quality
                formulas, the same ones <code>checkMesh</code> and <code>snappyHexMesh</code> use:
              </p>
              <ul className={list}>
                <li>non-orthogonality;</li>
                <li>skewness (internal and boundary faces);</li>
                <li>face weight;</li>
                <li>the volume ratio of the two cells either side;</li>
                <li>face pyramids (an inverted pyramid means a cell is turned inside out).</li>
              </ul>
              <BadnessScale />
              <p>The targets come from a profile. Choose one with <code>--profile strict</code>.</p>
              <Card className="overflow-hidden">
                <DocTableView table={PROFILES} caption="The targets of each profile" />
              </Card>
              <p>
                Bad faces close together are grouped into <strong>defect clusters</strong>, so you see a handful of
                problem regions rather than thousands of faces.
              </p>
            </Step>

            <Step s={highlight} n={2}>
              <p>
                The worst faces, the cells around them and the nearby wall faces are written to{" "}
                <code>&lt;copy&gt;/meshDoctor/</code>, and the engine's Mesh Doctor page shows them in 3D, with the
                clusters listed by size. <code>inspect</code> stops here.
              </p>
            </Step>

            <Step s={correct} n={3}>
              <p>
                <code>fix</code> runs <code>foamMeshDoctor -fix</code> on the copy. It only{" "}
                <strong>moves mesh points</strong>:
              </p>
              <ul className={list}>
                <li>no cells are added or removed, so the decomposition, fields and patch names stay valid;</li>
                <li>
                  points on walls may slide only along the wall: inside the plane on flat patches, back onto the
                  original surface on smooth curved walls, and along the original edge on feature edges. Corners,
                  sharp edges, patch-to-patch junctions and processor boundaries never move, so the geometry is kept;
                </li>
                <li>
                  a point move is kept only if the worst face around that point gets better (or stays equal while
                  the total badness drops), and no face pyramid or cell volume becomes invalid. The local worst
                  quality can never get worse;
                </li>
                <li>passes repeat while they still help (up to 3).</li>
              </ul>
              <Note>
                Some faces can't be fixed by moving points, typically inverted pyramids squeezed between walls. For
                those, <code>fix</code> collapses just those faces with OpenFOAM's <code>collapseEdges</code>, smooths
                with one more pass, and keeps the result only if <code>checkMesh</code> shows no regression; otherwise
                it puts the mesh back. That step changes the topology (a few faces and points fewer), so the A/B test
                can't be used on such a copy. See the <Link to="/limits" className={link}>limits</Link>.
              </Note>
              <p><code>full</code> does the whole repair on a copy:</p>
              <Pipeline />
              <p>Its <code>&lt;copy&gt;/meshDoctor/result.json</code> records:</p>
              <ul className={list}>
                <li>every command run, with its log and exit code;</li>
                <li>the OpenFOAM version;</li>
                <li>
                  checkMesh before and after, and the verdict (<code>improved</code>, <code>regressions</code>,{" "}
                  <code>unchanged</code>);
                </li>
                <li>the defect clusters before and after;</li>
                <li>the largest point move;</li>
                <li>
                  a checksum of the source case taken before and after (see the{" "}
                  <Link to="/safety" className={link}>safety model</Link>).
                </li>
              </ul>
            </Step>

            <Step s={abTest} n={4}>
              <p>
                <code>meshdoctor ab &lt;case&gt; &lt;name&gt;</code> makes two copies of your case with the{" "}
                <strong>same setup</strong>: one with the original mesh, one with the repaired points. It solves both
                with <code>foamRun</code> for <code>--iters</code> iterations on <code>--np</code> cores. Both runs get
                the same split across cores (scotch, which depends only on the mesh connectivity), so the only
                difference is where the points are. A case without a <code>system/decomposeParDict</code> (one you
                run in serial) gets one in both copies.
              </p>
              <p>Its <code>ab_result.json</code> holds, for both runs:</p>
              <ul className={list}>
                <li>
                  residual levels, and the ratio repaired / original for each field (below 1 means the repaired mesh
                  converges further);
                </li>
                <li>force means and how much they oscillate;</li>
                <li>seconds per iteration;</li>
                <li>the residual hotspots (step 06).</li>
              </ul>
              <Sub>Options</Sub>
              <ul className={list}>
                <li>
                  <code>--init 0</code> starts both from the case's <code>0/</code> fields; <code>--init 0.warm</code>{" "}
                  or another folder starts from a solution you already have. Without <code>--init</code>, they start
                  from <code>0.warm</code> when the case has one, else from <code>0/</code>.
                </li>
                <li>
                  <code>--variant simplec|simplec2|relax|lts</code> changes a solver setting on the second run
                  instead. With <code>-</code> as the name, it compares a setting on the original mesh only.
                </li>
                <li><code>ab extend &lt;abDir&gt; &lt;endIter&gt;</code> continues the second run further.</li>
              </ul>
              <p>
                See one: <Link to="/report?sample=ahmed25-medium-fix" className={link}>the 25° sample</Link> in the
                report viewer has an A/B test with both runs' residuals.
              </p>
            </Step>

            <Step s={judge} n={5}>
              <p>
                <code>meshdoctor judge &lt;case&gt; [window|auto] [--to N]</code> compares the last{" "}
                <code>window</code> iterations with the ones before (<code>auto</code>: half the run, 10 to 200).{" "}
                <code>--to N</code> judges the run as it was at iteration N, leaving out what came after, so two runs
                can be judged over the same iterations. It reads residuals from the <code>residuals</code> function
                object, or else from <code>log.foamRun*</code>, and forces from <code>forces</code> or{" "}
                <code>forceCoeffs</code>.
              </p>
              <Card className="overflow-hidden">
                <DocTableView table={VERDICTS} caption="The verdicts for a steady run" />
              </Card>
              <p>Averages come with an uncertainty from batch means, so a slow swing is not hidden by a long average.</p>

              <Sub>Transient runs</Sub>
              <p>
                Any <code>ddtSchemes</code> other than <code>steadyState</code> gets its own verdict, with the window
                counted in time steps. Oscillating forces are expected there, so it asks three separate questions:
              </p>
              <ul className={list}>
                <li>are the force means stationary (drift under 2&nbsp;% between the last two windows)?</li>
                <li>did each time step converge, meaning p fell below 1e-3 by the last PIMPLE outer iteration?</li>
                <li>
                  is the time step sane: max Courant at most 1 (needed for DES/LES), and no field bounded in more than
                  5&nbsp;% of steps?
                </li>
              </ul>
              <p>
                The answer is "converged", "statistically stationary, but check: …" or "still developing", with every
                failed check named. Logs not called <code>log.foamRun*</code> are passed with <code>--log</code>.
              </p>

              <Sub>Drag and downforce</Sub>
              <p>
                Forces are reported as drag (along the flow) and the vertical force, named <strong>downforce</strong>{" "}
                or <strong>lift</strong> by its sign. The flow direction is read from <code>0/U</code>, preferring an
                inlet patch. The up axis comes from the <code>up_axis</code> setting, else the <code>liftDir</code> of{" "}
                <code>forceCoeffs</code>, else the cross-flow axis with the larger force.
              </p>

              <Sub>When a steady run cannot converge: the transient plan</Sub>
              <p>
                A steady run that plateaus on a physically unsteady flow (a wing-tip vortex, a tyre wake) will not
                converge however long it runs. The way on is a transient run with time-averaged forces, which costs
                far more. <code>meshdoctor transient-plan &lt;case&gt;</code> says how much before you start one:
              </p>
              <ul className={list}>
                <li>
                  it runs OpenFOAM's <code>CourantNo</code> function on the steady result, which gives each cell's
                  Courant number per second of time step, <code>0.5 Σ|φ| / V</code>;
                </li>
                <li>with <code>adjustTimeStep</code>, the largest of these sets the time step: <code>dt = maxCo / max</code>;</li>
                <li>
                  for each max Courant number (<code>--co</code>, default 1, 5 and 20) it gives the time step, the
                  number of steps for the flow time, and the hours, from the steady run's seconds per iteration and{" "}
                  <code>--outer</code> PIMPLE iterations per step (default 3);
                </li>
                <li>
                  the flow time is <code>--flow-time</code>, or 8 body lengths of flow from <code>--length</code> or a{" "}
                  <code>forceCoeffs</code> <code>lRef</code>; without one, the plan gives hours per 0.1&nbsp;s of flow;
                </li>
                <li>
                  it finds the 100 fastest cells (<code>--top</code>), groups them by place, and says how much larger
                  the time step would be without them. A few tiny cells often set the time step for the whole mesh.
                </li>
              </ul>
              <p>
                The case is only read: OpenFOAM runs in a temporary shadow case whose mesh, settings and flux are links
                to it. DES and LES need max Co ≤ 1. URANS with enough outer correctors usually runs higher, so the plan
                shows both.
              </p>
            </Step>

            <Step s={hotspots} n={6}>
              <p>
                <code>foamResidualHotspots</code> finds the cells where the solution still changes most: over one
                iteration (a residual map), or between two written times (<code>ab mode</code>), which catches a slow
                oscillation's shape.
              </p>
              <p>
                The A/B test reports what share of the top hotspot cells lies near the defect clusters, for each mesh.
                If hotspots sit on defects in the original and move away after the repair, the bad cells were what
                held the run back.
              </p>
              <p>
                <code>meshdoctor map &lt;name&gt; --hot "Label=&lt;case&gt;"</code> draws the defect clusters before
                and after repair, and the top hotspot cells of each layer, on side and top views of the model. The
                ground plane is found from the geometry and left out of the drawing; its normal is taken as "up".
              </p>
              <p>
                See one: <Link to="/report?sample=ahmed35-medium-fix" className={link}>the 35° sample</Link> in the
                report viewer has a repair map with 26 defects found and repaired.
              </p>
            </Step>

            <Step s={dashboard} n={7}>
              <p>
                <code>meshdoctor serve</code> shows four pages (see the{" "}
                <Link to="/dashboard-tour" className={link}>dashboard tour</Link>):
              </p>
              <ul className={list}>
                <li><code>/meshdoctor</code>: start repairs and A/B tests, view highlighted cells and results;</li>
                <li><code>/meshmap</code>: the map;</li>
                <li><code>/run</code>: a steady run as it happens (residuals, forces and the live judge);</li>
                <li>
                  <code>/</code>: a transient run as it happens (forces, averaging window, time step), and the
                  transient judge's three answers for it, refreshed once a minute.
                </li>
              </ul>
              <p>
                Starting a job from a page runs the same commands as the command line. This website's app is another
                set of screens for the same engine: <Link to="/connect" className={link}>pair it</Link> once, or look
                around the <Link to="/demo" className={link}>demo</Link> first.
              </p>
            </Step>

            <Card className="p-5">
              <p className="font-semibold">See it on real data</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The report viewer opens sample reports from the public Ahmed-body example, the demo shows the app on
                recorded answers, and the estimator sizes your own case. None of them needs the engine.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" asChild><Link to="/report"><FileSearch />Report viewer</Link></Button>
                <Button size="sm" variant="secondary" asChild><Link to="/demo"><CirclePlay />Demo</Link></Button>
                <Button size="sm" variant="secondary" asChild><Link to="/estimate"><Calculator />Size estimator</Link></Button>
              </div>
              <p className="mt-4 text-[13px] text-muted-foreground">
                How close are the answers? The <Link to="/accuracy" className={link}>accuracy check</Link> compares
                the whole chain with a wind tunnel. This page follows{" "}
                <Doc href={DOCS.howItWorks}>docs/how-it-works.md</Doc> in the source.
              </p>
            </Card>
          </article>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
