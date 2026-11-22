// SPDX-License-Identifier: GPL-3.0-or-later
// The two ways into the app's screens, loaded only when one is opened.
import { AppLayout } from "@/components/layout/AppLayout";
import { RequirePairing } from "@/components/layout/RequirePairing";
import { EngineScope } from "@/engine/EngineScope";

/** /app: the engine this browser is paired with. */
export function EngineShell() {
  return (
    <EngineScope mode="engine">
      <RequirePairing>
        <AppLayout />
      </RequirePairing>
    </EngineScope>
  );
}

/** /demo: the same screens with recorded data. */
export function DemoShell() {
  return (
    <EngineScope mode="demo">
      <AppLayout />
    </EngineScope>
  );
}
