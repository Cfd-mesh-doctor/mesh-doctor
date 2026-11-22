// SPDX-License-Identifier: GPL-3.0-or-later
// The button by a doc heading that copies the address of its section, as GitHub offers by its headings, so one
// section can be shared. It sits beside the heading, not in it, so the heading (and the section it names) keeps its
// own name. On a screen with a mouse it shows while the heading is pointed at or the button has the focus (index.css,
// .heading-link); on a touch screen, which can't point, it always shows.
import { Check, Link2 } from "lucide-react";
import { useLocation } from "react-router";
import { plainText } from "@/lib/docSections";
import { useCopy } from "@/lib/useCopy";

export function HeadingLink({ id, title }: { id: string; title: string }) {
  const { pathname, search } = useLocation();
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => void copy(new URL(`${pathname}${search}#${id}`, window.location.origin).href)}
      aria-label={copied ? "Copied" : `Copy a link to “${plainText(title)}”`}
      className="heading-link grid size-6 shrink-0 place-items-center self-center rounded-md text-muted-foreground transition-opacity hover:bg-surface-2 hover:text-foreground print:hidden"
    >
      {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
    </button>
  );
}
