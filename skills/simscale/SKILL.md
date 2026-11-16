---
name: simscale
description: Run external-aero CFD on SimScale's free Community plan through its web workbench and same-origin API - geometry prep, flow volumes, snappy (hex-dominant) mesh sizing, cloning a setup across many design variants, starting runs, and downloading force and residual data. Use when the user works in SimScale or wants SimScale projects set up, compared or read out.
---

# SimScale (Community / free plan)

Driving SimScale works best through a browser tab the user is signed in to, using **same-origin `fetch()` calls from
the workbench page** (javascript tool) for reading and changing specs, and clicks only where the UI is needed (file
upload, starting a run). The user signs in and uploads files themselves; never type their password.

Read before doing anything:
- `references/api.md` - the endpoints that worked (specs, geometry operations, face lists, results, downloads).
- `references/meshing.md` - how snappy sizes really come out, cell-count calibration, memory limits, failures seen.

## Plan limits (Community)

- Only the finite-volume Incompressible solver (steady k-omega SST, or transient URANS/LES); LBM needs a paid plan.
- About 10 quantitative runs per account and a fixed core cap; you cannot choose the CPU count.
- Runs cannot be continued (`isContinuable: false`). **Before a "run it longer" request, check that flag, tell the
  user a fresh run repeats the iterations already done (and what that costs in core hours), and let them choose.**
  Runs are deterministic, so a longer fresh run reproduces the first part exactly. Set a higher end time up front for
  cases with a rotating wheel: they needed ~1500+ iterations to settle (1000 was misleading).
- Solver memory: ~14M cells died out-of-memory; ~20M crashed at start. Aim for 10-13M at most, 5-10M is safe.
- Crashed or cancelled meshes and runs charge no core hours. Cost guide: ~3 core hours per 100 iterations on ~10M
  cells; ~2.6 core hours per million cells per 1000 iterations on smaller cases.
- Names may only contain letters, digits, spaces and `( ) - + _`. A comma or period in a force-group or mesh name
  blocks "Simulation runs" with "This name is not allowed".

## Geometry

- Manufacturing CAD (skins + cores + caps) breaks flow-volume extraction. Make a CFD part: one body per touching
  group, touching faces nudged ~2 mm into each other, hollow parts filled. Grep the STEP for `BREP_WITH_VOIDS` before
  upload; voids become holes in the mesh.
- Micro faces at plate joints become dozens of tiny wall patches ("spots" in post-processing). They carry ~no force,
  but heal them in CAD for clean patches.
- Hex-dominant (snappy) refuses multiple volumes: after creating the external flow volume, delete the original
  bodies so only the flow region remains, then point the simulation at it.
- Check the CAD name right after every import (SimScale names it from the uploaded file); a wrong file is easy to miss.
- Excluding a part (e.g. a small add-on) without re-uploading: duplicate the geometry, edit its flow volume with the
  body in "Excluded parts", redo the delete.

## Domain and boundary conditions (car or wheel+wing aero)

- Domain: at least ~3 body lengths ahead and ~6 behind; a box only ~1.5 lengths ahead made the inlet oscillate.
- Inlet velocity, outlet 0 Pa, slip (or symmetry) on sides/top, moving ground at free-stream speed, rotating wheels
  (omega = U / rolling radius, axis sign so the contact patch moves with the ground), wheels sunk a few mm into the
  ground (flat contact patch).
- Half-car with a symmetry plane: put Symmetry on the actual centreline face of the flow region, not a box face that
  was defeatured.
- Force groups: make them disjoint and check they sum to the whole model (count faces per group).

## Cloning one setup across variants (angle-of-attack studies etc.)

1. Build and validate one project fully (geometry ops, BCs, force groups, mesh spec). Keep its spec JSON.
2. For each variant: new project, import its STEP, run the same geometry operations through the API, create the
   simulation, then PUT the template sim and mesh specs with face IDs remapped.
3. Remap faces by **class**, not by ID: box faces keep their IDs across projects, model faces are classified by
   bounding box (from the face-box query) - e.g. element 1/2/3 by face-centre height, endplates by span position.
4. Deep-compare the new specs with the template (ignoring IDs) before meshing. Check the mesh cell count against the
   template's (within ~1-2 %) before starting the run.
5. Start a run: the "+" next to "Simulation runs" (it only appears on hover; find the last "Create" button by
   accessibility tree), "Run anyway" on the quality warning, then Start. In an emulated small viewport coordinate
   clicks miss; prefer element refs.

## Results

- Force and residual CSVs: each result component has a `downloadUrl` with a token that works with plain `curl` for a
  few hours. Columns: Time, pressure xyz, total xyz, viscous xyz. Check the model's axes before naming drag and lift.
- Use last-N means (e.g. last 200 of 1000 iterations), their standard deviation, and the change between the last two
  windows. Differences between variants smaller than the remaining drift are not results (see cfd-results skill).
- Per-face forces without a re-run: download the run's solution fields (OpenFOAM ascii, one wall patch per CAD face),
  sum p * Sf per patch; this reproduced SimScale's own pressure force exactly.
- The current UI has no mesh download / OpenFOAM mesh export.
