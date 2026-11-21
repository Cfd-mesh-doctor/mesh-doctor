// SPDX-License-Identifier: GPL-3.0-or-later
// Who the screens talk to. PairingProvider (whole app) keeps this browser's pairing; EngineScope (one per
// route group) hands the screens a Transport: the paired engine under /app, recorded data under /demo.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { demoTransport } from "@/demo/transport";
import { httpTransport, type Transport } from "./client";
import { EngineContext, PairingContext, usePairing, type EngineMode, type EngineValue } from "./context";
import { forgetPairing, loadPairing, savePairing, type Pairing } from "./pairing";

export function PairingProvider({ children }: { children: ReactNode }) {
  const [pairing, setPairing] = useState<Pairing | null>(loadPairing);

  // Pairing or forgetting in another tab applies here too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === "md-pairing") setPairing(loadPairing());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const pair = useCallback((engine: string, key: string) => {
    const p: Pairing = { engine, key, paired: new Date().toISOString() };
    savePairing(p);
    setPairing(p);
    return p;
  }, []);

  const forget = useCallback(() => {
    forgetPairing();
    setPairing(null);
  }, []);

  const value = useMemo(() => ({ pairing, pair, forget }), [pairing, pair, forget]);
  return <PairingContext.Provider value={value}>{children}</PairingContext.Provider>;
}

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
