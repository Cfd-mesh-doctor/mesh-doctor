// SPDX-License-Identifier: GPL-3.0-or-later
// The Docs page: the one place for the documentation. What this site shows as its own pages, then the docs it
// doesn't show yet, on GitHub (entries.ts, kept equal to the repository's docs/ folder by a test).
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import { PublicFooter, PublicHeader } from "@/components/layout/PublicChrome";
import { PageHeader } from "@/components/shared/page";
import { Card } from "@/components/ui/card";
import { DOCS } from "@/lib/site";
import { useTitle } from "@/lib/useTitle";
import { ON_GITHUB, ON_SITE, githubDoc } from "./entries";

const link = "font-medium text-primary underline-offset-4 hover:underline";

/** A title that opens on GitHub, its arrow kept on the line of its last word when the title wraps. */
function External({ title }: { title: string }) {
  const cut = title.lastIndexOf(" ") + 1;
  return (
    <>
      {title.slice(0, cut)}
      <span className="whitespace-nowrap">
        {title.slice(cut)}
        <ArrowUpRight aria-hidden className="ml-1 inline size-3.5" />
      </span>
    </>
  );
}

export function Docs() {
  useTitle("Docs");
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <PageHeader
          title="Docs"
          description="Everything written about Mesh Doctor: each doc in the repository, as a page of this site."
        />
        <section aria-labelledby="on-site">
          <h2 id="on-site" className="text-lg font-semibold tracking-tight">On this site</h2>
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ON_SITE.map((d) => (
              <li key={d.title}>
                <Card className="h-full p-4">
                  <Link to={d.page ?? "/"} className={link}>{d.title}</Link>
                  <p className="mt-1 text-sm text-muted-foreground">{d.about}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="on-github" className="mt-10">
          <h2 id="on-github" className="text-lg font-semibold tracking-tight">On GitHub</h2>
          {ON_GITHUB.length === 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              Each page above follows a doc in the repository's <code className="font-mono text-[13px]">docs</code>{" "}
              folder. The <a href={DOCS.readme} target="_blank" rel="noreferrer" className={link}>README</a> opens on
              GitHub.
            </p>
          )}
          {ON_GITHUB.length > 0 && (
          <>
          <p className="mt-1 text-sm text-muted-foreground">
            These open on GitHub, in the repository's <code className="font-mono text-[13px]">docs</code> folder, as
            does the <a href={DOCS.readme} target="_blank" rel="noreferrer" className={link}>README</a>.
          </p>
          <Card className="mt-4 divide-y divide-border">
            {ON_GITHUB.map((d) => (
              <div key={d.title} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                <div className="sm:w-80 sm:shrink-0">
                  <a href={githubDoc(d.file ?? "")} target="_blank" rel="noreferrer" className={link}>
                    <External title={d.title} />
                  </a>
                </div>
                <p className="text-sm text-muted-foreground">{d.about}</p>
              </div>
            ))}
          </Card>
          </>
          )}
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
