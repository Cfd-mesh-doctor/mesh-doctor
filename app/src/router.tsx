// SPDX-License-Identifier: GPL-3.0-or-later
// The screens. /app talks to the paired engine; /demo shows the same screens with recorded data.
// Everything but the home page loads when first opened, so the home page stays small.
import { createBrowserRouter, type RouteObject } from "react-router";
import type { RouteHandle } from "@/components/layout/AppLayout";
import { NotFound, NotFoundPage, RouteError } from "@/pages/NotFound";
import { Landing } from "@/pages/landing/Landing";

function screens(home: string): RouteObject[] {
  const h = (title: string): RouteHandle => ({ title });
  return [
    { index: true, handle: h("Overview"), lazy: async () => ({ Component: (await import("@/pages/app/Overview")).Overview }) },
    { path: "cases", handle: h("Cases"), lazy: async () => ({ Component: (await import("@/pages/app/Cases")).Cases }) },
    { path: "jobs", handle: h("Jobs"), lazy: async () => ({ Component: (await import("@/pages/app/Jobs")).Jobs }) },
    { path: "settings", handle: h("Settings"), lazy: async () => ({ Component: (await import("@/pages/app/Settings")).Settings }) },
    { path: "*", handle: h("Not found"), element: <NotFound home={home} /> },
  ];
}

export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    hydrateFallbackElement: <div className="min-h-dvh" />,
    children: [
      { path: "/", element: <Landing /> },
      { path: "/connect", lazy: async () => ({ Component: (await import("@/pages/Connect")).Connect }) },
      {
        path: "/app",
        lazy: async () => ({ Component: (await import("@/pages/app/shell")).EngineShell }),
        children: screens("/app"),
      },
      {
        path: "/demo",
        lazy: async () => ({ Component: (await import("@/pages/app/shell")).DemoShell }),
        children: screens("/demo"),
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function makeRouter() {
  return createBrowserRouter(routes);
}
