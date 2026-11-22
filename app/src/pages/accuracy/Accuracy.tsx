// SPDX-License-Identifier: GPL-3.0-or-later
// "Accuracy check": how close the toolkit's chain gets to a wind tunnel, from docs/validation.md. The numbers and
// commands come from results.ts, which a test keeps equal to the doc's.
import { Calculator, CircleCheck, Layers, Timer, TriangleAlert, Workflow, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { PublicFooter, PublicHeader } from "@/components/layout/PublicChrome";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { DocTableView } from "@/components/shared/DocTable";
import { PageHeader, StatTile } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DOCS } from "@/lib/site";
import { useTitle } from "@/lib/useTitle";
import { cn } from "@/lib/utils";
import { CdChart } from "./CdChart";
import { RESULTS, RUN, cases, readable } from "./results";

const link = "font-medium text-primary underline-offset-4 hover:underline";

function Finding({ icon: Icon, tone, title, children }: {
  icon: LucideIcon; tone: "success" | "warning"; title: string; children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <Icon className={cn("mt-0.5 size-5 shrink-0", tone === "success" ? "text-success" : "text-warning")} aria-hidden />
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

export function Accuracy() {
  useTitle("Accuracy check");
  const all = cases();
  const medium = all.find((c) => c.name.startsWith("Medium"));
  const steep = all.find((c) => c.miss);
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <PageHeader
          title="Accuracy check"
          description={
            "Before trusting a toolkit with your own car, check it on a case with a known answer. The Ahmed body, a " +
            "simple car-like shape measured in a wind tunnel, runs through the same chain you would use for a car: " +
            "snappyHexMesh, Mesh Doctor, a steady k-omega SST solve on a moving ground, then the charts."
          }
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {medium && (
            <StatTile label="25° slant, medium mesh" value={medium.difference} icon={CircleCheck} tone="success"
              hint={`Cd ${medium.cd.toFixed(3)} against ${medium.tunnel} in the tunnel`} />
          )}
          <StatTile label="Mesh study" value={<>&lt;&nbsp;0.5&nbsp;%</>} icon={Layers}
            hint="Cd change, medium to fine mesh" />
          {steep && (
            <StatTile label="35° slant" value={steep.difference} icon={TriangleAlert} tone="danger"
              hint="steady RANS misses the separation" />
          )}
          {medium && (
            <StatTile label="Solve time, medium mesh" value={medium.time} icon={Timer}
              hint={`${medium.cells} cells, 2000 iterations, 6 cores`} />
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Drag: the Mesh Doctor run against the wind tunnel</CardTitle>
                <CardDescription>
                  Cd is the mean over the last 500 of 2000 iterations. The three 25° meshes differ only in cell size.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent><CdChart cases={all} /></CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>What it shows</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <Finding icon={CircleCheck} tone="success" title="The mesh is fine enough at 0.84 M cells">
                Going from the medium to the fine mesh (twice the cells) changes Cd by less than 0.5&nbsp;% and Cl by
                1&nbsp;%. The coarse mesh is 7&nbsp;% higher: too coarse for numbers, fine for a quick look. Do the
                same on your own car: run two meshes and only quote numbers that stop changing.
              </Finding>
              <Finding icon={CircleCheck} tone="success" title="25°: within 2 % of the wind tunnel">
                Better than steady RANS usually manages on this shape, and partly luck: the real flow separates at the
                top of the slant and reattaches, which two-equation models get only roughly. The big features
                (stagnation, base wake, the slant-edge vortices) are right.
              </Finding>
              <Finding icon={TriangleAlert} tone="warning" title="35°: steady RANS gets it wrong">
                In the wind tunnel the flow leaves the slant completely above about 30° and the drag drops to 0.26.
                Here the flow stays on the slant, the edge vortices grow, and Cd rises to 0.408 (the high lift, 0.445,
                shows the same). A settled, smooth-looking result can still be wrong: where a part sits near a
                separation point (a steep diffuser, a highly loaded flap), check with a transient DDES run or a test,
                and compare designs rather than trusting the absolute number.
              </Finding>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-4 overflow-hidden">
          <CardHeader>
            <div>
              <CardTitle>All the numbers</CardTitle>
              <CardDescription>
                OpenFOAM 14, 2000 iterations per case on 6 cores. Drift is the change between the two halves of the
                averaging window: under 1&nbsp;% means settled.
              </CardDescription>
            </div>
          </CardHeader>
          <div className="border-t border-border">
            <DocTableView table={RESULTS} caption="Results of the accuracy check" format={readable} />
          </div>
          <p className="border-t border-border px-5 py-3 text-[13px] text-muted-foreground">
            Wind tunnel: Ahmed, Ramm &amp; Faltin, SAE 840300 (1984), 60&nbsp;m/s; the 35° value (about 0.26) as
            quoted from it in later papers. Simulation: 40&nbsp;m/s, half model with a symmetry plane, moving ground,
            no stilts. Every refinement level follows the background cell size, so each mesh step roughly doubles the
            cells.
          </p>
        </Card>

        <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Using this on your own work</CardTitle></CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1.5 pl-5 text-sm marker:text-muted-foreground">
                <li>Treat differences between designs (A against B on the same mesh and setup) as more reliable than absolute numbers.</li>
                <li>Settled forces (drift under 1&nbsp;%) only mean the solver has stopped changing, not that it is right.</li>
                <li>Report a mesh study with the result: two meshes, and the change between them.</li>
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Run it yourself</CardTitle>
                <CardDescription>
                  About 2 hours on 6 cores and 4.5&nbsp;GB of memory at the peak. It writes the table above to{" "}
                  <code>../ahmed_validation/results.md</code>.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {RUN.map((line) => <CopyCommand key={line} command={line} />)}
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-2">
          <Button size="sm" asChild><Link to="/estimate"><Calculator />Size your own case</Link></Button>
          <Button size="sm" variant="secondary" asChild><Link to="/how-it-works"><Workflow />How it works</Link></Button>
          <p className="text-[13px] text-muted-foreground sm:ml-2">
            This page follows{" "}
            <a href={DOCS.validation} target="_blank" rel="noreferrer" className={link}>docs/validation.md</a> in
            the source.
          </p>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
