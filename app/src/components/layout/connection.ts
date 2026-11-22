// SPDX-License-Identifier: GPL-3.0-or-later
// The engine's state in words, for the pill in the top bar, the sidebar and Settings.
import type { BadgeTone } from "@/components/ui/badge";
import { useEngine, usePairing } from "@/engine/context";
import { asEngineError } from "@/engine/errors";
import { useEngineInfo } from "@/engine/hooks";

export interface Connection {
  tone: BadgeTone;
  label: string;
  /** a shorter label for the smallest phones, where the top bar has room for little else */
  short?: string;
  detail: string;
  pulse?: boolean;
}

export function useConnection(): Connection {
  const { mode } = useEngine();
  const { pairing } = usePairing();
  const info = useEngineInfo();
  if (mode === "demo") {
    return { tone: "info", label: "Demo data", short: "Demo", detail: "Recorded from a real run of the public Ahmed-body example" };
  }
  if (!pairing) return { tone: "neutral", label: "Not paired", detail: "Pair this browser with your engine" };
  if (info.isError) {
    const e = asEngineError(info.error);
    if (e.needsPairing) return { tone: "warning", label: "Pair again", detail: "The engine has a different pairing key" };
    if (e.code === "permission-denied") return { tone: "danger", label: "Blocked", detail: "The browser blocked access to this device" };
    if (e.code === "incompatible") return { tone: "warning", label: "Version mismatch", detail: e.message };
    return { tone: "danger", label: "Engine offline", detail: `Nothing answered at ${pairing.engine}` };
  }
  if (info.isPending) return { tone: "neutral", label: "Connecting…", detail: pairing.engine, pulse: true };
  return {
    tone: "success",
    label: "Connected",
    detail: `Mesh Doctor ${info.data.version ?? ""} · API ${info.data.apiVersion} · ${pairing.engine}`,
    pulse: info.isFetching,
  };
}
