// SPDX-License-Identifier: GPL-3.0-or-later
import type { ComponentType } from "react";
import { routes } from "@/router";

/** The page the site opens at this address, loaded as its router loads it. */
export async function pageAt(path: string): Promise<ComponentType> {
  const route = (routes[0]?.children ?? []).find((r) => r.path === path);
  const lazy = route?.lazy as unknown as (() => Promise<{ Component: ComponentType }>) | undefined;
  if (!lazy) throw new Error(`no page loads at ${path}`);
  return (await lazy()).Component;
}
