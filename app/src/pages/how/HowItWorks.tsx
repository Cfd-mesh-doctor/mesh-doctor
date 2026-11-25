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
import { InlineCode } from "@/components/shared/InlineCode";
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
        its target, for example <InlineCode text="nonOrtho / 65" /> or <InlineCode text="0.05 / weight" trail="." />
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
                    They all run on your PC: on the command line, or started from the web app or the engine's dashboard.
                  </CardDescription>
                </div>
              </CardHeader>
              <div className="border-t border-border">
                <DocTableView table={COMMANDS} caption="What each command needs and gives" />
              </div>
            </Card>

            <Step s={detect} n={1}>
              <p>
                <InlineCode text="foamMeshDoctor" trail="," /> an OpenFOAM 14 utility, scores every face with OpenFOAM's own quality
                formulas, the same ones <InlineCode text="checkMesh" /> and <InlineCode text="snappyHexMesh" /> use:
              </p>
              <ul className={list}>
                <li>non-orthogonality;</li>
                <li>skewness (internal and boundary faces);</li>
                <li>face weight;</li>
                <li>the volume ratio of the two cells either side;</li>
                <li>face pyramids (an inverted pyramid means a cell is turned inside out).</li>
              </ul>
              <BadnessScale />
              <p>The targets come from a profile. Choose one with <InlineCode text="--profile strict" trail="." /></p>
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
                <InlineCode text={"<copy>/meshDoctor/"} trail="," /> and the engine's Mesh Doctor page shows them in 3D, with the
                clusters listed by size. <InlineCode text="inspect" /> stops here.
              </p>
            </Step>

            <Step s={correct} n={3}>
              <p>
                <InlineCode text="fix" /> runs <InlineCode text="foamMeshDoctor -fix" /> on the copy. It only{" "}
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
                those, <InlineCode text="fix" /> collapses just those faces with OpenFOAM's <InlineCode text="collapseEdges" trail="," /> smooths
                with one more pass, and keeps the result only if <InlineCode text="checkMesh" /> shows no regression; otherwise
                it puts the mesh back. That step changes the topology (a few faces and points fewer), so the A/B test
                can't be used on such a copy. See the <Link to="/limits" className={link}>limits</Link>.
              </Note>
              <p><InlineCode text="full" /> does the whole repair on a copy:</p>
              <Pipeline />
              <p>Its <InlineCode text={"<copy>/meshDoctor/result.json"} /> records:</p>
              <ul className={list}>
                <li>every command run, with its log and exit code;</li>
                <li>the OpenFOAM version;</li>
                <li>
                  checkMesh before and after, and the verdict <InlineCode lead="(" text="improved" trail="," /> <InlineCode text="regressions" trail="," />{" "}
                  <InlineCode text="unchanged" trail=");" />
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
                <InlineCode text={"meshdoctor ab <case> <name>"} /> makes two copies of your case with the{" "}
                <strong>same setup</strong>: one with the original mesh, one with the repaired points. It solves both
                with <InlineCode text="foamRun" /> for <InlineCode text="--iters" /> iterations on <InlineCode text="--np" /> cores. Both runs get
                the same split across cores (scotch, which depends only on the mesh connectivity), so the only
                difference is where the points are. A case without a <InlineCode text="system/decomposeParDict" /> (one you
                run in serial) gets one in both copies.
              </p>
              <p>Its <InlineCode text="ab_result.json" /> holds, for both runs:</p>
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
                  <InlineCode text="--init 0" /> starts both from the case's <InlineCode text="0/" /> fields; <InlineCode text="--init 0.warm" />{" "}
                  or another folder starts from a solution you already have. Without <InlineCode text="--init" trail="," /> they start
                  from <InlineCode text="0.warm" /> when the case has one, else from <InlineCode text="0/" trail="." />
                </li>
                <li>
                  <InlineCode text="--variant simplec|simplec2|relax|lts" /> changes a solver setting on the second run
                  instead. With <InlineCode text="-" /> as the name, it compares a setting on the original mesh only.
                </li>
                <li>
                  <InlineCode text={"ab extend <name> <endIter>"} /> continues the second run to iteration{" "}
                  <InlineCode text={"<endIter>"} trail=";" /> give it the same <InlineCode text={"<name>"} trail="," /> or the A/B test's folder.
                </li>
              </ul>
              <p>
                See one: <Link to="/report?sample=ahmed25-medium-fix" className={link}>the 25° sample</Link> in the
                report viewer has an A/B test with both runs' residuals.
              </p>
            </Step>

            <Step s={judge} n={5}>
              <p>
                <InlineCode text={"meshdoctor judge <case> [window|auto] [--to N]"} /> compares the last{" "}
                <InlineCode text="window" /> iterations with the ones before <InlineCode lead="(" text="auto" trail=":" /> half the run, 10 to 200).{" "}
                <InlineCode text="--to N" /> judges the run as it was at iteration N, leaving out what came after, so two runs
                can be judged over the same iterations. It reads residuals from the <InlineCode text="residuals" /> function
                object, or else from <InlineCode text="log.foamRun*" trail="," /> and forces from <InlineCode text="forces" /> or{" "}
                <InlineCode text="forceCoeffs" trail="." />
              </p>
              <Card className="overflow-hidden">
                <DocTableView table={VERDICTS} caption="The verdicts for a steady run" />
              </Card>
              <p>Averages come with an uncertainty from batch means, so a slow swing is not hidden by a long average.</p>

              <Sub>Transient runs</Sub>
              <p>
                Any <InlineCode text="ddtSchemes" /> other than <InlineCode text="steadyState" /> gets its own verdict, with the window
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
                failed check named. Logs not called <InlineCode text="log.foamRun*" /> are passed with <InlineCode text="--log" trail="." />
              </p>
              <p>
                The means start where the forces settled: MSER-5, a standard rule for cutting off the start of a run,
                finds for the drag and for the vertical force the start that makes the mean's standard error least,
                looking in the first half of the run only. Once both have settled, the means are from the later of the
                two <InlineCode lead="(" text="settled" trail=");" /> until then they are over the last two windows.
              </p>

              <Sub>Drag and downforce</Sub>
              <p>
                Forces are reported as drag (along the flow) and the vertical force, named <strong>downforce</strong>{" "}
                or <strong>lift</strong> by its sign. The flow direction is read from <InlineCode text="0/U" trail="," /> preferring an
                inlet patch. The up axis comes from the <InlineCode text="up_axis" /> setting, else the <InlineCode text="liftDir" /> of{" "}
                <InlineCode text="forceCoeffs" trail="," /> else the cross-flow axis with the larger force.
              </p>

              <Sub>A solved case's results</Sub>
              <p>
                <InlineCode text={"meshdoctor results <case> [--from T] [--to T] [--json]"} /> gives each force group's drag
                and vertical force over an averaging window: the judge's by default (a steady run's last two judge
                windows, a transient run's from when its forces settled), or the one <InlineCode text="--from" /> and{" "}
                <InlineCode text="--to" /> give, in iterations or a transient run's seconds. For each it gives:
              </p>
              <ul className={list}>
                <li>
                  the mean, the standard deviation, the drift between the window's two halves and the uncertainty of
                  the mean from batch means, in N;
                </li>
                <li>
                  CdA and ClA (the forces over q = ½ρU²), L/D, and Cd and Cl for a group that a{" "}
                  <InlineCode text="forceCoeffs" /> function object covers, with that object's own reference area;
                </li>
                <li>each residual's first and final level and how many orders it fell, with the judge's verdict.</li>
              </ul>
              <p>
                It warns in plain words when a force still drifts by more than 1&nbsp;% over the window (run longer
                before comparing it with another run), and when the mesh has a single symmetry plane, since then the
                forces may be for half a model. It only reads the case.
              </p>
              <p>
                <InlineCode text={"meshdoctor compare <a> <b> [--from T] [--to T] [--json]"} /> averages two runs over
                the same window: up to the shorter run's end, from the later of their judges' starts. For each force
                group in both it gives b's difference from a in N and in %, and whether that is real: larger than its
                noise, which is each side's uncertainty of the mean or its drift, whichever is larger, added in
                quadrature. Otherwise the difference is inside the noise. Two cases made from the same template at two
                mesh sizes are a mesh study (as any two are with <InlineCode text="--mesh" trail=")," /> which also says whether each
                force moves less between the meshes than it swings. It warns when a design comparison's meshes differ
                by more than 2&nbsp;% in cells, when only one is a half model, when their vertical forces point
                opposite ways, and when one is still drifting.
              </p>
              <p>
                In the web app, the Results screen lists each solved case's drag and downforce or lift with its verdict
                and drift. A case's page has the table, its forces over the whole run with the averaging window shaded
                (drag its edges to average over another), and Compare…, which puts another case beside it; an A/B
                test's page has Compare forces for its two runs. The Compare screen shows the table, both sides' forces
                on one chart for each force, and the same picture of each side by side.
              </p>

              <Sub>Pictures of the flow</Sub>
              <p>
                <InlineCode text={"meshdoctor pictures <case> [--time T] [--kinds ...] [--mean]"} /> has ParaView's{" "}
                <InlineCode text="pvbatch" /> draw a solved case's flow offscreen, with the paraview-post scripts:
              </p>
              <ul className={list}>
                <li>
                  <strong>cuts</strong>: plane cuts coloured by speed, the pressure coefficient Cp or the total
                  pressure coefficient Cp,t, from the case's own <InlineCode text="cuts.json" /> (a case made from the Ahmed
                  body template has one), or three made from the model's size;
                </li>
                <li>
                  <strong>vortices</strong>: Q-criterion surfaces coloured by x-vorticity, at three levels scaled by
                  the free-stream speed;
                </li>
                <li>
                  <strong>spots</strong>: wall faces with unphysical pressure (Cp below -5, a numerical error), the
                  worst one close up;
                </li>
                <li>
                  <strong>times</strong>, only when asked: the first cut's speed at each written time up to the one
                  pictured, at most 50;
                </li>
                <li>
                  <strong>fastest</strong>, only when asked: the cells that set a transient run's time step, found as
                  the transient plan finds them, drawn with the walls.
                </li>
              </ul>
              <p>
                It pictures the latest written time unless <InlineCode text="--time" /> names another; with{" "}
                <InlineCode text="--mean" trail="," /> a transient run's mean flow, each cut also showing how much the speed swings about
                it. The case is only read: ParaView reads it through a folder of links in the workspace, and the set
                goes in the workspace's <InlineCode text={".pictures/<case>/<time>/"} trail="," /> its{" "}
                <InlineCode text="pictures.json" /> listing each picture and what it shows. The one exception is a time of a
                run Mesh Doctor made that is still split onto its processes: it is joined first{" "}
                <InlineCode lead="(" text="reconstructPar -time" trail=")" /> into the run's own folder, as its solve would. A case you made is
                read as it is, split. The scripts' cameras need the flow toward -x with z up, so a case in other axes
                is refused with the reason. A computer's first set starts with a self test, a test vortex that must
                come out red, which catches ParaView drawing nothing offscreen. Before a job starts, the engine checks
                the free memory (about 0.6 GB a million cells, more for a time read split or a cut over time) and disk
                space.
              </p>
              <p>
                In the web app, the Pictures screen lists the sets, and Make pictures… starts one: a run or a case, its
                time, the kinds and the mean flow, with the memory and disk space it needs shown first. A set's page
                shows its pictures by kind, each opening large with Download; a cut over time plays through its times.
                A solved run's page lists its own sets.
              </p>

              <Sub>When a steady run cannot converge: the transient plan</Sub>
              <p>
                A steady run that plateaus on a physically unsteady flow (a wing-tip vortex, a tyre wake) will not
                converge however long it runs. The way on is a transient run with time-averaged forces, which costs
                far more. <InlineCode text={"meshdoctor transient-plan <case>"} /> says how much before you start one:
              </p>
              <ul className={list}>
                <li>
                  it runs Mesh Doctor's <InlineCode text="foamCourantCells" /> on the steady result (OpenFOAM's{" "}
                  <InlineCode text="CourantNo" /> function where that isn't built), which gives each cell's Courant number per
                  second of time step, <InlineCode text="0.5 Σ|φ| / V" trail=";" />
                </li>
                <li>with <InlineCode text="adjustTimeStep" trail="," /> the largest of these sets the time step: <InlineCode text="dt = maxCo / max" trail=";" /></li>
                <li>
                  for each max Courant number <InlineCode lead="(" text="--co" trail="," /> default 1, 5 and 20) it gives the time step, the
                  number of steps for the flow time, and the hours, from the steady run's seconds per iteration and{" "}
                  <InlineCode text="--outer" /> PIMPLE iterations per step (default 3);
                </li>
                <li>
                  the flow time is <InlineCode text="--flow-time" trail="," /> or 8 body lengths of flow from <InlineCode text="--length" /> or a{" "}
                  <InlineCode text="forceCoeffs" /> <InlineCode text="lRef" trail=";" /> without one, the plan gives hours per 0.1&nbsp;s of flow;
                </li>
                <li>
                  it finds the 100 fastest cells <InlineCode lead="(" text="--top" trail=")," /> groups them by place, and says how much larger
                  the time step would be without them. A few tiny cells often set the time step for the whole mesh.
                  With <InlineCode text="foamCourantCells" trail="," /> each place also says what may make it fast: its nearest wall and
                  how far from it the cells are, the flow's speed there, and the cells' shape (aspect ratio and
                  non-orthogonality);
                </li>
                <li>
                  <InlineCode text={"--sets <folder>"} /> also writes those cells as the cell set{" "}
                  <InlineCode text="fastestCells" trail="," /> laid out as the case is{" "}
                  <InlineCode lead="(" text="[processorN/]constant/polyMesh/sets/fastestCells" trail="):" /> copy its folders into the case to see
                  the cells in paraFoam (Include Sets) or to pick them with <InlineCode text="topoSet" trail="." /> A case split on
                  processes gets it for each process, and for its whole mesh too where it has the one it was split
                  from: each cell is found there by its processor's <InlineCode text="cellProcAddressing" trail="." /> Without that, it
                  is for each process only (in paraFoam, a Decomposed Case), and the plan says why.
                </li>
              </ul>
              <p>
                The case is only read: OpenFOAM runs in a temporary shadow case whose mesh, settings, flux and velocity
                are links to it. DES and LES need max Co ≤ 1. URANS with enough outer correctors usually runs higher,
                so the plan shows both.
              </p>
              <p>
                In the web app, a solved run's page has Plan a transient run: the engine makes the same plan as a job
                and the page shows it, with the hours on the run's own processes and where the fastest cells are. The
                job saves their cell set in the workspace, in <InlineCode text={".tplans/<case>.sets"} trail="." /> The Cases screen
                plans a case you made the same way once it has a result: Plan a transient run, under its name.
              </p>
              <p>
                <strong>The transient run itself:</strong> <InlineCode text={"meshdoctor solve <name> --steady <run>"} />{" "}
                makes the new case <InlineCode text={"<name>"} /> a transient run of a solved steady run: its mesh, settings
                and latest result with its face flux, solved in time from there, so with no <InlineCode text="potentialFoam" trail="." />{" "}
                By default it is DDES <InlineCode lead="(" text="kOmegaSSTDES" /> with F2 shielding, so the boundary layers stay RANS and
                the wake's eddies are resolved), with second-order time steps <InlineCode lead="(" text="backward" trail=")," />{" "}
                <InlineCode text="LUST" /> for the velocity, PIMPLE with 3 outer correctors and a time step OpenFOAM adjusts to a
                largest Courant number of 1 <InlineCode lead="(" text="--co" trail=";" /> DDES takes 2 at most). Its first time step is the
                plan's, when one was made of the same result. <InlineCode text="--model URANS" /> keeps the steady run's own RAS
                model and can run at a Courant number up to 20, with its outer correctors relaxed above 1. It runs 8
                flow times over the body (8 L/U) unless <InlineCode text="--to" /> gives the time in s, and writes four times a
                stretch unless <InlineCode text="--writes W" /> asks for more or fewer (up to 200), evenly to its end, keeping
                every one: the flow at each time, for pictures of it over time;{" "}
                <InlineCode text={"meshdoctor solve <name> --to S"} /> continues it from its latest written time, and a
                continuation's <InlineCode text="--writes" /> goes for its later stretches too. On several processes each time
                stays split on them, but the latest of each stretch, which is joined: ParaView opens them all as a
                Decomposed Case.
                It averages its flow from when its forces have settled, so the start-up isn't in the average: its
                function objects go in <InlineCode text="system/functions" trail="," /> which OpenFOAM reads again when it changes as the
                run solves, with a <InlineCode text="fieldAverage" /> <InlineCode lead="(" text="UMean" trail="," /> <InlineCode text="pMean" trail="," />{" "}
                <InlineCode text="UPrime2Mean" /> and <InlineCode text="pPrime2Mean" trail=":" /> the mean flow and how much it swings) that is
                off at first. The solve checks the forces before each stretch and every half a minute as it solves, and
                switches it on once they have settled; each time written from then on holds the average, and a
                continuation carries it on. The steady run is only read.
              </p>
              <p>
                In the web app, a solved run's plan has Start a transient run: you give its name, DDES or URANS, the
                largest Courant number (the dialog shows the plan's time step, steps and hours at it), the time to
                solve to (8 L/U by default), the times it writes a stretch, each kept, with the disk space they take
                said first, and the processes. Its page follows it in seconds: its time and time step,
                its residuals and forces over time, its time step and Courant number (mean and largest) at each time
                step, and the transient judge over the last half of its time steps, its means from when the forces
                settled (shaded on the forces chart), and from when the run averages its flow, with the latest time
                written with the average, and the written times it keeps. Stop and Continue work as for a steady
                run, with the time in s; Continue asks the times it writes a stretch too.
              </p>
            </Step>

            <Step s={hotspots} n={6}>
              <p>
                <InlineCode text="foamResidualHotspots" /> finds the cells where the solution still changes most: over one
                iteration (a residual map), or between two written times <InlineCode lead="(" text="ab mode" trail=")," /> which catches a slow
                oscillation's shape.
              </p>
              <p>
                The A/B test reports what share of the top hotspot cells lies near the defect clusters, for each mesh.
                If hotspots sit on defects in the original and move away after the repair, the bad cells were what
                held the run back.
              </p>
              <p>
                <InlineCode text={"meshdoctor map <name> --hot \"Label=<case>\""} /> draws the defect clusters before
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
                <InlineCode text="meshdoctor serve" /> shows four pages (see the{" "}
                <Link to="/dashboard-tour" className={link}>dashboard tour</Link>):
              </p>
              <ul className={list}>
                <li><InlineCode text="/meshdoctor" trail=":" /> start repairs and A/B tests, view highlighted cells and results;</li>
                <li><InlineCode text="/meshmap" trail=":" /> the map;</li>
                <li><InlineCode text="/run" trail=":" /> a steady run as it happens (residuals, forces and the live judge);</li>
                <li>
                  <InlineCode text="/" trail=":" /> a transient run as it happens (forces, averaging window, time step), and the
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
