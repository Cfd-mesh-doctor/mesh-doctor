// SPDX-License-Identifier: GPL-3.0-or-later
// Architecture: where the code is, where it is going and why, as docs/architecture.md writes it (design.ts, kept equal
// to the doc by a test); each section has GitHub's anchor for its heading.
import { PublicFooter, PublicHeader } from "@/components/layout/PublicChrome";
import { PageHeader } from "@/components/shared/page";
import { useTitle } from "@/lib/useTitle";
import { DocSectionsView } from "@/pages/docs/DocSections";
import { DocText } from "@/pages/docs/DocText";
import { DESIGN, INTRO, TITLE } from "./design";

export function Architecture() {
  useTitle("Architecture");
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <PageHeader title={TITLE} description={<DocText text={INTRO} />} />
        <DocSectionsView sections={DESIGN} />
      </main>
      <PublicFooter />
    </div>
  );
}
