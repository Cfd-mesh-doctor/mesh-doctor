// SPDX-License-Identifier: GPL-3.0-or-later
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { demoTransport } from "@/demo/transport";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import { savePairing } from "@/engine/pairing";
import { renderScreen } from "@/test/render";
import { ConnectionPill } from "./ConnectionPill";

/** Your own engine, paired, answering the app's first question (what it is) with `info`. */
function showOwn(info: () => Promise<unknown>) {
  savePairing({ engine: "http://localhost:8765", key: "TestKey_0123456789abcdefghijklmnopqrstuvwxy", paired: "2026-11-22T12:00:00Z" });
  const transport: Transport = {
    kind: "engine",
    scope: "test",
    request: async <T,>(_method: string, path: string) => {
      if (path === "/") return (await info()) as T;
      throw new EngineError("not-found", `no route ${path}`, 404);
    },
  };
  renderScreen(<ConnectionPill />, { path: "/app/*", at: "/app", transport });
}

const pill = () => screen.getByRole("link");

describe("the engine's state in the top bar", () => {
  // Under 400 px the top bar has room for a short word beside the menu and the logo: the long states say one.
  it.each([
    ["not running", async () => { throw new EngineError("unreachable", "Nothing answered"); }, "Engine offline", "Offline"],
    ["speaking another API", async () => ({ apiVersion: "2.0", version: "0.9.0" }), "Version mismatch", "Mismatch"],
    ["yet to answer", () => new Promise<never>(() => {}), "Connecting…", "Waiting…"],
  ])("for an engine %s says it in a short word on a phone under 400 px", async (_, info, label, short) => {
    showOwn(info);
    await waitFor(() => expect(pill()).toHaveTextContent(label));
    expect(within(pill()).getByText(short)).toHaveClass("min-[400px]:hidden");
    expect(within(pill()).getByText(label)).toHaveClass("hidden", "min-[400px]:inline");
  });

  it("says Connected in full, as that fits", async () => {
    showOwn(async () => ({ apiVersion: "1.0", version: "0.1.0" }));
    await waitFor(() => expect(pill()).toHaveTextContent(/^Connected$/));
  });

  it("in the demo says Demo data, or Demo on a phone", () => {
    renderScreen(<ConnectionPill />, { path: "/demo/*", at: "/demo", transport: demoTransport(undefined, 0) });
    expect(within(pill()).getByText("Demo")).toHaveClass("min-[400px]:hidden");
    expect(within(pill()).getByText("Demo data")).toHaveClass("hidden", "min-[400px]:inline");
  });
});
