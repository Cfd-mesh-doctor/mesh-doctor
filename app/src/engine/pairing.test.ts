// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  cleanEngineUrl, forgetPairing, loadPairing, maskKey, parsePairingHash, parsePairingLink, savePairing, validKey,
} from "./pairing";

const KEY = "TestKey_0123456789abcdefghijklmnopqrstuvwxy";

describe("cleanEngineUrl", () => {
  it("accepts this computer only, with a port", () => {
    expect(cleanEngineUrl("http://localhost:8765")).toBe("http://localhost:8765");
    expect(cleanEngineUrl("http://127.0.0.1:8768/")).toBe("http://127.0.0.1:8768");
    expect(cleanEngineUrl(" http://LOCALHOST:8765 ")).toBe("http://localhost:8765");
  });

  it.each([
    "https://localhost:8765", // the engine speaks plain http on this machine only
    "http://example.com:8765",
    "http://192.168.1.5:8765", // another machine on the network
    "http://localhost.evil.test:8765",
    "http://user:pw@localhost:8765",
    "http://localhost:8765/api/v1",
    "http://localhost:8765?x=1",
    "http://localhost:8765#k",
    "http://localhost:80",
    "http://localhost:22",
    "http://[::1]:9000", // the site's CSP cannot allow an IPv6 address
    "javascript:alert(1)",
    "not a url",
    "",
  ])("refuses %s", (u) => {
    expect(cleanEngineUrl(u)).toBeNull();
  });
});

describe("pairing links", () => {
  it("reads the key and engine after #", () => {
    expect(parsePairingHash(`#key=${KEY}&engine=http%3A%2F%2Flocalhost%3A8768`)).toEqual({
      ok: true, key: KEY, engine: "http://localhost:8768",
    });
  });

  it("defaults to the standard port when the engine is left out", () => {
    expect(parsePairingHash(`key=${KEY}`)).toEqual({ ok: true, key: KEY, engine: "http://localhost:8765" });
  });

  it("is null when there is no pairing at all", () => {
    expect(parsePairingHash("")).toBeNull();
    expect(parsePairingHash("#section-2")).toBeNull();
  });

  it("refuses a bad key or an engine on another machine", () => {
    expect(parsePairingHash("#key=short")).toMatchObject({ ok: false });
    expect(parsePairingHash(`#key=${KEY}&engine=http%3A%2F%2Fevil.test%3A8765`)).toMatchObject({ ok: false });
  });

  it("takes a whole pasted link", () => {
    expect(parsePairingLink(`https://mesh-doctor.vercel.app/connect#key=${KEY}`)).toMatchObject({ ok: true, key: KEY });
    expect(parsePairingLink("https://mesh-doctor.vercel.app/connect")).toMatchObject({ ok: false });
    expect(parsePairingLink("meshdoctor serve")).toMatchObject({ ok: false });
    expect(parsePairingLink("   ")).toBeNull();
  });

  it("validates keys like the engine does", () => {
    expect(validKey(KEY)).toBe(true);
    expect(validKey("a".repeat(31))).toBe(false);
    expect(validKey("a".repeat(129))).toBe(false);
    expect(validKey(`${KEY.slice(0, 40)}+/=`)).toBe(false);
  });
});

describe("stored pairing", () => {
  it("round-trips and can be forgotten", () => {
    savePairing({ engine: "http://localhost:8765", key: KEY, paired: "2026-11-21T19:00:00Z" });
    expect(loadPairing()).toEqual({ engine: "http://localhost:8765", key: KEY, paired: "2026-11-21T19:00:00Z" });
    forgetPairing();
    expect(loadPairing()).toBeNull();
  });

  it("ignores anything tampered with", () => {
    localStorage.setItem("md-pairing", "{not json");
    expect(loadPairing()).toBeNull();
    localStorage.setItem("md-pairing", JSON.stringify({ engine: "http://evil.test:8765", key: KEY }));
    expect(loadPairing()).toBeNull();
    localStorage.setItem("md-pairing", JSON.stringify({ engine: "http://localhost:8765", key: "x" }));
    expect(loadPairing()).toBeNull();
  });

  it("shows only the ends of a key", () => {
    expect(maskKey(KEY)).toBe("Test…vwxy");
    expect(maskKey(KEY)).not.toContain(KEY.slice(4, -4));
  });
});
