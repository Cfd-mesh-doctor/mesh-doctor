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

/** How an A/B test runs, where it isn't the command's default: each run's iterations (200), the case's folder both
 * runs start from (auto: 0.warm when the case has one, else 0) and a solver-setting variant for the second run. */
export interface AbOptions {
  iters?: number;
  init?: string;
  variant?: string;
}

/** The command that runs the solver A/B test of repair run `name` against its source case `source` (its folder's
 * name, which the engine finds in the cases folder): the result lands where the run's report reads it. With a
 * variant the second run is the original mesh with those settings ("-" in place of the run), as the engine starts
 * it. None when either isn't a plain folder name. */
export function abCommand(source: string | null, name: string, { iters, init, variant }: AbOptions = {}): string | null {
  if (!source || !PLAIN.test(source) || !PLAIN.test(name) || (variant && !PLAIN.test(variant))) return null;
  return [
    `meshdoctor ab ${source} ${variant ? "-" : name}`,
    iters != null && iters !== 200 && `--iters ${iters}`,
    init && init !== "auto" && PLAIN.test(init) && `--init ${init}`,
    variant && `--variant ${variant}`,
  ].filter(Boolean).join(" ");
}

/** The command that continues the second run of A/B test `name` to iteration `to` and judges it again. */
/** The command that makes a set of pictures of case `name` in a terminal, as a picture job does: at `time` (else the
 * latest), of the `kinds` (all, unless fewer), of its mean flow with `mean`; null for a case whose name isn't a plain
 * folder name. */
export function picturesCommand(name: string, { time, kinds, mean }: {
  time?: string; kinds?: readonly string[]; mean?: boolean;
} = {}): string | null {
  if (!PLAIN.test(name) || (time && !/^[0-9][0-9.eE+-]*$/.test(time))) return null;
  return [`meshdoctor pictures ${name}`, time && `--time ${time}`, kinds && kinds.length < 3 && `--kinds ${kinds.join(",")}`,
    mean && "--mean"].filter(Boolean).join(" ");
}

export function abExtendCommand(name: string, to: number): string | null {
  return PLAIN.test(name) && Number.isInteger(to) ? `meshdoctor ab extend ${name} ${to}` : null;
}
