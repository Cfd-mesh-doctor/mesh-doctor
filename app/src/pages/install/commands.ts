// SPDX-License-Identifier: GPL-3.0-or-later
// The install commands, as the README's quickstart gives them, and the set-up of its First run. commands.test.ts keeps
// them equal to the README's.
import { REPO_URL } from "@/lib/site";

/** The one-command set-ups: tools/setup_windows.ps1 (WSL, then the Linux script inside it) and tools/setup_linux.sh. */
export const SETUP = {
  windows: String.raw`powershell -ExecutionPolicy Bypass -File tools\setup_windows.ps1`,
  linux: "bash tools/setup_linux.sh",
} as const;

/** Ubuntu 22.04 for WSL, from an administrator PowerShell. */
export const WSL_INSTALL = "wsl --install -d Ubuntu-22.04";

export interface CommandGroup {
  /** the README's comment above the commands */
  title: string;
  /** each command with the README's comment after it, if any */
  commands: { command: string; note?: string }[];
}

/** Linux by hand: Ubuntu 22.04, or inside WSL. */
export const LINUX: CommandGroup[] = [
  {
    title: "OpenFOAM 14 (skip if you have it)",
    commands: [
      { command: 'sudo sh -c "wget -qO /etc/apt/trusted.gpg.d/openfoam.asc https://dl.openfoam.org/gpg.key"' },
      { command: 'echo "deb http://dl.openfoam.org/ubuntu jammy main" | sudo tee /etc/apt/sources.list.d/openfoam.list' },
      { command: "sudo apt update && sudo apt install openfoam14 python3-numpy" },
    ],
  },
  {
    title: "Mesh Doctor",
    commands: [
      { command: `git clone ${REPO_URL} mesh-doctor && cd mesh-doctor` },
      { command: ". /opt/openfoam14/etc/bashrc" },
      { command: "./Allwmake", note: "builds foamMeshDoctor and foamResidualHotspots" },
      { command: "bin/meshdoctor check", note: 'says "ready", or lists what is missing' },
    ],
  },
];

/** Docker, OpenFOAM included. */
export const DOCKER = [
  "docker build -t meshdoctor .",
  "docker run --rm -p 127.0.0.1:8765:8765 -v /path/to/cases:/cases:ro -v meshdoctor-work:/work meshdoctor",
];

/** The README's First run, up to its first blank line: load OpenFOAM, copy its motorBike tutorial into $FOAM_RUN (where
 * the engine looks for cases) and mesh it. The rest repairs it and tests the repair. */
export const FIRST_RUN_SETUP = [
  ". /opt/openfoam14/etc/bashrc",
  "mkdir -p $FOAM_RUN && cd $FOAM_RUN",
  "cp -r $FOAM_TUTORIALS/incompressibleFluid/motorBikeSteady motorBike",
  "cp $FOAM_TUTORIALS/resources/geometry/motorBike.obj.gz motorBike/constant/geometry/",
  "(cd motorBike && surfaceFeatures && blockMesh && snappyHexMesh) > mesh.log",
] as const;
