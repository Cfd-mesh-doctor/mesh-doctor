// SPDX-License-Identifier: GPL-3.0-or-later
// The words and numbers of the Solve screen's Ready to solve? (Solve.tsx), apart from its components.
import { formatInt } from "@/lib/format";

/** The command that runs the same checks in a terminal. */
export const CHECK_COMMAND = "meshdoctor check";

/** What an engine without the check (older than API 1.4) gets. */
export const OLD_ENGINE = "Your engine is older than this page and can't check its computer from here. Update Mesh " +
  "Doctor (`git pull` in its folder) and restart the engine, or run the same checks in a WSL or Linux terminal:";

/** A mesh size, rounded down so it's never more than the memory takes: 14,191,274 cells is "14.1 M". */
export function cellsAtMost(n: number): string {
  if (n >= 1e6) return `${(Math.floor(n / 1e5) / 10).toFixed(1)} M`;
  if (n >= 1e4) return `${Math.floor(n / 1e3)} k`;
  return formatInt(n);
}

/** The engine's sentence with its first letter a capital: it writes its fixes to follow what it found. */
export const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

