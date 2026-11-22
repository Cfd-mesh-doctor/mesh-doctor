// SPDX-License-Identifier: GPL-3.0-or-later
// The gallery: what the toolkit's scripts make, all from the public Ahmed-body example (docs/gallery.md). The
// sections and pictures come from pictures.ts, which a test keeps equal to the doc and its images.
import { Target } from "lucide-react";
import { Link } from "react-router";
import { PublicFooter, PublicHeader } from "@/components/layout/PublicChrome";
import { PageHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DOCS } from "@/lib/site";
import { useTitle } from "@/lib/useTitle";
import { cn } from "@/lib/utils";
import { GALLERY } from "./pictures";

const link = "font-medium text-primary underline-offset-4 hover:underline";

export function Gallery() {
  useTitle("Gallery");
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <PageHeader
          title="Gallery"
          description={
            "What the toolkit's scripts make, all from the worked example: the Ahmed body with a 25° slant at " +
            "40 m/s, 836 k cells, steady k-omega SST. Each section names the script that made its pictures, so you " +
            "can make the same set for your own case."
          }
        />
        <div className="space-y-12">
          {GALLERY.map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-20">
              <h2 id={`${s.id}-title`} className="text-xl font-semibold tracking-tight">{s.title}</h2>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                Made by <code className="text-foreground">{s.tool}</code>. {s.text}
                {s.id === "dashboard" && (
                  <> See the <a href={DOCS.dashboard} target="_blank" rel="noreferrer" className={link}>dashboard tour</a>.</>
                )}
              </p>
              <div className={cn("mt-4 grid grid-cols-1 gap-4", s.pictures.length > 1 && "md:grid-cols-2")}>
                {s.pictures.map((p) => (
                  <figure key={p.file}>
                    <a href={p.src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-border bg-surface shadow-card">
                      <img src={p.src} alt={p.alt} width={p.width} height={p.height} loading="lazy" decoding="async"
                        className="block h-auto w-full" />
                    </a>
                    <figcaption aria-hidden className="mt-2 text-[13px] text-muted-foreground">{p.alt}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ))}

          <Card className="p-5">
            <p className="font-semibold">How accurate are these?</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The same case on three meshes and at a second slant angle, against the wind tunnel.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button size="sm" asChild><Link to="/accuracy"><Target />Accuracy check</Link></Button>
              <p className="text-[13px] text-muted-foreground">
                This page follows <a href={DOCS.gallery} target="_blank" rel="noreferrer" className={link}>docs/gallery.md</a> in
                the source.
              </p>
            </div>
          </Card>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
