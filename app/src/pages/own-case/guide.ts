// SPDX-License-Identifier: GPL-3.0-or-later
// The text of docs/templates.md: its title and opening, the command that copies the example, then each section's
// paragraphs, list items and code exactly as the doc writes them. guide.test.ts compares them with the doc, so the
// page can't fall behind it.
import type { DocSection } from "@/lib/docSections";

export const TITLE = "Starting your own case from the Ahmed example";

export const INTRO = "`examples/ahmed-body` is a complete, tested external-aero case (snappyHexMesh, steady k-omega SST, moving ground, forces). Copy the folder and change the parts below; leave the rest.";

export const COPY = "cp -r examples/ahmed-body $FOAM_RUN/mycase && cd $FOAM_RUN/mycase && ./Allclean";

export const GUIDE: DocSection[] = [
  {
    id: "1-geometry",
    title: "1. Geometry",
    blocks: [
      {
        text: "Put your STL in `constant/geometry/` and point the case at it:",
      },
      {
        list: [
          "`system/surfaceFeaturesDict`: `surfaces (\"mymodel.stl\");`",
          "`system/snappyHexMeshDict`: in `geometry`, `mymodel { type triSurface; file \"mymodel.stl\"; }`, and rename the `ahmed` entry in `refinementSurfaces` and the `\"ahmed.*\"` layer entry. Keep `inGroups (ahmedGroup)` (or rename the group everywhere: the `initial/` fields and both force functions in `system/controlDict` use it).",
          "`Allmesh`: replace the `make_ahmed.py` line with nothing (your STL is already there).",
          "One STL solid per part gives one patch per part (`mymodel_frontWing`, ...), so you can get forces per part.",
        ],
      },
      {
        text: "Check the STL first: `surfaceCheck constant/geometry/mymodel.stl` must say \"Surface is closed\" and one zone per body. Export in metres, with the toolkit's axes (x forward, z up, ground at z = 0) so the scripts' views are right.",
      },
    ],
  },
  {
    id: "2-domain-and-cells",
    title: "2. Domain and cells",
    blocks: [
      {
        list: [
          "`system/blockMeshDict`: about 3-4 lengths ahead, 6-8 behind, 3+ heights above and to the side; blockage under 5 %. Keep the background cell a power-of-two multiple of the sizes you want near the body.",
          "`system/snappyHexMeshDict`: refinement boxes around the near body, the wake and small gaps; surface levels per part (thin plates need cells under 1/3 of their thickness). Read \"Cells per refinement level\" in `log.snappyHexMesh`.",
          "Size it first: `python3 skills/cfd-results/scripts/size_estimate.py <million cells>`.",
        ],
      },
    ],
  },
  {
    id: "3-flow-conditions",
    title: "3. Flow conditions",
    blocks: [
      {
        list: [
          "`initial/conditions`: free-stream velocity (pointing toward -x), `kInf`, `omegaInf`.",
          "`system/controlDict`: `magUInf`, `lRef`, `Aref` (half the frontal area for a half model), `CofR`, `rhoInf` in both force functions.",
        ],
      },
    ],
  },
  {
    id: "variant-wheel-and-wing-on-a-moving-ground-full-model-no-symmetry",
    title: "Variant: wheel and wing on a moving ground (full model, no symmetry)",
    blocks: [
      {
        text: "A ready-made case for this is in `examples/wheel-wing` (tested: 0.92 M cells, solves at 0.9 s per iteration on 6 cores; see its README). The steps below turn the Ahmed case into one by hand.",
      },
      {
        list: [
          "`system/blockMeshDict`: domain on both sides (y from -Y to +Y); turn the `symmetry` patch into a second `side` patch (type patch) and set it to `slip` in `initial/*`.",
          "Sink the tyre 3-6 mm into the ground (flat contact patch) in CAD, so there is no zero-thickness wedge.",
          {
            text: "Rotating wheel, in `initial/U` (give the wheel its own STL solid, e.g. patch `model_wheel`):",
            code: "model_wheel\n{\n    type    rotatingWallVelocity;\n    origin  (0.21 0.01 0.198);     // wheel centre\n    axis    (0 1 0);               // sign: the contact patch must move like the ground (toward -x)\n    omega   75.7;                  // rad/s = U / rolling radius\n}",
          },
          "Add a refinement box for the tyre contact and the gap between parts. Expect 1500+ iterations before a rotating wheel's forces settle.",
        ],
      },
    ],
  },
  {
    id: "variant-half-car-with-a-symmetry-plane",
    title: "Variant: half car with a symmetry plane",
    blocks: [
      {
        text: "The Ahmed case already is one: keep `symmetry` at y = 0 and model the left half only. Halve `Aref` (and remember that forces are for the half car: double them for the full car, except side force and yaw/roll moments, which cancel). Asymmetric cars need a full model.",
      },
    ],
  },
  {
    id: "after-meshing",
    title: "After meshing",
    blocks: [
      {
        text: "Run `meshdoctor full <case> <name>` before solving; if it reports regressions it rolls them back. The repair works on a copy in the workspace, so `./Allrun <ranks> <iterations>` in your case solves the original mesh. To solve the repaired one, run the A/B test, `meshdoctor ab <case> <name>`: it solves both meshes with the same setup and compares them, and `meshdoctor ab extend <workspace>/<name>_ab <iterations>` continues the repaired run. Judge the result with the cfd-results skill (last-window means, drift).",
      },
    ],
  },
];
