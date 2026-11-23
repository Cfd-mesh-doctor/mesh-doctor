// SPDX-License-Identifier: GPL-3.0-or-later
// Code in running text: a command, a setting or a file name.

/** Short code stays on one line (a flag like -copyZero never splits at its hyphen, nor a command at its spaces); code
 *  longer than a narrow column may break anywhere, so a phone never scrolls sideways. */
export function InlineCode({ text }: { text: string }) {
  return <code className={text.length <= 24 ? "whitespace-nowrap" : "[overflow-wrap:anywhere]"}>{text}</code>;
}
