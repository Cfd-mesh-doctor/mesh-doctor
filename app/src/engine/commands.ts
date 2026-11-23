// SPDX-License-Identifier: GPL-3.0-or-later
// The engine's commands the app gives you to run in WSL or a Linux terminal, until it can start them itself.

/** A plain folder name, as the engine takes for a run, and finds a case by from any folder: letters, digits and
 * _ . - (not first), at most 80. */
const PLAIN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$/;

/** Whether `name` is a plain folder name, as the engine takes for a case or a run. */
export function isPlainName(name: string): boolean {
  return PLAIN.test(name);
}

/** The limits a repair checks the mesh against: OpenFOAM's usual ones (the default), or stricter ones. */
export type RepairProfile = "openfoam" | "strict";

/** A name for a new repair run of case `source` that no run has yet: `<case>-fix`, else `<case>-fix-2` and so on,
 * as `meshdoctor full` replaces a run of the same name. None for a case whose name isn't a plain folder name: the
 * engine finds such a case only from its own folder, and can't start a repair of it. */
export function repairName(source: string, runs: Iterable<string>): string | null {
  if (!PLAIN.test(source)) return null;
  const taken = new Set(runs);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "-fix" : `-fix-${n}`;
    const name = source.slice(0, 80 - suffix.length) + suffix;
    if (!taken.has(name)) return name;
  }
}

/** The command that repairs a copy of case `source` as run `name`, with the strict limits when asked for. */
export function fullCommand(source: string, name: string, profile: RepairProfile = "openfoam"): string {
  return `meshdoctor full ${source} ${name}${profile === "strict" ? " --profile strict" : ""}`;
}

/** The command that repairs a copy of case `source`, naming the copy as `repairName` does. None for a case whose
 * name isn't a plain folder name. */
export function repairCommand(source: string, runs: Iterable<string>, profile: RepairProfile = "openfoam"): string | null {
  const name = repairName(source, runs);
  return name && fullCommand(source, name, profile);
}

/** The command that runs the solver A/B test of repair run `name` against its source case `source` (its folder's
 * name, which the engine finds in the cases folder): the result lands where the run's report reads it. None when
 * either isn't a plain folder name. */
export function abCommand(source: string | null, name: string): string | null {
  return source && PLAIN.test(source) && PLAIN.test(name) ? `meshdoctor ab ${source} ${name}` : null;
}
