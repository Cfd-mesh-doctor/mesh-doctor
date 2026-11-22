// SPDX-License-Identifier: GPL-3.0-or-later
// The Dashboard tour: the engine's own dashboard (meshdoctor serve), page by page, as docs/dashboard.md writes it
// (tour.ts, kept equal to the doc by a test), with the doc's screenshots from docs/images.
import { PublicFooter, PublicHeader } from "@/components/layout/PublicChrome";
import { PageHeader } from "@/components/shared/page";
import { useTitle } from "@/lib/useTitle";
import { aboutPage } from "@/pages/docs/entries";
import { DocSectionsView } from "@/pages/docs/DocSections";
import { DocText } from "@/pages/docs/DocText";
import { PICTURES } from "./pictures";
import { INTRO, TITLE, TOUR } from "./tour";

export function DashboardTour() {
  useTitle("Dashboard tour", aboutPage("/dashboard-tour"));
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <PageHeader title={TITLE} description={<DocText text={INTRO} />} />
        <DocSectionsView sections={TOUR} pictures={PICTURES} source="dashboard.md" />
      </main>
      <PublicFooter />
    </div>
  );
}
