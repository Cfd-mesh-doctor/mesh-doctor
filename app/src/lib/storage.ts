// SPDX-License-Identifier: GPL-3.0-or-later
// Browser storage that never throws: private windows and blocked site data just mean "nothing saved".

export function readItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeItem(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeItem(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing stored, nothing to remove */
  }
}

/** Whether this browser keeps what the site stores: not with its site data blocked. */
export function canStore(): boolean {
  if (!writeItem("md-probe", "1")) return false;
  removeItem("md-probe");
  return true;
}
