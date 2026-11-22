// SPDX-License-Identifier: GPL-3.0-or-later
// Will a case fit, how long will the solve take, what will it cost? A browser port of the engine's
// skills/cfd-results/scripts/size_estimate.py, with the same coefficients, each measured on a real run
// (OpenFOAM 14, incompressible steady k-omega SST on snappyHexMesh meshes, or SimScale's Community plan).
// Rough answers, ±30 %: the time depends on the CPU, the mesh quality and the function objects.

export interface EstimateInput {
  /** mesh size, millions of cells */
  cells: number;
  iterations: number;
  /** memory OpenFOAM can use on this computer, GB (WSL's default on a 32 GB PC is about 26) */
  ram: number;
  /** solver ranks used on this computer: physical cores, not threads */
  cores: number;
  /** dollars per hour for the cloud machine */
  price: number;
}

export type Field = keyof EstimateInput;

export const DEFAULTS: EstimateInput = { cells: 5, iterations: 1000, ram: 26, cores: 6, price: 0.84 };

/** What each field accepts. */
export const LIMITS: Record<Field, { min: number; max: number; integer?: boolean }> = {
  cells: { min: 0.001, max: 10_000 },
  iterations: { min: 1, max: 10_000_000, integer: true },
  ram: { min: 0.5, max: 16_384 },
  cores: { min: 1, max: 4096, integer: true },
  price: { min: 0, max: 10_000 },
};

/** A field's value, or null when the text isn't a number it accepts. */
export function parseField(field: Field, text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const v = Number(t);
  const { min, max, integer } = LIMITS[field];
  return Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v)) ? v : null;
}

/**
 * The mesh-size field for a mesh of `n` cells: millions, exact (12,225 cells is "0.012225", so the estimate says
 * "For 12,225 cells"), or null for a size the field would refuse (under 1,000 cells) or one that isn't known.
 */
export function cellsField(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const text = String(n / 1e6);
  return parseField("cells", text) == null ? null : text;
}

/** Memory, GB per million cells (measured). */
export const GB_PER_MILLION = { snappy: 2.1, solver: 1.75, decompose: 1.9, checkMesh: 0.67, meshDoctor: 1.5 } as const;
/** Mesh Doctor's repair needs about 1.5 KB per cell plus half a gigabyte. */
const MESH_DOCTOR_BASE_GB = 0.5;
/**
 * Solver cost, rank-seconds per million cells per iteration: a laptop-class CPU (Intel Core Ultra 7 on 6 ranks:
 * a 0.84 M-cell Ahmed body ran at about 1.3 s per iteration) and the cloud machine (a 31 M-cell car: 67 s).
 */
export const RANK_SECONDS = { laptop: 9.5, cloud: 13 } as const;
/** The cloud machine the coefficients come from, and the time to install, download, decompose and upload. */
export const CLOUD_VM = { vcpus: 12, ram: 96, ranks: 6, setupSeconds: 15 * 60 } as const;
/**
 * SimScale Community plan: core hours per million cells per 1000 iterations, and for meshing per million cells;
 * its solver ran out of memory at about 14 M cells (about 20 M crashed at the start).
 */
export const SIMSCALE = { coreHours: 2.6, meshCoreHours: 0.3, maxCells: 13 } as const;
/** A step fits when it needs less than 90 % of the memory. */
export const HEADROOM = 0.9;

export interface MemoryStep {
  key: "snappy" | "solver" | "decompose" | "checkMesh" | "meshDoctor";
  label: string;
  note: string;
  gb: number;
  fits: boolean;
}

export interface Estimate {
  memory: MemoryStep[];
  /** the step that needs the most memory */
  peak: MemoryStep;
  local: { seconds: number; fits: boolean };
  cloud: { seconds: number; cost: number; decomposeGB: number; decomposeFits: boolean };
  simscale: { coreHours: number; tooBig: boolean };
}

export function estimate(i: EstimateInput): Estimate {
  const m = i.cells;
  const step = (key: MemoryStep["key"], label: string, note: string, gb: number): MemoryStep =>
    ({ key, label, note, gb, fits: gb < HEADROOM * i.ram });
  const solver = step("solver", "Solver", "all ranks together", GB_PER_MILLION.solver * m);
  const memory = [
    step("snappy", "snappyHexMesh", "meshing, one process", GB_PER_MILLION.snappy * m),
    solver,
    step("decompose", "decomposePar", "splitting the mesh for the ranks, one process", GB_PER_MILLION.decompose * m),
    step("checkMesh", "checkMesh", "one process", GB_PER_MILLION.checkMesh * m),
    step("meshDoctor", "Mesh Doctor repair", "one process", GB_PER_MILLION.meshDoctor * m + MESH_DOCTOR_BASE_GB),
  ];
  const cloudSeconds = (RANK_SECONDS.cloud * m * i.iterations) / CLOUD_VM.ranks + CLOUD_VM.setupSeconds;
  const decomposeGB = GB_PER_MILLION.decompose * m;
  return {
    memory,
    peak: memory.reduce((a, b) => (b.gb > a.gb ? b : a)),
    local: { seconds: (RANK_SECONDS.laptop * m * i.iterations) / i.cores, fits: solver.fits },
    cloud: {
      seconds: cloudSeconds,
      cost: (cloudSeconds / 3600) * i.price,
      decomposeGB,
      decomposeFits: decomposeGB < HEADROOM * CLOUD_VM.ram,
    },
    simscale: {
      coreHours: (SIMSCALE.coreHours * m * i.iterations) / 1000 + SIMSCALE.meshCoreHours * m,
      tooBig: m > SIMSCALE.maxCells,
    },
  };
}

const one = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "3.4 h" from an hour and a half up, else "24 min", as the engine's script words it. */
export function duration(seconds: number): string {
  if (seconds < 30) return "under 1 min";
  return seconds >= 5400 ? `${one.format(seconds / 3600)} h` : `${whole.format(seconds / 60)} min`;
}

export const gigabytes = (gb: number) => `${one.format(gb)} GB`;

export const money = (x: number) => (x < 10 ? `$${x.toFixed(2)}` : `$${whole.format(x)}`);

export const coreHours = (x: number) => (x < 10 ? one.format(x) : whole.format(x));
