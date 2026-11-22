// SPDX-License-Identifier: GPL-3.0-or-later
// Which of a page's sections is being read, for its "On this page" list: the last one whose top has scrolled up to just
// under the site's top bar. At the end of a page a short last section never gets that far, so there the section the
// address names (its link in the list was followed) counts while it is in the window, and otherwise the last one.
import { useEffect, useState } from "react";
import { useLocation } from "react-router";

/** Where a section counts as reached, in pixels from the window's top: under the top bar, below where a followed link
 *  leaves a section's top (scroll-mt-20, 80 px). */
export const READ_LINE = 120;

export function useSectionInView(ids: readonly string[]): string | undefined {
  const [current, setCurrent] = useState<string>();
  const { hash } = useLocation();
  const key = ids.join(" ");
  useEffect(() => {
    const named = decodeURIComponent(hash.slice(1));
    let frame = 0;
    function measure() {
      frame = 0;
      const sections = key.split(" ").flatMap((id) => document.getElementById(id) ?? []);
      const page = document.documentElement;
      const atEnd = page.scrollHeight > window.innerHeight + 2 && window.scrollY > 0
        && window.innerHeight + window.scrollY >= page.scrollHeight - 2;
      let found: string | undefined;
      for (const el of sections) if (el.getBoundingClientRect().top <= READ_LINE) found = el.id;
      if (atEnd) {
        const box = sections.find((el) => el.id === named)?.getBoundingClientRect();
        found = box && box.top < window.innerHeight && box.bottom > 0 ? named : sections.at(-1)?.id;
      }
      setCurrent(found);
    }
    const later = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    later();
    window.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
    return () => {
      window.removeEventListener("scroll", later);
      window.removeEventListener("resize", later);
      cancelAnimationFrame(frame);
    };
  }, [key, hash]);
  return current;
}
