// SPDX-License-Identifier: GPL-3.0-or-later
// The repair dialog's checks: the new run's name, the case's size, and whether the repair fits in the memory of the
// engine's computer, worked out as the size estimator does.
import { isPlainName, type RepairProfile } from "@/engine/commands";
import type { Job, MachineInfo, RepairSummary } from "@/engine/types";
import { caseName } from "@/engine/verdict";
import { estimate } from "@/estimate/estimate";
import { machineFields } from "@/estimate/machine";

/** The two sets of limits a repair can check the mesh against (How it works lists them), named as on Repairs. */
export const PROFILES: readonly { value: RepairProfile; label: string; about: string }[] = [
  {
    value: "openfoam",
    label: "OpenFOAM's",
    about: "OpenFOAM's usual limits: non-orthogonality up to 65°, skewness up to 4, face weight at least 0.05 and " +
      "volume ratio at least 0.01.",
  },
  {
    value: "strict",
    label: "Strict",
    about: "Tighter limits: non-orthogonality up to 60°, skewness up to 3, face weight at least 0.1 and volume " +
      "ratio at least 0.05. More faces count as bad, so more get repaired.",
  },
];

/** Names a new run can't have: every run's, and every repair job's (a run a job is making may not be listed yet). */
export function takenNames(runs: readonly RepairSummary[] | undefined, jobs: readonly Job[] | undefined): Set<string> {
  return new Set([
    ...(runs ?? []).map((r) => r.name),
    ...(jobs ?? []).filter((j) => j.kind === "repair").map((j) => j.name),
  ]);
}

/** What's wrong with a new run's name, or null when the engine will take it. The engine would refuse a name that's
 * taken (the app never asks it to replace a run). */
export function nameProblem(name: string, taken: ReadonlySet<string>): string | null {
  if (!name) return "Give the new run a name.";
  if (!isPlainName(name)) {
    return "Use only letters, digits and _ . - (not . or - first), at most 80 characters.";
  }
  if (taken.has(name)) return "A run with this name exists already. Pick another name.";
  return null;
}

/** A case's size: the engine's count (API 1.2), else what its newest repair counted, else unknown. */
export function caseCells(
  name: string,
  cells: Readonly<Record<string, number | null>> | undefined,
  runs: readonly RepairSummary[] | undefined,
): number | null {
  const counted = cells?.[name];
  if (counted != null) return counted;
  const mine = (runs ?? []).filter((r) => caseName(r.source) === name && r.nCells != null);
  mine.sort((a, b) => (b.finished ?? "").localeCompare(a.finished ?? ""));
  return mine[0]?.nCells ?? null;
}

export interface MemoryCheck {
  /** GB the repair needs, as the size estimator works it out */
  need: number;
  /** GB a job may use on the engine's computer: its RAM limit when it has a lower one, else all of Linux's memory */
  have: number;
  /** `have` is the engine's RAM limit */
  limited: boolean;
  /** needs less than 90 % of it, as the estimator's "fits" */
  fits: boolean;
}

/** Whether a repair of a case of `cells` cells fits in the memory of the engine's computer; null when either isn't
 * known (the engine still checks its free memory when the repair starts). */
export function repairMemory(cells: number | null, machine: MachineInfo | undefined): MemoryCheck | null {
  if (cells == null || !(cells > 0) || !machine) return null;
  const { ram, limited } = machineFields(machine);
  if (ram === undefined) return null;
  const step = estimate({ cells: cells / 1e6, iterations: 1, ram, cores: 1, price: 0 }).memory
    .find((s) => s.key === "meshDoctor");
  return step ? { need: step.gb, have: ram, limited: limited === true, fits: step.fits } : null;
}
