// SPDX-License-Identifier: GPL-3.0-or-later
// Finding a problem by what you see: a few words typed, or a whole message pasted from a log.

/** Text as it reads, for searching: no Markdown marks or double quotes, straight apostrophes, single spaces, lower case. */
export function plain(text: string): string {
  return text
    .replace(/[`*"\u201c\u201d]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The messages a "You see" cell quotes (in "quotes" or `code`), without a trailing "...": a log line holds them. */
function messages(seen: string): string[] {
  return [...seen.matchAll(/"([^"]+)"|`([^`]+)`/g)]
    .map((m) => plain((m[1] ?? m[2] ?? "").replace(/\.\.\.$/, "")))
    .filter((m) => m.length >= 8);
}

/**
 * Whether a problem (its row: You see, Why, Fix) matches what was typed: every word of it is somewhere in the row, or
 * the text holds a message the row quotes (a whole line pasted from a log, with more around it than the doc writes).
 * Nothing typed matches every problem.
 */
export function matches(row: string[], query: string): boolean {
  const q = plain(query);
  if (!q) return true;
  const text = plain(row.join(" "));
  return q.split(" ").every((word) => text.includes(word)) || holdsMessage(row, query);
}

/** Whether the text holds a message the problem's "You see" quotes: a whole line pasted from a log, say. */
export function holdsMessage(row: string[], query: string): boolean {
  const q = plain(query);
  return messages(row[0] ?? "").some((m) => q.includes(m));
}
