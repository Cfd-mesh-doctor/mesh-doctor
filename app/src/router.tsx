// SPDX-License-Identifier: GPL-3.0-or-later
// The screens. /app talks to the paired engine; /demo shows the same screens with recorded data;
// /report opens a report file in the browser; /estimate sizes a case; /how-it-works explains each step;
// /accuracy compares the chain with a wind tunnel; /gallery shows the pictures the toolkit's scripts make.
// Everything but the home page loads when first opened, so the home page stays small.
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
    { path: "jobs", handle: h("Jobs"), lazy: async () => ({ Component: (await import("@/pages/app/Jobs")).Jobs }) },
    { path: "settings", handle: h("Settings"), lazy: async () => ({ Component: (await import("@/pages/app/Settings")).Settings }) },
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
      { path: "/connect", lazy: async () => ({ Component: (await import("@/pages/Connect")).Connect }) },
      { path: "/report", lazy: async () => ({ Component: (await import("@/pages/report/Report")).Report }) },
      { path: "/estimate", lazy: async () => ({ Component: (await import("@/pages/estimate/Estimate")).Estimate }) },
      { path: "/how-it-works", lazy: async () => ({ Component: (await import("@/pages/how/HowItWorks")).HowItWorks }) },
      { path: "/accuracy", lazy: async () => ({ Component: (await import("@/pages/accuracy/Accuracy")).Accuracy }) },
      { path: "/gallery", lazy: async () => ({ Component: (await import("@/pages/gallery/Gallery")).Gallery }) },
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
