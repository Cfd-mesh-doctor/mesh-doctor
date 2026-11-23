// SPDX-License-Identifier: GPL-3.0-or-later
// Install: the README's quickstart as a page. The one-command set-ups, the same steps by hand, Docker, and what to
// do next. The commands come from commands.ts, which a test keeps equal to the README's.
import { Cable, Calculator, Info, Monitor, Play, Terminal, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { PublicFooter, PublicHeader } from "@/components/layout/PublicChrome";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { PageHeader } from "@/components/shared/page";
import { Card } from "@/components/ui/card";
import { DOCS, REPO_URL } from "@/lib/site";
import { useTitle } from "@/lib/useTitle";
import { aboutPage } from "@/pages/docs/entries";
import { DOCKER, LINUX, SETUP, WSL_INSTALL } from "./commands";

const link = "font-medium text-primary underline-offset-4 hover:underline";

function Section({ id, title, lead, children }: { id: string; title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20">
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{lead}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Platform({ icon: Icon, title, text, children }: { icon: LucideIcon; title: string; text: string; children: ReactNode }) {
  return (
    // One row on a laptop, so the longest command shows whole; text above the command on narrower screens.
    <Card className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:gap-6">
      <div className="lg:w-64 lg:shrink-0">
        <h3 className="flex items-center gap-2 font-semibold"><Icon className="size-4 text-primary" aria-hidden />{title}</h3>
        <p className="mt-1 text-[13px] text-muted-foreground">{text}</p>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </Card>
  );
}

function Next({ icon: Icon, title, text, children }: { icon: LucideIcon; title: string; text: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col p-5">
      <span className="grid size-9 place-items-center rounded-lg bg-primary-soft text-primary"><Icon className="size-4" aria-hidden /></span>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 flex-1 text-[13px] text-muted-foreground">{text}</p>
      <p className="mt-3 text-sm">{children}</p>
    </Card>
  );
}

export function Install() {
  useTitle("Install", aboutPage("/install"));
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        <PageHeader
          title="Install"
          description={
            "Mesh Doctor runs on your own computer, inside Linux: on Windows, that is WSL with Ubuntu 22.04. It needs " +
            "OpenFOAM 14 from openfoam.org and Python 3.8 or newer (numpy only for the repair map). One script sets " +
            "it all up."
          }
        />
        <div className="space-y-12">
          <Section
            id="one-command"
            title="One command"
            lead={
              <>
                Run it from a copy of <a href={REPO_URL} target="_blank" rel="noreferrer" className={link}>the
                repository</a>: a git clone, or its ZIP from GitHub. It installs only what is missing, so it is safe to
                run again, and it never touches your cases.
              </>
            }
          >
            <div className="grid grid-cols-1 gap-4">
              <Platform icon={Monitor} title="Windows 10 or 11" text="In PowerShell. Sets up WSL with Ubuntu 22.04, then runs the Linux script inside it.">
                <CopyCommand command={SETUP.windows} prompt="PS>" />
              </Platform>
              <Platform icon={Terminal} title="Ubuntu 22.04, or inside WSL" text="In a terminal. Asks for your sudo password once.">
                <CopyCommand command={SETUP.linux} />
              </Platform>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-6 text-sm md:grid-cols-2">
              <div>
                <h3 className="font-semibold">What it does</h3>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
                  <li>Installs OpenFOAM 14, numpy, matplotlib, PIL and ParaView, then builds Mesh Doctor&apos;s OpenFOAM utilities (<code className="text-foreground">./Allwmake</code>).</li>
                  <li>Makes OpenFOAM load in every new terminal.</li>
                  <li>Puts the <code className="text-foreground">meshdoctor</code> command in every new terminal too: a link in <code className="text-foreground">~/.local/bin</code>.</li>
                  <li>Ends with <code className="text-foreground">tools/toolkit_check.py</code>, which says what works.</li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold">Options</h3>
                <dl className="mt-2 space-y-1.5 text-muted-foreground">
                  <div>
                    <dt className="inline"><code className="text-foreground">-DryRun</code> or <code className="text-foreground">--dry-run</code>: </dt>
                    <dd className="inline">print the steps without running them.</dd>
                  </div>
                  <div>
                    <dt className="inline"><code className="text-foreground">-NoParaView</code> or <code className="text-foreground">--no-paraview</code>: </dt>
                    <dd className="inline">skip ParaView (about 600 MB; only the picture scripts need it).</dd>
                  </div>
                </dl>
              </div>
            </div>
            <div className="mt-6 flex gap-3 rounded-lg border border-border bg-surface-2/60 p-4 text-sm leading-relaxed">
              <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
              <p>
                <span className="font-medium">First time on Windows:</span> installing WSL needs PowerShell opened as
                administrator, and a restart. Ubuntu then opens and asks for a Linux user name and password (your choice;
                the password is for sudo). Run the script again after that.
              </p>
            </div>
          </Section>

          <Section id="by-hand" title="By hand" lead="The same steps, one at a time.">
            <div className="space-y-4">
              <Card className="p-5">
                <h3 className="font-semibold">Windows (WSL)</h3>
                <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm">
                  <li>
                    Install Ubuntu 22.04 from the Microsoft Store, or from PowerShell opened as administrator:
                    <CopyCommand command={WSL_INSTALL} prompt="PS>" className="mt-2" />
                    <span className="mt-2 block">Then follow <Link to="#linux" className={link}>Linux</Link> below, inside the Ubuntu window.</span>
                  </li>
                  <li>Start the engine inside WSL: <code>meshdoctor serve</code>.</li>
                  <li>
                    Open <code>http://localhost:8765</code> in your Windows browser. WSL forwards the port to Windows&apos;
                    own localhost only, not to the network.
                  </li>
                </ol>
                <p className="mt-4 text-[13px] text-muted-foreground">
                  Keep cases inside the WSL file system (<code>~/...</code>), not under <code>/mnt/c</code>: OpenFOAM is
                  many times slower on Windows drives.
                </p>
              </Card>

              <Card id="linux" className="scroll-mt-20 p-5">
                <h3 className="font-semibold">Linux (Ubuntu 22.04, or WSL)</h3>
                <div className="mt-3 space-y-4">
                  {LINUX.map((group) => (
                    <div key={group.title}>
                      <p className="text-[13px] font-medium text-muted-foreground">{group.title}</p>
                      <ul className="mt-2 space-y-2">
                        {group.commands.map(({ command, note }) => (
                          <li key={command}>
                            <CopyCommand command={command} />
                            {note && <p className="mt-1 pl-3 text-xs text-muted-foreground">{note}</p>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-[13px] text-muted-foreground">
                  To type just <code>meshdoctor</code>, add the clone&apos;s <code>bin/</code> folder to your PATH, or
                  link <code>bin/meshdoctor</code> into <code>~/.local/bin</code> as the setup script does. With
                  pip instead: <code className="whitespace-nowrap">pip install &quot;.[map]&quot;</code> in a virtual
                  environment (or <code className="whitespace-nowrap">pipx install .</code>); <code>./Allwmake</code> is
                  still needed for the OpenFOAM utilities.
                </p>
              </Card>

              <Card className="p-5">
                <h3 className="font-semibold">Docker (OpenFOAM included)</h3>
                <ul className="mt-3 space-y-2">
                  {DOCKER.map((command) => <li key={command}><CopyCommand command={command} /></li>)}
                </ul>
                <p className="mt-4 text-[13px] text-muted-foreground">
                  Then open <code>http://localhost:8765</code>. Cases are mounted read-only; results go to the{" "}
                  <code>meshdoctor-work</code> volume. Always publish the port as <code>127.0.0.1:8765:8765</code>:
                  plain <code>8765:8765</code> would put the dashboard on your network.
                </p>
              </Card>

              <p className="text-[13px] text-muted-foreground">
                On a university cluster (Apptainer and Slurm), see the{" "}
                <a href={DOCS.cluster} target="_blank" rel="noreferrer" className={link}>cluster steps</a> in the README.
              </p>
            </div>
          </Section>

          <Section id="next" title="Then" lead={<>Mesh Doctor is ready when <code className="text-foreground">meshdoctor check</code> says so.</>}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Next icon={Play} title="Try the motorBike tutorial" text="OpenFOAM's own case: repair, A/B test and map, about 15 to 20 minutes on 4 cores, before you use your own cases.">
                <a href={DOCS.firstRun} target="_blank" rel="noreferrer" className={link}>First run, in the README</a>
              </Next>
              <Next icon={Cable} title="Pair this site" text="Start the engine and open its pairing link once per browser, so this site can show your runs.">
                <Link to="/connect" className={link}>Connect</Link>
              </Next>
              <Next icon={Calculator} title="Size your case" text="Memory, time and disk for a mesh, before you start a job.">
                <Link to="/estimate" className={link}>Size estimator</Link>
              </Next>
            </div>
          </Section>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
