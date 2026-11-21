// SPDX-License-Identifier: GPL-3.0-or-later
// The pairing link: https://<this app>/connect#key=<key>&engine=http://localhost:<port>
// Everything after "#" stays in the browser (it is never sent to the website), and the engine
// address must be this computer, so the key can only ever go to the user's own engine.
import { readItem, removeItem, writeItem } from "@/lib/storage";

export interface Pairing {
  engine: string;
  key: string;
  /** When this browser was paired (ISO time). */
  paired: string;
}

export const DEFAULT_ENGINE = "http://localhost:8765";
const STORE = "md-pairing";
const KEY = /^[A-Za-z0-9_-]{32,128}$/;
// Not [::1]: a Content-Security-Policy cannot name an IPv6 address, so the site could not reach it.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** http://localhost:port or http://127.0.0.1:port with nothing else, or null. */
export function cleanEngineUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" || !LOCAL_HOSTS.has(u.hostname)) return null;
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return null;
  const port = Number(u.port || "80");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  return `http://${u.hostname}:${port}`;
}

export function validKey(key: string | null | undefined): key is string {
  return typeof key === "string" && KEY.test(key);
}

export type ParsedLink = { ok: true; engine: string; key: string } | { ok: false; error: string } | null;

/** The "#key=…&engine=…" part of a pairing link; null when there is no pairing in it at all. */
export function parsePairingHash(hash: string): ParsedLink {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const key = params.get("key");
  const engine = params.get("engine");
  if (key === null && engine === null) return null;
  if (!validKey(key)) return { ok: false, error: "The link has no valid pairing key. Copy the whole link again." };
  const clean = cleanEngineUrl(engine ?? DEFAULT_ENGINE);
  if (!clean) {
    return { ok: false, error: "The link's engine address isn't on this computer, so it was not used." };
  }
  return { ok: true, engine: clean, key };
}

/** A whole pairing link pasted by hand. */
export function parsePairingLink(text: string): ParsedLink {
  const t = text.trim();
  if (!t) return null;
  try {
    const parsed = parsePairingHash(new URL(t).hash);
    return parsed ?? { ok: false, error: "That link has no pairing in it. Use the link meshdoctor pair prints." };
  } catch {
    return { ok: false, error: "That isn't a link. Paste the whole line that starts with https://" };
  }
}

export function loadPairing(): Pairing | null {
  const raw = readItem(STORE);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Pairing>;
    const engine = cleanEngineUrl(p.engine);
    if (!engine || !validKey(p.key)) return null;
    return { engine, key: p.key, paired: typeof p.paired === "string" ? p.paired : "" };
  } catch {
    return null;
  }
}

export function savePairing(p: Pairing): boolean {
  return writeItem(STORE, JSON.stringify(p));
}

export function forgetPairing(): void {
  removeItem(STORE);
}

/** The key's first and last characters, enough to tell two keys apart without showing it. */
export function maskKey(key: string): string {
  return key.length > 10 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "••••";
}
