// SPDX-License-Identifier: GPL-3.0-or-later
// Using this repository with Claude Code: the text of docs/claude.md (guide.ts, kept equal to the doc by a test); each
// section has GitHub's anchor for its heading.
import { PublicFooter, PublicHeader } from "@/components/layout/PublicChrome";
import { PageHeader } from "@/components/shared/page";
import { useTitle } from "@/lib/useTitle";
import { aboutPage } from "@/pages/docs/entries";
import { DocSectionsView } from "@/pages/docs/DocSections";
import { DocText } from "@/pages/docs/DocText";
import { GUIDE, INTRO, TITLE } from "./guide";

export function ClaudeCode() {
  useTitle("Claude Code", aboutPage("/claude-code"));
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <PageHeader title={TITLE} description={<DocText text={INTRO} />} />
        <DocSectionsView sections={GUIDE} source="claude.md" />
      </main>
      <PublicFooter />
    </div>
  );
}
