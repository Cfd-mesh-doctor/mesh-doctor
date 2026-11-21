// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect } from "react";
import { APP_NAME } from "./site";

/** The browser tab's title: "Jobs · Mesh Doctor". */
export function useTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : `${APP_NAME}: find and fix bad cells in OpenFOAM meshes`;
  }, [title]);
}
