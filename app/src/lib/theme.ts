// SPDX-License-Identifier: GPL-3.0-or-later
// Light, dark or follow the system. public/theme.js applies the saved choice before the first paint;
// this keeps every control that shows the theme in step.
import { useSyncExternalStore } from "react";
import { readItem, writeItem } from "./storage";

export type Theme = "light" | "dark" | "system";
const KEY = "md-theme";

export function savedTheme(): Theme {
  const t = readItem(KEY);
  return t === "light" || t === "dark" ? t : "system";
}

function systemDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(t: Theme): void {
  document.documentElement.classList.toggle("dark", t === "dark" || (t === "system" && systemDark()));
}

let current: Theme = typeof window === "undefined" ? "system" : savedTheme();
const listeners = new Set<() => void>();

export function setTheme(t: Theme): void {
  current = t;
  writeItem(KEY, t);
  applyTheme(t);
  listeners.forEach((l) => l());
}

/** Once, at start: apply the saved theme and follow the system while "system" is chosen. */
export function initTheme(): void {
  applyTheme(current);
  if (typeof window.matchMedia !== "function") return;
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (current === "system") applyTheme("system");
  });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, () => current, () => current);
  return [theme, setTheme];
}
