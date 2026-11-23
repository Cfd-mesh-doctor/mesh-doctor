// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, httpTransport } from "./client";
import { EngineError, explain } from "./errors";

const KEY = "k".repeat(43);
const ENGINE = "http://localhost:8765";

function answer(status: number, doc: unknown) {
  return new Response(JSON.stringify(doc), { status, headers: { "Content-Type": "application/json" } });
}

function permissions(state: PermissionState | null) {
  const query = state === null
    ? vi.fn().mockRejectedValue(new TypeError("unknown permission"))
    : vi.fn().mockResolvedValue({ state });
  Object.defineProperty(navigator, "permissions", { value: { query }, configurable: true });
  return query;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("httpTransport", () => {
  it("sends the key, to this computer only, without cookies", async () => {
    const fetch = vi.fn().mockResolvedValue(answer(200, { items: ["ahmed"] }));
    vi.stubGlobal("fetch", fetch);
    await expect(api.cases(httpTransport(ENGINE, KEY))).resolves.toEqual({ items: ["ahmed"] });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit & { targetAddressSpace?: string }];
    expect(url).toBe("http://localhost:8765/api/v1/cases");
    expect(init.headers).toEqual({ "X-MD-Key": KEY });
    expect(init.credentials).toBe("omit");
    expect(init.mode).toBe("cors");
    expect(init.targetAddressSpace).toBe("loopback");
    expect(init.method).toBe("GET");
  });

  it("posts JSON only when there is a body", async () => {
    const fetch = vi.fn().mockResolvedValue(answer(200, { id: "x", state: "cancelled" }));
    vi.stubGlobal("fetch", fetch);
    await api.cancelJob(httpTransport(ENGINE, KEY), "20261121-130141-repair-a-0266");
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ENGINE}/api/v1/jobs/20261121-130141-repair-a-0266/cancel`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("turns the engine's error document into an EngineError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(409, { error: { code: "busy", message: "one big job at a time" } })));
    const err = await api.jobs(httpTransport(ENGINE, KEY)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err).toMatchObject({ code: "busy", status: 409, message: "one big job at a time" });
  });

  it("knows a stale pairing key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      answer(403, { error: { code: "forbidden", message: "forbidden: missing or wrong pairing key (pair again: meshdoctor pair)" } }),
    ));
    const err = (await api.jobs(httpTransport(ENGINE, KEY)).catch((e: unknown) => e)) as EngineError;
    expect(err.needsPairing).toBe(true);
    expect(explain(err).command).toBe("meshdoctor pair --open");
    // The engine answered, so its window is busy: the command goes in a second one.
    expect(explain(err).hint).toBe("The engine has a different pairing key, or none was sent. Run this in a second WSL "
      + "window (the engine keeps its own busy): it opens the pairing link.");
  });

  it("says unreachable when nothing answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    permissions("granted");
    const err = (await api.cases(httpTransport(ENGINE, KEY)).catch((e: unknown) => e)) as EngineError;
    expect(err.code).toBe("unreachable");
    expect(err.transient).toBe(true);
  });

  it("says blocked when the browser denied local access", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const query = permissions("denied");
    const err = (await api.cases(httpTransport(ENGINE, KEY)).catch((e: unknown) => e)) as EngineError;
    expect(err.code).toBe("permission-denied");
    expect(query).toHaveBeenCalledWith({ name: "loopback-network" });
  });

  it("still works where the permission has no name yet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    permissions(null);
    await expect(api.cases(httpTransport(ENGINE, KEY))).rejects.toMatchObject({ code: "unreachable" });
  });

  it("gives up after the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_r, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const p = api.cases(httpTransport(ENGINE, KEY, 1000)).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await p).toMatchObject({ code: "timeout" });
  });

  it("refuses an answer that isn't the engine's JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })));
    await expect(api.cases(httpTransport(ENGINE, KEY))).rejects.toMatchObject({ code: "bad-response" });
  });
});

describe("api.info", () => {
  it("accepts any 1.x engine", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(200, { apiVersion: "1.7", version: "0.3.0", schemas: {} })));
    await expect(api.info(httpTransport(ENGINE, KEY))).resolves.toMatchObject({ apiVersion: "1.7" });
  });

  it("refuses another major version, with what to update", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(200, { apiVersion: "2.0", schemas: {} })));
    const err = (await api.info(httpTransport(ENGINE, KEY)).catch((e: unknown) => e)) as EngineError;
    expect(err.code).toBe("incompatible");
    expect(err.message).toMatch(/Reload the app/);
  });
});
