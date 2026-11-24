// SPDX-License-Identifier: GPL-3.0-or-later
// The screens. /app talks to the engine that /connect pairs, and /demo shows the same screens with recorded data.
// Besides the home page, the rest are /docs and the pages it lists: the report viewer, the size estimator and a page
// for each doc, from pages/docs/entries.ts, whose test checks that each has a route here (so they aren't named here).
// Everything but the home page loads when first opened, so the home page stays small. The pages that ask the
// engine, or the demo's recorded data, for things share one query cache (engine/QueryLayout.tsx), which loads
// with the first of them.
import { createBrowserRouter, type RouteObject } from "react-router";
import type { RouteHandle } from "@/components/layout/AppLayout";
import { RootLayout } from "@/components/layout/RootLayout";
import { NotFound, NotFoundPage, RouteError } from "@/pages/NotFound";
import { Landing } from "@/pages/landing/Landing";

function screens(home: string): RouteObject[] {
  const h = (title: string): RouteHandle => ({ title });
  return [
    { index: true, handle: h("Overview"), lazy: async () => ({ Component: (await import("@/pages/app/Overview")).Overview }) },
    { path: "cases", handle: h("Cases"), lazy: async () => ({ Component: (await import("@/pages/app/Cases")).Cases }) },
    { path: "solve", handle: h("Solve"), lazy: async () => ({ Component: (await import("@/pages/app/Solve")).Solve }) },
    { path: "repairs", handle: h("Repairs"), lazy: async () => ({ Component: (await import("@/pages/app/Repairs")).Repairs }) },
    { path: "abtests", handle: h("A/B tests"), lazy: async () => ({ Component: (await import("@/pages/app/AbTests")).AbTests }) },
    { path: "jobs", handle: h("Jobs"), lazy: async () => ({ Component: (await import("@/pages/app/Jobs")).Jobs }) },
    {
      path: "estimate",
      handle: h("Size estimator"),
      lazy: async () => ({ Component: (await import("@/pages/app/Estimator")).Estimator }),
    },
    { path: "settings", handle: h("Settings"), lazy: async () => ({ Component: (await import("@/pages/app/Settings")).Settings }) },
    {
      path: "repairs/:name/report",
      handle: h("Report"),
      lazy: async () => ({ Component: (await import("@/pages/app/RepairReport")).RepairReport }),
    },
    {
      path: "abtests/:name",
      handle: h("A/B test"),
      lazy: async () => ({ Component: (await import("@/pages/app/AbTest")).AbTest }),
    },
    { path: "solve/:name", handle: h("Run"), lazy: async () => ({ Component: (await import("@/pages/app/Run")).RunPage }) },
    { path: "*", handle: h("Not found"), element: <NotFound home={home} /> },
  ];
}

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    hydrateFallbackElement: <div className="min-h-dvh" />,
    children: [
      { path: "/", element: <Landing /> },
      {
        lazy: async () => ({ Component: (await import("@/engine/QueryLayout")).QueryLayout }),
        children: [
          { path: "/connect", lazy: async () => ({ Component: (await import("@/pages/Connect")).Connect }) },
          { path: "/report", lazy: async () => ({ Component: (await import("@/pages/report/Report")).Report }) },
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
        ],
      },
      { path: "/estimate", lazy: async () => ({ Component: (await import("@/pages/estimate/Estimate")).Estimate }) },
      { path: "/how-it-works", lazy: async () => ({ Component: (await import("@/pages/how/HowItWorks")).HowItWorks }) },
      { path: "/accuracy", lazy: async () => ({ Component: (await import("@/pages/accuracy/Accuracy")).Accuracy }) },
      { path: "/gallery", lazy: async () => ({ Component: (await import("@/pages/gallery/Gallery")).Gallery }) },
      { path: "/install", lazy: async () => ({ Component: (await import("@/pages/install/Install")).Install }) },
      { path: "/your-own-case", lazy: async () => ({ Component: (await import("@/pages/own-case/OwnCase")).OwnCase }) },
      { path: "/claude-code", lazy: async () => ({ Component: (await import("@/pages/claude/ClaudeCode")).ClaudeCode }) },
      {
        path: "/dashboard-tour",
        lazy: async () => ({ Component: (await import("@/pages/dashboard/DashboardTour")).DashboardTour }),
      },
      {
        path: "/architecture",
        lazy: async () => ({ Component: (await import("@/pages/architecture/Architecture")).Architecture }),
      },
      {
        path: "/troubleshooting",
        lazy: async () => ({ Component: (await import("@/pages/troubleshooting/Troubleshooting")).Troubleshooting }),
      },
      { path: "/limits", lazy: async () => ({ Component: (await import("@/pages/limits/Limits")).Limits }) },
      { path: "/safety", lazy: async () => ({ Component: (await import("@/pages/safety/Safety")).Safety }) },
      { path: "/docs", lazy: async () => ({ Component: (await import("@/pages/docs/Docs")).Docs }) },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function makeRouter() {
  return createBrowserRouter(routes);
}
