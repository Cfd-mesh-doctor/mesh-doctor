// SPDX-License-Identifier: GPL-3.0-or-later
import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { usePairing } from "@/engine/context";

/** The app's screens need a paired engine; without one, go and pair. */
export function RequirePairing({ children }: { children: ReactNode }) {
  const { pairing } = usePairing();
  return pairing ? children : <Navigate to="/connect" replace />;
}
