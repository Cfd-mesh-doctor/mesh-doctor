// SPDX-License-Identifier: GPL-3.0-or-later
import type { ComponentType } from "react";
import type { RouteObject } from "react-router";
import { routes } from "@/router";

/** The site's pages, in the router's order, with those under a layout that has no address of its own (the query
 *  cache's, engine/QueryLayout.tsx) in its place. */
export const PAGES: RouteObject[] = (routes[0]?.children ?? []).flatMap((r) =>
  r.path || r.index ? [r] : (r.children ?? []));

/** The page the site opens at this address, loaded as its router loads it. */
export async function pageAt(path: string): Promise<ComponentType> {
  const route = PAGES.find((r) => r.path === path);
  const lazy = route?.lazy as unknown as (() => Promise<{ Component: ComponentType }>) | undefined;
  if (!lazy) throw new Error(`no page loads at ${path}`);
  return (await lazy()).Component;
}
