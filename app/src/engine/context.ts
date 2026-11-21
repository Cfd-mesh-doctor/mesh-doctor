// SPDX-License-Identifier: GPL-3.0-or-later
// What the screens read: this browser's pairing, and the engine (or demo) of the current route group.
import { createContext, useCallback, useContext } from "react";
import type { Transport } from "./client";
import type { Pairing } from "./pairing";

export interface PairingValue {
  pairing: Pairing | null;
  pair(engine: string, key: string): Pairing;
  forget(): void;
}

export const PairingContext = createContext<PairingValue | null>(null);

export function usePairing(): PairingValue {
  const v = useContext(PairingContext);
  if (!v) throw new Error("usePairing outside PairingProvider");
  return v;
}

export type EngineMode = "engine" | "demo";

export interface EngineValue {
  mode: EngineMode;
  /** Where this mode's screens live: /app or /demo. */
  base: string;
  transport: Transport | null;
}

export const EngineContext = createContext<EngineValue | null>(null);

export function useEngine(): EngineValue {
  const v = useContext(EngineContext);
  if (!v) throw new Error("useEngine outside EngineScope");
  return v;
}

/** A path inside the current mode: to("/jobs") is /app/jobs, or /demo/jobs in the demo. */
export function useAppPath(): (path?: string) => string {
  const { base } = useEngine();
  return useCallback((path = "") => (path ? `${base}${path.startsWith("/") ? path : `/${path}`}` : base), [base]);
}
