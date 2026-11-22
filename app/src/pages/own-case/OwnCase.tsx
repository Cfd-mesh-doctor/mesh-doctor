// SPDX-License-Identifier: GPL-3.0-or-later
// Starting your own case from the Ahmed example: the text of docs/templates.md (guide.ts, kept equal to the doc by a
// test), with the command that copies the example under the heading; each section has GitHub's anchor for its heading.
import { PublicFooter, PublicHeader } from "@/components/layout/PublicChrome";
import { CopyCommand } from "@/components/shared/CopyCommand";
import { PageHeader } from "@/components/shared/page";
import { useTitle } from "@/lib/useTitle";
import { DocSectionsView } from "@/pages/docs/DocSections";
import { DocText } from "@/pages/docs/DocText";
import { COPY, GUIDE, INTRO, TITLE } from "./guide";

export function OwnCase() {
  useTitle("Your own case");
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <PageHeader title={TITLE} description={<DocText text={INTRO} />} />
        <CopyCommand command={COPY} className="mb-10 max-w-3xl" />
        <DocSectionsView sections={GUIDE} source="templates.md" />
      </main>
      <PublicFooter />
    </div>
  );
}
