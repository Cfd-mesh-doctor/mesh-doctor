// SPDX-License-Identifier: GPL-3.0-or-later
// Around the pages that ask the engine, or the demo's recorded data, for things: the app, the demo, Connect and the
// report viewer (router.tsx). It loads with the first of them, so the query library stays off the home page and the
// doc pages, which never ask.
import { QueryClientProvider } from "@tanstack/react-query";
import { Outlet } from "react-router";
import { makeQueryClient } from "./hooks";

/** One cache for all of them, kept while you move between them. */
const queryClient = makeQueryClient();

export function QueryLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}
