---
name: cfd-results
description: Judge and report CFD results honestly - convergence of residuals and forces, last-window averages and drift, comparing design variants and meshes, force groups per part, coefficients (CdA, ClA, L/D, balance), and building comparison workbooks or dashboards. Use whenever CFD forces are read out, compared between runs, or turned into a report, from OpenFOAM or SimScale.
---

# Reading CFD results

## Will it fit? How long? What will it cost?

`python3 scripts/size_estimate.py <million cells> [--iters 1000] [--ram 26] [--cores 6]` prints the memory each
step needs (snappyHexMesh, solver, decomposePar, checkMesh, Mesh Doctor), the local solve time, the Google Cloud
time and cost, and SimScale core hours, from measured runs (+-30 %). Run it before meshing anything big.

## Averages, not last values

- Steady RANS forces oscillate. Report the mean over a window at the end (e.g. the last 100-200 iterations of 1000),
  plus its standard deviation and **drift**: the change between the last window and the one before it.
- Drift of more than ~1 % (or more than the differences you want to show) means: run longer before comparing.
  Rotating-wheel cases needed ~1500+ iterations; at 1000 one comparison pointed the wrong way.
- Transient (DDES/LES): average only after the start-up transient (one to two flow-throughs), and compare the first
  and second halves of the averaging window.
- Residuals: report the final levels and the orders of magnitude they dropped. A plateau (e.g. p ~5e-2) that does not
  move with a finer mesh points at the mesh quality or unsteady flow, not at too few iterations.
- For an OpenFOAM case, `meshdoctor results <case>` (the mesh-doctor skill) does this: each force group's mean, sd,
  drift and the uncertainty of the mean over the judge's window, CdA, ClA and L/D, and how far each residual fell,
  with a plain warning when a force still drifts by more than 1 %.

## Comparing variants and meshes

- A difference between two designs is only real if it is larger than both runs' remaining drift and oscillation.
  Say so plainly when it is not ("inside the noise").
- Same mesh settings for every variant: clone the mesh spec, check cell counts agree within ~1-2 %, and keep the
  domain, BCs, and averaging window identical.
- Mesh independence: if a part's force moves more between two meshes than it oscillates, it is not mesh-independent.
  Say which parts are trustworthy.
- Small parts with near-zero forces (small patches, micro faces) can be checked by summing p * Sf per patch from the
  fields; this matched a solver's integrated pressure force exactly.
- For two OpenFOAM runs, `meshdoctor compare <a> <b>` averages both over the same window and says, for each force
  group, whether the difference is real or inside the noise; `--mesh` reads them as a mesh study. It warns when a
  design comparison's meshes differ by more than 2 % in cells.

## Signs and coefficients

- Check the frame first: which axis is the flow, which is up. With flow toward -x and z up: drag = -Fx, downforce =
  -Fz. SimScale and OpenFOAM both report force on the body.
- Total = pressure + viscous. q = 0.5 rho U^2 (use the same rho as the solver's `rhoInf`).
- CdA = D / q, ClA = L / q (m^2) avoid arguing about the reference area. L/D = downforce / drag.
- Front/rear balance from the pitching moment about the front axle: rear load = -My / wheelbase (check the sign on
  a known case).
- Force groups: disjoint, and they must sum to the total. Count faces per group to prove it.

## Reporting

- Put numbers in a table: mean, sd, drift, cells, iterations. State what is not converged or not verified.
- Charts: residuals on a log scale; forces with the start-up cut off and the averaging window shaded; one colour per
  part, consistent across charts. `scripts/plot_convergence.py` in the paraview-post skill does all of this for an
  OpenFOAM case.
- Comparison workbooks (Excel): one sheet per run with raw forces and live formulas for the window means, plus a
  Comparison sheet. Use formulas (AVERAGE/STDEV over the window, set by an input cell) rather than pasted numbers,
  so the window can be changed. Recalculate after writing with Excel (COM on Windows) or LibreOffice and check for
  errors. Chart tips: horizontal bars with negative values need the category labels at "low"; legends should not
  overlay the plot.
