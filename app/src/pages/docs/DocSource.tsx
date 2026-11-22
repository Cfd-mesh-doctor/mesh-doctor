// SPDX-License-Identifier: GPL-3.0-or-later
// The line at the foot of a page that shows a doc: which doc in the repository it follows, linked on GitHub, where it
// can be read as written or a change to it suggested. (Accuracy, Gallery and How it works say it in their own words.)
import { cn } from "@/lib/utils";
import { githubDoc } from "./entries";

const link = "font-medium text-primary underline-offset-4 hover:underline";

/** "This page follows docs/limits.md in the source.", the doc's name a link to it on GitHub. */
export function DocSource({ file, className }: { file: string; className?: string }) {
  return (
    <p className={cn("mt-12 max-w-3xl border-t border-border pt-4 text-[13px] text-muted-foreground", className)}>
      This page follows{" "}
      <a href={githubDoc(file)} target="_blank" rel="noreferrer" className={link}>{`docs/${file}`}</a> in the source.
    </p>
  );
}
