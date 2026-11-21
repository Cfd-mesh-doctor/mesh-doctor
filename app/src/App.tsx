// SPDX-License-Identifier: GPL-3.0-or-later
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router/dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PairingProvider } from "@/engine/EngineProvider";
import { makeQueryClient } from "@/engine/hooks";
import { makeRouter } from "@/router";

const queryClient = makeQueryClient();
const router = makeRouter();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PairingProvider>
        <TooltipProvider delayDuration={300}>
          <RouterProvider router={router} />
        </TooltipProvider>
      </PairingProvider>
    </QueryClientProvider>
  );
}
