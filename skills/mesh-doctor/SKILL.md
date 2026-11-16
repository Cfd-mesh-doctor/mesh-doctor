---
name: mesh-doctor
description: Check, repair and prove OpenFOAM 14 meshes with Mesh Doctor (this repository). Use when the user wants to fix a bad OpenFOAM mesh (non-orthogonality, skewness, bad tets, concave or inverted cells, checkMesh failures), lower max non-orthogonality, compare a repaired mesh against the original in the solver (A/B test), judge whether a run has converged, or open the Mesh Doctor dashboard.
---

# Mesh Doctor

Mesh Doctor moves mesh points (and collapses a few faces) to fix bad cells **inside an existing OpenFOAM 14 mesh**, then
proves the result with checkMesh and, optionally, a solver A/B test. It never edits the source case: every job works
on a copy in the workspace.

## Before anything

1. It runs on Linux only (WSL on Windows). From Windows call it through `wsl -e bash -lc '...'`, or better, write a
   small `.sh` file and run `wsl -e bash /mnt/c/.../script.sh`: nested quotes, spaces in paths and `python -c` break
   inside `bash -lc '...'`. Git Bash rewrites `/mnt/c/...` paths passed to wsl.exe, so call wsl from PowerShell or cmd.
2. Load OpenFOAM first: `. /opt/openfoam14/etc/bashrc`. Only openfoam.org's OpenFOAM 14 works (not the ESI v2xxx).
3. Run `bin/meshdoctor check` once on a new machine. It says "ready" or lists what is missing.
4. Run commands from the repository root (`python3 -m meshdoctor ...`) or put `bin/` on the PATH.
5. Keep cases inside the Linux file system (`~/...`), not `/mnt/c`: OpenFOAM is many times slower there.

## Commands

```
meshdoctor full   <srcCase> <name> [--profile P]     copy -> checkMesh -> repair -> checkMesh (the normal job)
meshdoctor ab     <srcCase> <name> [--iters N]       same solver run on original vs repaired mesh
meshdoctor judge  <case> [window]                    has this run converged? how much do forces still move?
meshdoctor map    <name>                             2D map of where the repair worked vs residual hotspots
meshdoctor serve  [--port 8765] [--case <live>]      local dashboard at http://localhost:8765
meshdoctor experimental ratchet <src> <name>         push max non-ortho below the 65 deg target, pass by pass
meshdoctor experimental polish  <src> <name> [--tets] [--tet-cap 1]   gradient polish of the worst clusters
```

Every command has `--help`. Results land in the workspace copy's `meshDoctor/` folder as JSON (verdict, checkMesh
before/after, regressions, rollback flag).

## How to run a repair well

- **Start with `full`.** Read the verdict: `improved`, `regressions`, `rolledBack`. A regression means a checkMesh
  number got worse; the step is rolled back automatically.
- **Want a lower max non-orthogonality?** The normal repair stops once every face is under its target (65 deg).
  Run `experimental ratchet` next, then `experimental polish` on the ratchet's output.
- **Bad tets ("face tets" in checkMesh)?** `experimental polish --tets --tet-cap 1` repairs them strictly (never
  creates new ones). A `--tet-cap` above 1 trades bad tets for lower non-orthogonality; check the trade is worth it.
- **Memory:** about 1.5 KB per cell plus 0.5 GB (about 15 GB for 10 million cells, serial). Run one big job at a time,
  and check free RAM first (`free -g`). For very large meshes use zone mode if the repository has it
  (`python3 -m meshdoctor zone`): it cuts out only the bad regions.
- **The source must be serial** (a real `constant/polyMesh`). If only `processor*/` holds the mesh, reconstruct first
  (`reconstructPar -constant` / `reconstructParMesh -constant`) in a copy.

## Proving it helped

checkMesh numbers are not the goal; a run that converges better is. Use `meshdoctor ab <src> <name> --iters N`:
same case, same settings, original mesh vs repaired mesh. Then `meshdoctor judge` on each. Enough iterations matter:
a few tens of iterations show a trend, not an answer. Report residual levels and the last-window force means and
their spread, not just "it improved".

## What it cannot do

It does not refine, add layers, or fix leaks or missing surfaces: those need new meshing settings. Corners, sharp
edges and patch junctions never move, so a defect pinned against a sharp edge may stay. See `docs/limits.md`.

## Rules to keep

- Never write into the user's source case. Name test copies clearly (e.g. `test_<case>_<what>`).
- Report the before/after checkMesh table (max non-ortho, max skewness, bad tets, concave cells, failed checks).
- If a job fails or rolls back, stop and report what happened before trying something else.
