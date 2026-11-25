// SPDX-License-Identifier: GPL-3.0-or-later
// Showing a picture the app fetched itself (the engine's pictures need its key, so an <img> can't ask for them):
// whether its place on the page has come near the screen, so only the pictures looked at are fetched, and the
// picture shown through a blob: URL that is let go once it isn't shown.
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Whether the element the returned ref is on has come within `margin` of the screen; it stays true from then on.
 * Where the browser has no IntersectionObserver, every element has.
 */
export function useSeen<T extends Element>(margin = "300px"): [(el: T | null) => (() => void) | undefined, boolean] {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  const ref = useCallback((el: T | null) => {
    if (!el || seen) return undefined;
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setSeen(true);
    }, { rootMargin: margin });
    watch.observe(el);
    return () => watch.disconnect();
  }, [seen, margin]);
  return [ref, seen];
}

/**
 * Shows `blob` in the <img> the returned ref is on, through a blob: URL made for it and let go once the image shows
 * another or goes. The URL is set on the element itself, not kept in state: one made in an effect is let go in its
 * cleanup, which StrictMode runs at once in development, and state would then hold a URL already let go.
 */
export function useBlobSrc(blob: Blob | undefined) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (!blob || !img) return undefined;
    const url = URL.createObjectURL(blob);
    img.src = url;
    return () => {
      img.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [blob]);
  return ref;
}
