---
name: paraview-post
description: Make CFD pictures and charts from OpenFOAM results with ParaView (pvbatch, offscreen, in WSL/Linux) - plane cuts coloured by U/Cp/Cp,t, Q-criterion vortex iso-surfaces, unphysical pressure spot finding, contact sheets, and residual/force convergence charts. Use when the user wants flow pictures, vortex views, cut planes, or convergence plots of an OpenFOAM case.
---

# ParaView post-processing (offscreen)

Scripts are in `scripts/` next to this file. All are read-only on the case. Axes convention: x forward (flow goes
toward -x), z up, model on a ground at z = 0. A case in other axes is turned into these axes on a copy (below)
rather than by editing the scripts' cameras.

## Cases in other axes

Rotate a copy holding only `constant/`, `system/` and the time to render (tested on OpenFOAM 14):

```bash
cp -r case/constant case/system case_tk/ && cp -r case/<time> case_tk/ && cd case_tk
foamDictionary system/controlDict -entry startFrom -set latestTime   # transformPoints works on the start time
transformPoints -rotateFields "Rx=90"          # y up -> z up      (mesh points and the vector fields of <time>)
transformPoints -rotateFields "Rz=180"         # flow toward +x -> toward -x
transformPoints "translate=(0 0 0.123)"        # ground to z = 0 (minus the ground height after rotating)
```

Without `-rotateFields` only the mesh turns and `U` points the wrong way. `postProcessing/` force files are not
rotated: chart those from the original case with `plot_convergence.py --drag/--down` instead. Check with
`checkMesh` (bounding box) before rendering.

## Setup

- Ubuntu 22.04 apt: `paraview`, `python3-paraview` (5.10). Run scripts with
  `PYTHONPATH=/usr/lib/python3/dist-packages pvbatch --force-offscreen-rendering script.py ...`
  (pvbatch can't find its own modules without that PYTHONPATH). On WSL, offscreen rendering works through WSLg.
- Create an empty `case.foam` file in the case folder for the reader.
- Never open the ParaView GUI unless the user asks: it pops up a window on their screen.

## Scripts

| Script | Does |
|---|---|
| `cut_views.py CASE.foam decomposed\|reconstructed OUTDIR CUTS.json "note {it}" --walls a,b [--uinf 15] [--mean]` | plane cuts from a JSON list (`cuts_example.json`), or `auto` for three made from the walls' bounds (written to OUTDIR/cuts.json), coloured by U, Cp, Cp,t; the model cut away on the camera side |
| `vortex_views.py CASE.foam OUTDIR "3000,10000,30000" --walls a,b [--zoom PATCH] [--note ...] [--mean]` | Q-criterion iso-surfaces coloured by x-vorticity; `--selftest OUTDIR` checks the pipeline: the test vortex must come out red, its verdict in OUTDIR/selftest.json (exit 3 when it didn't pass) |
| `pressure_spots.py CASE.foam kind OUTDIR PREFIX --walls a,b [--uinf] [--rho] [--note ...] [--mean]` | finds wall faces with Cp < -5, clusters them, prints each spot's extra force, renders the worst |
| `plot_convergence.py CASE OUTDIR PREFIX "subtitle" [--total FO] [--parts FO:Label,...] [--drag -x --down -z] [--uinf] [--rho]` | residual, total-force and per-part force charts + summary CSV and Markdown tables (python3 + matplotlib, no ParaView) |
| `make_contact.py OUTDIR PREFIX sheet.png` | one contact sheet of many renders, for a quick look |

`--mean` (the three ParaView scripts) reads a transient run's mean flow, UMean and pMean (written by its fieldAverage once the averaging is on), in place of U and p; the pictures say so.

Wall patch names come from `constant/polyMesh/boundary`. Pick Q levels by trying a few: on a 15 m/s car, 3,000
showed the whole vortex system, 10,000 the main vortices, 30,000 only the strongest cores; 1,000 was clutter.

## Memory and time (31M-cell case, 8 cores)

Reading the volume with cell-to-point peaked ~18 GB; a full picture set ~3.5 min. The Q gradient is single-threaded
(~3 min). A 12M case: ~7 GB. Read the reconstructed case with `Decomposepolyhedra=0` to save memory, unless cuts show
white holes (then 1).

## Traps (each one broke a run)

- A decomposed internal mesh comes with cell data only: add `CellDatatoPointData` before calculators, contours,
  streamlines.
- `ColorBy(rep, None)` throws on a mesh without arrays; set `rep.ColorArrayName = ['POINTS', '']`.
- `ColorBy` resets the colour range to the data range (one bad face at Cp -77 ruins it): re-apply fixed ranges after.
- The first `Render()` refits the camera: call `_DisableFirstRenderCameraReset()` and render once during setup.
- Probe planes (`ResampleWithDataset`): clip on `vtkValidPointMask > 0.5`, or points inside solids show 0 m/s.
- The reader's `MeshRegions` list is empty until `UpdatePipelineInformation()`; regions are `internalMesh` and
  `patch/<name>`.
- 5.10 can't draw a background behind text or colour bars; keep bands of the frame clear instead (cut_views does).
- Surface LIC: load the plugin by path (`LoadPlugin('/usr/lib/x86_64-linux-gnu/paraview-5.10/plugins/SurfaceLIC/SurfaceLIC.so', remote=False, ns=globals())`).
- Case `0/` files using `#includeEtc` read as empty fields in 5.10; solver-written times are fine.
- A background job piped through `| cut` block-buffers its log: watch `ps -C pvbatch` (RSS, %CPU) instead.
- Q extremes are junk from bad polyhedra; never quote max/min Q, only the levels you drew.

## Formulas (incompressible, kinematic p)

Cp = p / (0.5 U^2); Cp,t = (p + 0.5|U|^2) / (0.5 U^2); Q = 0.5(|Omega|^2 - |S|^2); on a Q = q surface |omega| >= 2 sqrt(q).
Free-stream Cp,t slightly above 1 means the inlet pressure sits a little above the outlet's 0: normal.
