// SPDX-License-Identifier: GPL-3.0-or-later
// Limits: what Mesh Doctor is not, and where each part of it stops. The text is docs/limits.md's (sections.ts, kept
// equal to the doc by a test); each section has the anchor GitHub gives its heading.
import { PublicFooter, PublicHeader } from "@/components/layout/PublicChrome";
import { PageHeader } from "@/components/shared/page";
import { useTitle } from "@/lib/useTitle";
import { DocSectionsView } from "@/pages/docs/DocSections";
import { LIMITS } from "./sections";

export function Limits() {
  useTitle("Limits");
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <PageHeader
          title="Limits"
          description="What Mesh Doctor is not, the versions it runs on, and where each part of it stops. Worth reading before you trust a result."
        />
        <DocSectionsView sections={LIMITS} source="limits.md" />
      </main>
      <PublicFooter />
    </div>
  );
}
