// SPDX-License-Identifier: GPL-3.0-or-later
// What a paired engine fills in on the size estimator: the memory OpenFOAM may use and the solver ranks, from the
// computer the engine runs on (GET /machine).
import type { MachineInfo } from "@/engine/types";
import { LIMITS } from "./estimate";

export interface MachineFields {
  /** GB, rounded down to 0.1 GB so that "fits" is never generous */
  ram?: number;
  /** the memory is the engine's RAM limit (ram_limit_mb), lower than all of Linux's memory */
  limited?: boolean;
  cores?: number;
}

const known = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const accepts = (k: "ram" | "cores", v: number) => v >= LIMITS[k].min && v <= LIMITS[k].max;

/**
 * Memory: the RAM guard's limit when the engine has a lower one, else all the memory Linux may use (inside WSL,
 * what WSL was given). Ranks: the physical cores, else the processors. A value the engine doesn't know, or one the
 * estimator would refuse, is left out, and the field keeps the example's value.
 */
export function machineFields(m: MachineInfo): MachineFields {
  const out: MachineFields = {};
  const total = known(m.memoryMb) ? m.memoryMb : undefined;
  const limit = known(m.ramLimitMb) && (total === undefined || m.ramLimitMb < total) ? m.ramLimitMb : undefined;
  const mb = limit ?? total;
  if (mb !== undefined) {
    const gb = Math.floor((mb / 1024) * 10) / 10;
    if (accepts("ram", gb)) {
      out.ram = gb;
      if (limit !== undefined) out.limited = true;
    }
  }
  const cores = known(m.cores) ? m.cores : known(m.cpus) ? m.cpus : undefined;
  if (cores !== undefined && Number.isInteger(cores) && accepts("cores", cores)) out.cores = cores;
  return out;
}
