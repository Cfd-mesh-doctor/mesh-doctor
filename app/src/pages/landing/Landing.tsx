// SPDX-License-Identifier: GPL-3.0-or-later
// The public home page: what Mesh Doctor does, why the website never sees your meshes, how to start.
import {
  ArrowRight, Box, ChartLine, CircleCheck, Cpu, FlaskConical, Gauge, Globe, Image, KeyRound, Laptop, ScanSearch,
  ShieldCheck, Toolbox, Wrench, type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { PublicFooter, PublicHeader } from "@/components/layout/PublicChrome";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { Button } from "@/components/ui/button";
import { usePairing } from "@/engine/context";
import { useTitle } from "@/lib/useTitle";
import { HeroPreview } from "./HeroPreview";

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: ScanSearch,
    title: "Detect",
    text: "Scores every face with OpenFOAM's own quality formulas: non-orthogonality, skewness, weight, volume ratio and inverted pyramids.",
  },
  {
    icon: Box,
    title: "Highlight",
    text: "Groups bad faces into a handful of defect clusters and shows where they are, so you see problem regions, not thousands of faces.",
  },
  {
    icon: Wrench,
    title: "Correct",
    text: "Moves mesh points, inside the mesh. Walls keep their shape, no cell is added or removed, and a move is kept only if it makes things better.",
  },
  {
    icon: FlaskConical,
    title: "Prove",
    text: "An A/B solver test runs your case on the original and the repaired mesh with the same settings, and a judge reads residuals and forces.",
  },
];

const TOOLS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Gauge, title: "Convergence judge", text: "Steady and transient verdicts from your logs and forces." },
  { icon: ChartLine, title: "Repair map", text: "Where the mesh was repaired, over where the flow will not settle." },
  { icon: Image, title: "Pictures", text: "ParaView renders of cuts, surfaces and vortices, made on your PC." },
  { icon: Toolbox, title: "More on the way", text: "Zone repair, a full-car pipeline, Excel workbooks and SolidWorks prep." },
];

