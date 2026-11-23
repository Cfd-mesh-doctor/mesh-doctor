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

  it("asks for a cluster's shapes by its number, before or after the repair", async () => {
    const fetch = vi.fn().mockResolvedValue(answer(200, { cells: [], ctx: [] }));
    vi.stubGlobal("fetch", fetch);
    await expect(api.cluster(httpTransport(ENGINE, KEY), "wing fix", 3, "after")).resolves.toEqual({ cells: [], ctx: [] });
    expect(fetch.mock.calls[0]?.[0]).toBe(`${ENGINE}/api/v1/repairs/wing%20fix/clusters/3?tag=after`);
  });

  it("asks for an A/B test, its live monitor and the judge on one of its runs by the test's name", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(answer(200, {})));
    vi.stubGlobal("fetch", fetch);
    const t = httpTransport(ENGINE, KEY);
    await api.abtests(t);
    await api.abtest(t, "wing fix");
    await api.abtestLive(t, "wing fix");
    await api.abtestJudge(t, "wing fix", "base");
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      `${ENGINE}/api/v1/abtests`,
      `${ENGINE}/api/v1/abtests/wing%20fix`,
      `${ENGINE}/api/v1/abtests/wing%20fix/live`,
      `${ENGINE}/api/v1/abtests/wing%20fix/judge?side=base`,
    ]);
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
    // The engine answered, so its window is busy: the command goes in a second one. And a key made while the engine
    // runs works only once it restarts: the hint says so before the command.
    expect(explain(err).hint).toBe("The engine has a different pairing key, or none was sent. Ran `meshdoctor pair "
      + "--new` while the engine was running? Restart it first (Ctrl+C in its window, then `meshdoctor serve`): it "
      + "reads the key only when it starts. Then run this in a second WSL or Linux terminal (the engine keeps its own "
      + "busy): it opens the pairing link.");
  });

  it("says what frees memory, and names WSL's memory setting for Windows only", () => {
    // On Linux there is no WSL: its .wslconfig is no help there.
    expect(explain(new EngineError("not-enough-memory", "what the engine said")).hint).toBe("Close other programs or "
      + "stop other OpenFOAM runs, then try again. On Windows, you can also give WSL more memory in `.wslconfig`.");
  });

  it("gives the RAM guard's own numbers: what the job needs and what is free", () => {
    // meshdoctor/ramguard.py's refusal, as POST /jobs answers it.
    const said = "not enough memory: repair of 12,225 cells needs about 0.5 GB; 0.2 GB free. Close other programs "
      + "(ParaView, another solver) or run it on a bigger machine.";
    expect(explain(new EngineError("not-enough-memory", said, 409)).hint).toBe("It needs about 0.5 GB, and 0.2 GB is "
      + "free. Close other programs or stop other OpenFOAM runs, then try again. On Windows, you can also give WSL more "
      + "memory in `.wslconfig`.");
  });

  it("names the job in the way when the engine runs one already", () => {
    // meshdoctor/jobs.py's refusals: a job of its own, or an OpenFOAM run it didn't start.
    const job = "job 20261123-104610-repair-wing-fix-b349 (repair wing-fix) is running; one big job at a time (RAM)";
    expect(explain(new EngineError("busy", job, 409)).hint).toBe("The repair wing-fix is running. Wait for it to "
      + "finish, or cancel it on the Jobs page.");
    expect(explain(new EngineError("busy", job.replace("(repair", "(abtest").replace("is running", "is queued"), 409)).hint)
      .toMatch(/^The A\/B test wing-fix is waiting to start\. Wait/);
    expect(explain(new EngineError("busy", "another OpenFOAM job is running; one big job at a time (RAM)", 409)).hint)
      .toBe("Wait for it to finish, or cancel it on the Jobs page.");
  });

  it("offers only a new name for a run that exists, as the app never replaces one", () => {
    const { title, hint } = explain(new EngineError("exists", "run wing-fix already exists; pick another name or replace it", 409));
    expect(title).toBe("A run with that name already exists");
    expect(hint).toMatch(/^Pick another name\./);
    expect(hint).not.toMatch(/choose to replace/);
  });

  it("offers to replace an A/B test that exists, or to run it longer: its name is that of what it tests", () => {
    const { title, hint } = explain(new EngineError("exists", "A/B test wing-fix already exists; extend it or replace it", 409));
    expect(title).toBe("An A/B test with that name already exists");
    expect(hint).toBe("Tick Replace to run it again (its results are deleted), or run it longer from its own page.");
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

describe("an answer that isn't the engine's", () => {
  it("says in plain words that another program may be on the engine's port, and keeps what it answered", () => {
    const { title, hint } = explain(new EngineError("bad-response", "HTTP 200 without the engine's JSON", 200));
    expect(title).toBe("Unexpected answer");
    expect(hint).toMatch(/^Something answered at the engine's address, but not the way Mesh Doctor's engine does: another program may be using its port\./);
    expect(hint).toContain("`meshdoctor serve` prints the address it uses");
    expect(hint).toMatch(/\(HTTP 200 without the engine's JSON\)$/);
  });

  it("says other unexpected errors as they are: a newer engine's own words, or the app's", () => {
    expect(explain(new EngineError("bad-response", "a newer engine's words", 400)).hint).toBe("a newer engine's words");
    expect(explain(new Error("boom")).hint).toBe("boom");
  });
});
