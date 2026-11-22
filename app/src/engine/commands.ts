// SPDX-License-Identifier: GPL-3.0-or-later
// The engine's commands the app gives you to run in WSL, until it can start them itself.

/** A plain folder name, as the engine takes for a run, and finds a case by from any folder: letters, digits and
 * _ . - (not first), at most 80. */
const PLAIN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$/;

/** The command that repairs a copy of case `source`, naming the copy with a name no run has yet: `<case>-fix`, else
 * `<case>-fix-2` and so on, as `meshdoctor full` replaces a run of the same name. None for a case whose name isn't a
 * plain folder name: the engine finds such a case only from its own folder, and can't start a repair of it. */
export function repairCommand(source: string, runs: Iterable<string>): string | null {
  if (!PLAIN.test(source)) return null;
  const taken = new Set(runs);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "-fix" : `-fix-${n}`;
    const name = source.slice(0, 80 - suffix.length) + suffix;
    if (!taken.has(name)) return `meshdoctor full ${source} ${name}`;
  }
}
