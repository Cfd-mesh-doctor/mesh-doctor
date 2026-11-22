// SPDX-License-Identifier: GPL-3.0-or-later
// The safety model: why Mesh Doctor can't damage a case and why its dashboard isn't a way into your computer. The text
// is docs/safety.md's (rules.ts, kept equal to the doc by a test); each section has GitHub's anchor for its heading.
import { PublicFooter, PublicHeader } from "@/components/layout/PublicChrome";
import { PageHeader } from "@/components/shared/page";
import { useTitle } from "@/lib/useTitle";
import { DocSectionsView } from "@/pages/docs/DocSections";
import { DocText } from "@/pages/docs/DocText";
import { INTRO, SAFETY } from "./rules";

export function Safety() {
  useTitle("Safety model");
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <PageHeader title="Safety model" description={<DocText text={INTRO} />} />
        <DocSectionsView sections={SAFETY} />
      </main>
      <PublicFooter />
    </div>
  );
}
