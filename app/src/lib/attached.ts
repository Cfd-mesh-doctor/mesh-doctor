// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * What's written against a code with no space between: the end of the text before it ("(") and the start of the text
 * after it ("),"), up to a space or the next mark a doc's text may hold (a backtick, a star, a bracket). It goes to the
 * next line with the code (InlineCode), rather than stay behind at a line's end.
 */
export function attached(before: string, after: string) {
  const lead = /\S*$/.exec(before)?.[0] ?? "";
  const trail = /^[^\s`*[]*/.exec(after)?.[0] ?? "";
  return { before: before.slice(0, before.length - lead.length), lead, trail, after: after.slice(trail.length) };
}
