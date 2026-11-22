// SPDX-License-Identifier: GPL-3.0-or-later
// The name of a code block's copy button (CopyBlock.tsx), kept in a module of its own so fast refresh keeps
// working for the component.

/** The button's name, saying what it copies by the block's first line: "Copy the 2 lines starting “/plugin …”". */
export function copyBlockLabel(code: string): string {
  const lines = code.replace(/\n+$/, "").split("\n");
  const first = (lines.find((l) => l.trim()) ?? "").replace(/\s+/g, " ").trim();
  const shown = first.length > 40 ? `${first.slice(0, 40).trimEnd()}…` : first;
  return lines.length === 1 ? `Copy “${shown}”` : `Copy the ${lines.length} lines starting “${shown}”`;
}
