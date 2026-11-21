// SPDX-License-Identifier: GPL-3.0-or-later
// Chrome and Edge (142+) ask before a website may reach apps on this device: Local Network Access.
// The browser shows its prompt on the first request; these helpers only read the answer.

export type LocalAccess = "granted" | "denied" | "prompt" | "unknown";

// Newer Chrome splits the permission in two and names the one for this computer "loopback-network";
// the first releases called it "local-network-access".
const NAMES = ["loopback-network", "local-network-access"];

export async function localAccessState(): Promise<LocalAccess> {
  const perms = typeof navigator === "undefined" ? undefined : navigator.permissions;
  if (!perms?.query) return "unknown";
  for (const name of NAMES) {
    try {
      const status = await perms.query({ name } as unknown as PermissionDescriptor);
      return status.state;
    } catch {
      /* this browser doesn't know the name: try the next */
    }
  }
  return "unknown";
}

/** The app itself is served from this computer (the dev server): no permission is needed. */
export function pageIsLocal(): boolean {
  const h = globalThis.location?.hostname ?? "";
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost");
}

/** Safari doesn't let a website reach http://localhost at all. */
export function browserCantReachLocal(ua = globalThis.navigator?.userAgent ?? ""): boolean {
  return /Safari\//.test(ua) && !/(Chrome|Chromium|CriOS|Edg|EdgiOS|Firefox|FxiOS|OPR)\//.test(ua);
}
