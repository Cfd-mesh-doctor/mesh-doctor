// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect } from "react";
import { APP_NAME } from "./site";

/** The page's description for search results: its own, or the site's (index.html's, kept on the tag) without one. */
function describe(text?: string): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!meta) return;
  meta.dataset.site ??= meta.content;
  meta.content = text ?? meta.dataset.site;
}

/** The browser tab's title, "Jobs · Mesh Doctor", and the page's description when it has its own. */
export function useTitle(title?: string, description?: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : `${APP_NAME}: find and fix bad cells in OpenFOAM meshes`;
    describe(description);
  }, [title, description]);
}
