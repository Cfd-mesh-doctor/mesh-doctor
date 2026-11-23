// SPDX-License-Identifier: GPL-3.0-or-later
// The problems of docs/troubleshooting.md, section by section, each table exactly as the doc writes it (`code` in
// backticks, **bold**). problems.test.ts compares them with the doc, so the page can't fall behind it.
import type { DocTable } from "@/lib/docTable";

export interface ProblemGroup {
  /** the section's anchor, as GitHub makes it from the doc's heading */
  id: string;
  title: string;
  table: DocTable;
}

export const GROUPS: ProblemGroup[] = [
  {
    id: "openfoam-runs",
    title: "OpenFOAM runs",
    table: {
      head: ["You see", "Why", "Fix"],
      rows: [
        [
          "A restarted parallel run starts again at time 0, and `postProcessing/*/0/*.dat` is overwritten",
          "`startFrom latestTime` looks at the case's root folder, which only holds `0/` in a decomposed case",
          "`startFrom startTime; startTime <last time in processor0>;`",
        ],
        [
          "`Cannot find patchField entry for procBoundary...`",
          "fields copied into `processor*/0` as they are (`decomposePar -copyZero`) without the processor patches",
          "let `decomposePar` split the fields (no `-copyZero`), or add `#includeEtc \"caseDicts/setConstraintTypes\"` to every field",
        ],
        [
          "`decomposePar` ignores your method",
          "OpenFOAM 14 reads `decomposer`, not `method`",
          "set both in `decomposeParDict`",
        ],
        [
          "The run is 2-3x slower than expected",
          "many separate `forces` function objects; running on battery; heavy apps on Windows; a forgotten ParaView in WSL",
          "one forces object (or fewer, written less often); plug in; close apps; check `ps -eo comm,rss --sort=-rss` in WSL",
        ],
        [
          "WSL (and the run) stopped overnight",
          "Windows Update updated WSL, or the PC slept",
          "pause updates and sleep during long runs; restart from the last save",
        ],
        [
          "A long run is very slow with max non-orthogonality around 65",
          "non-orthogonal correctors on every step",
          "`nNonOrthogonalCorrectors 0` was stable at 65 degrees; repair the mesh (Mesh Doctor) first",
        ],
        [
          "`pgrep -f name` finds a process that isn't there",
          "it matches its own `bash -lc '...name...'` command line",
          "`pgrep -x name` or `ps -C name`",
        ],
      ],
    },
  },
  {
    id: "snappyhexmesh",
    title: "snappyHexMesh",
    table: {
      head: ["You see", "Why", "Fix"],
      rows: [
        [
          "Holes or missing parts in the mesh",
          "hollow bodies in the CAD export (STEP `BREP_WITH_VOIDS`) or an STL that is not closed",
          "fill voids in CAD; `surfaceCheck model.stl` must say \"Surface is closed\"",
        ],
        [
          "Dozens of tiny wall patches (\"spots\")",
          "micro faces at CAD joints",
          "heal or merge them in CAD before export",
        ],
        [
          "Thin plates come out ragged",
          "cells larger than about 1/3 of the plate thickness",
          "refine that surface (and holes in it) further",
        ],
        [
          "Far more cells than planned",
          "refinement sizes snap down to the next level; volume boxes at fine levels cost far more than volume / cell size^3",
          "read \"Cells per refinement level\" in the log; request sizes just above a level; keep fine levels in small boxes",
        ],
        [
          "Out of memory while meshing",
          "~2.1 GB per million cells, serial",
          "`skills/cfd-results/scripts/size_estimate.py`; mesh in parallel or on a bigger machine",
        ],
      ],
    },
  },
  {
    id: "mesh-doctor",
    title: "Mesh Doctor",
    table: {
      head: ["You see", "Why", "Fix"],
      rows: [
        [
          "\"Mesh Doctor runs on Linux\"",
          "started from Windows Python",
          "run inside WSL: `wsl python3 -m meshdoctor ...`",
        ],
        [
          "`No module named meshdoctor`",
          "started outside the repository folder",
          "`cd` to the repository, or use `bin/meshdoctor`",
        ],
        [
          "Nothing improved, nothing regressed",
          "the mesh is already within every target",
          "fine; to push max non-orthogonality lower, try `meshdoctor experimental ratchet`",
        ],
        [
          "The A/B test refuses the repaired copy",
          "faces were collapsed (topology changed)",
          "the A/B test needs point moves only; compare with a fresh solve instead",
        ],
        [
          "The source must be serial",
          "only `processor*/` holds the mesh",
          "reconstruct in a copy first (`reconstructPar -constant`)",
        ],
      ],
    },
  },
  {
    id: "web-app",
    title: "Web app",
    table: {
      head: ["You see", "Why", "Fix"],
      rows: [
        [
          "\"The engine isn't answering\"",
          "`meshdoctor serve` isn't running, or listens on another port than the pairing link names; or the site's address isn't in the engine's `app_origins` (your own build or a fork)",
          "start it with `meshdoctor serve` in WSL or a Linux terminal, then **Try again**; for another site address, add it to `app_origins` (README, Configuration) and restart the engine",
        ],
        [
          "\"Your browser blocked the connection\"",
          "Chrome or Edge asked to let the site reach apps on your device, and it was blocked",
          "the icon left of the address bar → Site settings → allow \"Apps on device\" (Local network access), then try again",
        ],
        [
          "\"This browser needs pairing again\"",
          "the key was replaced (`meshdoctor pair --new`; a running engine keeps the old one until it restarts), or this browser's site data was cleared",
          "if you ran `meshdoctor pair --new` since the engine started, restart it first (Ctrl+C in its window, then `meshdoctor serve`); then `meshdoctor pair --open` in a second WSL or Linux terminal (the engine keeps its own busy), or paste the link it prints on the Connect page",
        ],
        [
          "\"This engine version doesn't match the app\"",
          "the engine's API is a different major version from the app's",
          "`git pull` in the repository, then restart `meshdoctor serve`",
        ],
        [
          "Safari never connects",
          "Safari doesn't let websites reach this computer",
          "use Chrome or Edge",
        ],
      ],
    },
  },
  {
    id: "paraview-pvbatch",
    title: "ParaView (pvbatch)",
    table: {
      head: ["You see", "Why", "Fix"],
      rows: [
        [
          "`No module named paraview`",
          "pvbatch can't find its own Python modules",
          "`PYTHONPATH=/usr/lib/python3/dist-packages pvbatch ...`",
        ],
        [
          "Empty fields at time 0",
          "the case's `0/` files use `#includeEtc`, which ParaView 5.10 can't parse",
          "read solver-written times (`SkipZeroTime`, the default in the scripts)",
        ],
        [
          "White holes in cut planes",
          "polyhedral cells not decomposed",
          "set `Decomposepolyhedra = 1` on the reader (more memory)",
        ],
        [
          "Points inside the body show 0 m/s on probe planes",
          "probe points outside the fluid",
          "clip on `vtkValidPointMask > 0.5`",
        ],
        [
          "Views look sideways, from below, or from the wrong end",
          "the case is not in the toolkit's axes (x forward, flow toward -x, z up)",
          "rotate a copy with `transformPoints -rotateFields`, see the paraview-post skill \"Cases in other axes\"",
        ],
        [
          "Colour range ruined by one face",
          "`ColorBy` resets to the data range",
          "re-apply fixed ranges after every `ColorBy`",
        ],
      ],
    },
  },
  {
    id: "simscale",
    title: "SimScale",
    table: {
      head: ["You see", "Why", "Fix"],
      rows: [
        [
          "\"This name is not allowed\" on Simulation runs",
          "a comma or period in a force-group or mesh name",
          "letters, digits, spaces and `( ) - + _` only",
        ],
        [
          "\"multiple-regions-in-single-region-mesh\"",
          "the solid bodies are still next to the flow volume",
          "delete them after creating the flow volume",
        ],
        [
          "\"No instance with sufficient computational resources\" at mesh start",
          "automatic sizing estimated far too many cells",
          "switch to manual sizing",
        ],
        [
          "Solver crash at start or \"out-of-memory\", no core hours charged",
          "mesh too big for the Community plan (~14M cells)",
          "trim to about 10-13M",
        ],
        [
          "A run can't be continued",
          "Community runs report `isContinuable: false`",
          "start a fresh run with a higher end time (it repeats the first part exactly)",
        ],
      ],
    },
  },
  {
    id: "google-cloud",
    title: "Google Cloud",
    table: {
      head: ["You see", "Why", "Fix"],
      rows: [
        [
          "Can't create a VM with more than 12 vCPUs",
          "the free trial caps CPUs at 12 across all regions",
          "12 vCPU / 96 GB custom N2, or upgrade the account (the owner's decision)",
        ],
        [
          "Restarting the VM does nothing",
          "the startup script runs once (marker file)",
          "raise `iterations` and use a new marker / script, see the cloud-solve-gcp skill",
        ],
        [
          "No `cfdrun: started` on serial port 1",
          "gcloud not ready yet, or the bucket metadata key is missing",
          "wait 3 min; check the `bucket` metadata key",
        ],
      ],
    },
  },
];
