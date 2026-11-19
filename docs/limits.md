# Limits

## What Mesh Doctor is not
- **A good mesh for the geometry is not proof of a good mesh for the flow.** Mesh Doctor fixes geometric quality (non-orthogonality, skewness, weights, volume ratios, inverted cells). It does not refine, add boundary layers, change y+ or resolution, or tell you whether the mesh is fine enough. Check that the answer stops changing on a finer mesh, and compare with measurements where you can.
- **Converged is not the same as correct.** The A/B test and the judge show whether a run settles, and how much the forces still move. They do not say whether the forces are right.
- **It is not a mesher.** Point moves are small. A mesh with large inverted regions, leaks or missing surfaces needs new `snappyHexMesh` settings, not a repair.

## Versions and platforms
- **OpenFOAM 14 from openfoam.org only.** `./Allwmake` refuses any other version, including the ESI/OpenCFD releases (v2406 and similar), whose utilities and file formats differ.
- **Linux only**, including WSL on Windows and the containers. Native Windows Python refuses to run.
- **Cluster: one node per job** for now. Multi-node MPI from inside the container is not set up yet.

## The repair
- It changes only point positions, except where the collapse step runs (inverted pyramids). Collapsed faces change the topology: a few faces and points fewer. Fields written for the original mesh no longer fit that copy, and the A/B test refuses it.
- Geometry is kept: corners, sharp edges and patch junctions never move, and wall points only slide along the original surface. This also means a defect stuck against a sharp edge may not be fixable.
- Memory: about 1.5 KB per cell plus 0.5 GB (about 15 GB for 10 million cells).

## The A/B test and the judge
- **One mesh at a time:** the source must be a serial mesh (the case's own `constant/polyMesh` is the real mesh), and the repaired copy must have the same topology (point moves only).
- The A/B test runs steady `foamRun` cases (SIMPLE-type iterations). The judge handles both steady and transient runs; for transient runs it reads the PIMPLE outer iterations and Courant numbers from the solver log.
- A short A/B (tens of iterations) shows a trend, not a converged answer. Run enough iterations for the judge to give a verdict.
- The solver variants (`simplec`, `simplec2`, `relax`, `lts`) change `system/fvSolution` or `fvSchemes` in the copy only. They are starting points to try, not tuned settings.

## The map
- It needs numpy and a model sitting on a flat ground wall. The ground is found from the geometry and is used as "up".
- It is a 2D projection (side and top views). Use the Mesh Doctor page's 3D view, or ParaView, for detail.

## The dashboard
- One user per machine. Any user logged in to the same computer can reach a 127.0.0.1 port, so do not run `serve` on a shared login node (see [safety](safety.md)).
- It shows one live case at a time (`serve --case` or the `live_case` setting).

## Experimental tools

These are command-line only, are not on the dashboard, and are not covered by the guarantees above in the same way. Build their utility with `./Allwmake -experimental`.

- **`meshdoctor experimental ratchet <case> <name>`** keeps lowering the non-orthogonality target just below the current worst face, and re-runs the repair pass after pass until the maximum stops dropping (never below `--floor`, default 30°). Each pass keeps the normal repair rules. It lowers the maximum non-orthogonality below the 65° target, which the normal repair stops at.
- **`meshdoctor experimental polish <case> <name>`** moves groups of points around the worst non-orthogonal faces together, with a gradient method (`foamMeshPolish`). By default it may let face-tetrahedra failures ("bad tets" in checkMesh) grow up to 4 times the starting count, and let individual cells turn concave as long as the total number of concave cells does not rise. `--tet-cap 1` makes it strict. It rolls the points back if checkMesh shows any other regression.

Both work on a copy, like the main repair, and write their record to `<copy>/meshDoctor/ratchet.json` or `polish.json`.
