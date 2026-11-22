// SPDX-License-Identifier: GPL-3.0-or-later
// This browser's pairing, around every page (App.tsx): the header's "Open the app" reads it. Who the app's
// screens talk to is EngineScope.tsx, which loads with them.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { PairingContext } from "./context";
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
