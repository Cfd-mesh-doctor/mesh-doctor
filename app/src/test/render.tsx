// SPDX-License-Identifier: GPL-3.0-or-later
// Renders a screen with everything around it: query cache, pairing, tooltips, a router, and an engine.
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Transport } from "@/engine/client";
import { EngineContext } from "@/engine/context";
import { PairingProvider } from "@/engine/EngineProvider";
import { makeQueryClient } from "@/engine/hooks";

export function renderScreen(ui: ReactNode, opts: { path?: string; at?: string; transport?: Transport } = {}) {
  const path = opts.path ?? "/";
  const qc = makeQueryClient();
  qc.setDefaultOptions({ queries: { retry: false } });
  const screen = opts.transport ? (
    <EngineContext.Provider value={{ mode: opts.transport.kind, base: opts.transport.kind === "demo" ? "/demo" : "/app", transport: opts.transport }}>
      {ui}
    </EngineContext.Provider>
  ) : ui;
  const router = createMemoryRouter(
    [
      { path, element: screen },
      { path: "*", element: <p>elsewhere</p> },
    ],
    { initialEntries: [opts.at ?? path] },
  );
  const result = render(
    <QueryClientProvider client={qc}>
      <PairingProvider>
        <TooltipProvider delayDuration={0}>
          <RouterProvider router={router} />
        </TooltipProvider>
      </PairingProvider>
    </QueryClientProvider>,
  );
  return { ...result, router, qc };
}
