// SPDX-License-Identifier: GPL-3.0-or-later
// The engine's state in words, for the pill in the top bar, the sidebar and Settings.
import type { BadgeTone } from "@/components/ui/badge";
import { useEngine, usePairing } from "@/engine/context";
import { asEngineError, explain } from "@/engine/errors";
import { useEngineInfo } from "@/engine/hooks";

export interface Connection {
  tone: BadgeTone;
  label: string;
  /** a shorter label for phones under 400 px wide, where the top bar has room for little else */
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
    if (e.code === "incompatible") return { tone: "warning", label: "Version mismatch", short: "Mismatch", detail: e.message };
    // Offline only when nothing answered. Otherwise the engine (or something else) did, or may yet: say what the
    // panel under it says, so the top bar doesn't send you to start an engine that's running.
    if (e.code === "unreachable") {
      return { tone: "danger", label: "Engine offline", short: "Offline", detail: `Nothing answered at ${pairing.engine}` };
    }
    if (e.code === "timeout") return { tone: "warning", label: "Slow to answer", short: "Slow", detail: e.message };
    return { tone: "danger", label: "Engine error", short: "Error", detail: explain(e).title };
  }
  if (info.isPending) return { tone: "neutral", label: "Connecting…", short: "Waiting…", detail: pairing.engine, pulse: true };
  return {
    tone: "success",
    label: "Connected",
    detail: `Mesh Doctor ${info.data.version ?? ""} · API ${info.data.apiVersion} · ${pairing.engine}`,
    pulse: info.isFetching,
  };
}
