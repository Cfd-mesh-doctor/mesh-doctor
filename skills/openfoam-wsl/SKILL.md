---
name: openfoam-wsl
description: Set up, mesh, run and babysit OpenFOAM 14 (openfoam.org) cases on a Windows PC through WSL, or on Linux. Use for external-aero cases (cars, wings, wheels) - snappyHexMesh settings, steady RANS (kOmegaSST) and DDES runs, parallel decomposition, restarts, memory and speed limits, and the WSL/Windows traps that kill long runs.
---

# OpenFOAM 14 on WSL / Linux

## Environment

- Install: Ubuntu 22.04 in WSL, then openfoam.org's apt repository and `openfoam14` (see the repository README).
  Load it in every shell: `. /opt/openfoam14/etc/bashrc`. Your own compiled tools go to
  `$FOAM_USER_APPBIN` (`~/OpenFOAM/<user>-14/platforms/linux64GccDPInt32Opt/bin`).
- Give WSL enough memory in `%UserProfile%\.wslconfig` (`[wsl2]` / `memory=26GB` on a 32 GB PC). Changing it needs
  `wsl --shutdown`; ask the user first, it kills every running WSL job.
- **Calling WSL from tools:** write commands into a `.sh` file and run `wsl -e bash /mnt/c/path/script.sh` from
  PowerShell. Inline `bash -lc '...'` breaks on nested quotes and spaces; Git Bash mangles `/mnt/c` paths.
- **Process checks:** `pgrep -f name` inside a `bash -lc` that mentions `name` matches itself. Use `pgrep -x foamRun`
  or `ps -C foamRun`. `pkill -f pattern` can kill the calling shell.
- WSL shuts down about a minute after its last process ends, and that wipes `/tmp`. Keep work in `~`.

## Memory and speed (measured on an 8-core laptop, 32 GB, WSL 26 GB)

| Job | Memory |
|---|---|
| snappyHexMesh | ~2.1 GB per million cells |
| solver (foamRun, incompressible kOmegaSST) | ~1.6-1.75 GiB per million cells |
| checkMesh (serial) | ~0.67 GB per million cells |

So a laptop like that meshes about 8-10M cells and solves about 10-13M. Run one big job at a time. On hybrid CPUs
(performance + efficiency cores) 6 ranks can beat 8: benchmark a few iterations first.

Speed traps seen in practice:
- Many separate `forces` function objects cost a lot (7 of them doubled the step time). Use one coded function
  object, or fewer `forces` objects with `writeInterval` > 1.
- Battery power is ~3x slower; sleep stops the run. Keep the PC plugged in with sleep off for long runs.
- Close heavy Windows apps (browsers, other WSL GUIs like a forgotten ParaView eating 9 GB) so ranks reach 100 % CPU.
- `nNonOrthogonalCorrectors 0` with max non-ortho around 65 deg cut step time ~3x in a DDES case and stayed stable.
- **Windows Update can restart WSL mid-run** (a WSL package update shut the VM down and killed the solver). Ask the
  user to pause updates during multi-day runs.

## Restarting a parallel run

`startFrom latestTime;` looks at the **root** case folder, which in a decomposed case usually only holds `0/`: the run
silently restarts from zero and truncates `postProcessing/*/0/*.dat`. Use `startFrom startTime; startTime <last
time in processor0>;` instead. A restart writes a new `postProcessing/<fo>/<startTime>/` folder; merge folders by
iteration when plotting (later folders win).

## snappyHexMesh recipe for a car / wing / wheel

- STEP -> STL: export STL from CAD, or convert with gmsh (`gmsh -2 model.step -o model.stl`, with a size field). Check
  for hollow bodies (STEP `BREP_WITH_VOIDS`) and micro faces at joints first - they become holes and tiny patches.
- blockMesh base around 100 mm for a single wheel+wing model; refinement levels then halve: 50/25/12.5/6.25/3.1/1.6 mm.
  Thin parts (plates ~6 mm with rounds) need cells under ~1/3 of their thickness or they mesh chunky.
- Surface levels per part (e.g. wing elements 6-7, endplates 5-7, wheel 5-6), feature edges at the finest level,
  explicit feature snapping, 3 relative layers (expect 95-98 % coverage), refinement boxes: far wake, wake, near
  body, and a box for small gaps (wheel-ground contact, slot gaps).
- The tire touching the ground: sink it a few mm into the ground (flat contact patch) so there is no zero-thickness
  wedge; the remaining slivers still drive the max Courant number in transient runs.
- Typical outcome: ~5.7M cells, max non-ortho ~65, a handful of skewed faces. Then run Mesh Doctor (mesh-doctor skill).
- `decomposePar` in OF-14 reads `decomposer` (not `method`) in decomposeParDict; set both to be safe.

## Steady RANS, then DDES

1. Steady kOmegaSST, ~300 iterations, to get a flow field.
2. Map/initialise the transient case from it, switch to `kOmegaSSTDES` (`delta maxDeltaxyz`), small time step (e.g.
   1e-4 s at 15 m/s with ~1-3 mm cells), `fieldAverage` starting after the start-up transient (one to two flow-throughs).
3. Average forces over the averaged window only, and compare first-half vs second-half means: a few percent drift means
   the window is still too short.

## Reading results

- Forces: `postProcessing/<fo>/<start>/forces.dat` = time, pressure xyz, viscous xyz (moments in `moments.dat`).
  Total = pressure + viscous. Sign: if x points forward and flow goes to -x, drag = -Fx and downforce = -Fz.
- Kinematic pressure (incompressible): Cp = p / (0.5 U^2), total pressure Cp,t = (p + 0.5|U|^2) / (0.5 U^2).
- Residual folder name follows its fields, e.g. `residuals(p,U,k,omega)`.
- See the cfd-results skill for convergence judging and the paraview-post skill for pictures.
