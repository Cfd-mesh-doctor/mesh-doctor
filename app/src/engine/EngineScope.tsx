// SPDX-License-Identifier: GPL-3.0-or-later
// Who the screens talk to: EngineScope (one per route group) hands the screens a Transport, the paired engine under
// /app and recorded data under /demo. It is apart from PairingProvider (EngineProvider.tsx), which is around every
// page, so the engine's client and the demo's data load only with the app's screens (pages/app/shell.tsx).
import { useMemo, type ReactNode } from "react";
import { demoTransport } from "@/demo/transport";
import { httpTransport, type Transport } from "./client";
import { EngineContext, usePairing, type EngineMode, type EngineValue } from "./context";

let demo: Transport | null = null;

export function EngineScope({ mode, children }: { mode: EngineMode; children: ReactNode }) {
  const { pairing } = usePairing();
  const engine = pairing?.engine;
  const key = pairing?.key;
  const value = useMemo<EngineValue>(() => {
    if (mode === "demo") return { mode, base: "/demo", transport: (demo ??= demoTransport()) };
    return { mode, base: "/app", transport: engine && key ? httpTransport(engine, key) : null };
  }, [mode, engine, key]);
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}
