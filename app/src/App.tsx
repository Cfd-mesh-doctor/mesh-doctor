// SPDX-License-Identifier: GPL-3.0-or-later
import { RouterProvider } from "react-router/dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PairingProvider } from "@/engine/EngineProvider";
import { makeRouter } from "@/router";

const router = makeRouter();

/** Around every page: this browser's pairing (the header's "Open the app" reads it) and tooltips. The query cache
 *  is only around the pages that ask the engine for things (engine/QueryLayout.tsx), so the home page doesn't
 *  load it. */
export function App() {
  return (
    <PairingProvider>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
      </TooltipProvider>
    </PairingProvider>
  );
}