function Section({ id, eyebrow, title, lead, children }: { id?: string; eyebrow: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-[13px] font-semibold tracking-wide text-primary uppercase">{eyebrow}</p>
        <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
        {lead && <p className="mt-4 max-w-2xl text-base text-muted-foreground">{lead}</p>}
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

function FlowBox({ icon: Icon, title, sub, accent }: { icon: LucideIcon; title: string; sub: string; accent?: boolean }) {
  return (
    <div className={accent ? "rounded-xl border border-primary/30 bg-primary-soft p-5" : "rounded-xl border border-border bg-surface p-5 shadow-card"}>
      <Icon className={accent ? "size-5 text-primary" : "size-5 text-muted-foreground"} />
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium text-muted-foreground lg:px-1">
      <span className="hidden lg:block">{label}</span>
      <ArrowRight className="size-4 rotate-90 lg:rotate-0" />
      <span className="lg:hidden">{label}</span>
    </div>
  );
}

export function Landing() {
  useTitle();
  const { pairing } = usePairing();
  const appLink = pairing ? "/app" : "/connect";
  return (
    <div className="min-h-dvh">
      <PublicHeader />

      <main>
        <section className="relative overflow-hidden border-b border-border">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_1px_1px,var(--border)_1px,transparent_0)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]"
          />
          <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[13px] font-medium text-muted-foreground shadow-card">
                <span className="size-1.5 rounded-full bg-primary" /> Open source · runs on your own PC
              </span>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.4rem] lg:leading-[1.05]">
                Find and fix <span className="text-primary">bad cells</span> in OpenFOAM meshes
              </h1>
              <p className="mt-6 max-w-xl text-lg text-muted-foreground">
                Mesh Doctor checks your mesh, shows where the bad cells are and repairs them inside the mesh, then proves
                it helped with an A/B solver test. Your CAD and your case are never touched.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button size="lg" asChild>
                  <Link to={appLink}>{pairing ? "Open the app" : "Connect your engine"} <ArrowRight /></Link>
                </Button>
                <Button size="lg" variant="secondary" asChild>
                  <Link to="/demo">Explore the demo</Link>
                </Button>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
                {["OpenFOAM 14", "Windows (WSL) or Linux", "Free, GPL-3.0"].map((t) => (
                  <li key={t} className="inline-flex items-center gap-1.5">
                    <CircleCheck className="size-4 text-success" /> {t}
                  </li>
                ))}
              </ul>
            </div>
            <HeroPreview />
          </div>
        </section>

        <Section
          id="how"
          eyebrow="How it works"
          title="Detect, highlight, correct, prove"
          lead="The repair needs only the mesh. The checks that it helped run your case on both meshes and compare."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <div key={s.title} className="rounded-xl border border-border bg-surface p-5 shadow-card">
                <div className="flex items-center justify-between">
                  <span className="grid size-9 place-items-center rounded-lg bg-primary-soft text-primary">
                    <s.icon className="size-[18px]" />
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
                </div>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{s.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TOOLS.map((t) => (
              <div key={t.title} className="flex gap-3 rounded-xl border border-dashed border-border p-4">
                <t.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{t.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-primary">
            <Link to="/how-it-works" className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline">
              How each step works, and the command behind it <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link to="/accuracy" className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline">
              How close it gets to a wind tunnel <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link to="/gallery" className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline">
              The pictures it makes <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </Section>

        <div className="border-y border-border bg-surface-2/60">
          <Section
            id="privacy"
            eyebrow="Privacy by design"
            title="Your meshes never leave your computer"
            lead="This website is only the screens. The work happens in Mesh Doctor on your PC, and your browser talks to it directly."
          >
            <div className="grid grid-cols-1 items-stretch gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
              <FlowBox icon={Globe} title="This website" sub="Static files: no server code, no accounts, no analytics, no uploads." />
              <Arrow label="loads the page" />
              <FlowBox icon={Laptop} title="Your browser" sub="Runs the screens and asks you before the page may reach apps on your device." />
              <Arrow label="localhost only" />
              <FlowBox icon={Cpu} title="Mesh Doctor on your PC" sub="OpenFOAM in WSL or Linux. Your cases, results and pictures stay here." accent />
            </div>
            <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
              {[
                [KeyRound, "Paired, not signed in", "A pairing key links one browser to your engine. The key travels after the # in a link, which never reaches the website."],
                [ShieldCheck, "Only this site, only with the key", "The engine answers this site's address and no other, and every request must carry the key."],
                [Wrench, "Every job works on a copy", "Your source case is only ever read. A checksum taken before and after proves it."],
              ].map(([Icon, title, text]) => {
                const I = Icon as LucideIcon;
                return (
                  <div key={title as string}>
                    <I className="size-5 text-primary" />
                    <p className="mt-3 text-sm font-semibold">{title as string}</p>
                    <p className="mt-1 text-[13.5px] text-muted-foreground">{text as string}</p>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        <Section id="start" eyebrow="Get started" title="Running in three steps" lead="One script to install, one command to start, one link to pair this browser.">
          {/* grid-cols-1: on the smallest phones a long command scrolls inside its box instead of widening the page */}
          <ol className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {[
              ["Install", "From a clone of the repository, one script installs WSL, OpenFOAM 14 and Mesh Doctor, and checks the result.", "bash tools/setup_linux.sh"],
              ["Start and pair", "Start the engine. It prints a pairing link for this site; open it in Chrome, Edge or Firefox.", "meshdoctor serve"],
              ["Repair and prove", "Repair a copy of your case, then test it with an A/B solver run. The results show up in the app.", "meshdoctor full <case> <name>"],
            ].map(([title, text, cmd], i) => (
              <li key={title} className="flex flex-col rounded-xl border border-border bg-surface p-5 shadow-card">
                <span className="font-mono text-xs text-muted-foreground">Step {i + 1}</span>
                <p className="mt-2 font-semibold">{title}</p>
                <p className="mt-1.5 flex-1 text-[13.5px] text-muted-foreground">{text}</p>
                <CopyCommand command={cmd as string} className="mt-4" />
              </li>
            ))}
          </ol>
          <p className="mt-6 text-[13px] text-muted-foreground">
            On Windows, run <code>tools\setup_windows.ps1</code> instead of step 1. Full instructions, Docker and cluster
            set-ups are on the{" "}
            <Link to="/install" className="font-medium text-primary hover:underline">install page</Link>.
            Got a report file from someone? Open it in the{" "}
            <Link to="/report" className="font-medium text-primary hover:underline">report viewer</Link>: it needs no
            install, and the file stays in your browser.
          </p>
        </Section>

        <section className="px-4 pb-24 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 rounded-2xl bg-foreground px-8 py-10 text-background sm:flex-row sm:items-center sm:px-12">
            <div className="flex-1">
              <h2 className="text-2xl font-semibold tracking-tight">See it with real data first</h2>
              <p className="mt-2 max-w-xl text-[15px] opacity-75">
                The demo is a recorded run of the public Ahmed-body example: real repairs, real A/B tests, nothing to install.
              </p>
            </div>
            <Button size="lg" asChild className="bg-background text-foreground hover:bg-background/90">
              <Link to="/demo">Open the demo <ArrowRight /></Link>
            </Button>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
