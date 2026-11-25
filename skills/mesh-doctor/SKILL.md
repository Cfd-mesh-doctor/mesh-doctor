---
name: mesh-doctor
description: Check, repair and prove OpenFOAM 14 meshes with Mesh Doctor (this repository), make and solve test cases with it, and read what a solved case gives. Use when the user wants to fix a bad OpenFOAM mesh (non-orthogonality, skewness, bad tets, concave or inverted cells, checkMesh failures), lower max non-orthogonality, compare a repaired mesh against the original in the solver (A/B test), judge whether a run has converged, make a ready-made case from a template (Ahmed body, wheel and front wing), solve a case or a copy of one, check that an install gives the right answer (verify install), plan or start a transient run, read a solved case's forces and coefficients averaged with how sure each is, compare two runs (is a difference real or inside the noise, a mesh study), make pictures of a solved case's flow with ParaView (cuts, vortices, pressure spots, a transient run's mean flow), or open the Mesh Doctor dashboard.
---

# Mesh Doctor

Mesh Doctor moves mesh points (and collapses a few faces) to fix bad cells **inside an existing OpenFOAM 14 mesh**, then
proves the result with checkMesh and, optionally, a solver A/B test. It never edits the source case: every job works
on a copy in the workspace. It also makes ready-made cases from templates and solves the cases it made, or a copy of
one of yours: a known case to try a repair on, a check that an install gives the right answer, a transient run.
And it reads what a solved case gives: its forces averaged and judged, two runs compared, and pictures of its flow
drawn by ParaView.

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
meshdoctor judge  <case> [window|auto]               has this run converged? how much do forces still move?
meshdoctor map    <name>                             2D map of where the repair worked vs residual hotspots
meshdoctor new    [<template> <name> [--size S]]     a ready-made case from a template, meshed (alone: the list)
meshdoctor solve  <case> [--to N] [--np P]           solve a case made here to iteration N, or continue it there
meshdoctor solve  <srcCase> <name> [--to N] [--np P] solve a copy of a case you made, as the new case <name>
meshdoctor solve  <name> --template T [--size S]     make a case from a template, then solve it (verify install)
meshdoctor solve  <name> --steady <run> [--to S]     a transient run (DDES) of a solved steady run, to S seconds
meshdoctor transient-plan <case> [--co 1,5,20]       a transient run's time step, hours, and the cells that set it
meshdoctor results <case> [--from T] [--to T]        its forces averaged, how sure each mean is, still drifting?
meshdoctor compare <a> <b> [--mesh]                  b's forces against a's: is each difference real or noise?
meshdoctor compare --abtest <name>                   an A/B test's two runs, compared the same way
meshdoctor pictures <case> [--time T] [--mean]       ParaView pictures of its flow: cuts, vortices, pressure spots
meshdoctor serve  [--port 8765] [--case <live>]      local dashboard at http://localhost:8765
meshdoctor experimental ratchet <src> <name>         push max non-ortho below the 65 deg target, pass by pass
meshdoctor experimental polish  <src> <name> [--tets] [--tet-cap 1]   gradient polish of the worst clusters
```

Every command has `--help`. A `<srcCase>` is a case folder, or the name of a case in the cases folder
(`meshdoctor config` shows it). A repair's results land in the workspace copy's `meshDoctor/` folder as JSON (verdict,
checkMesh before/after, regressions, rollback flag). `new` and `solve` work in the cases folder: a new case always goes in a new
folder there, marked as made by Mesh Doctor. `results`, `compare` and `pictures` take a case's name or folder too; none
of them changes a case you made.

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
- **Disk:** before a repair, an A/B test (and `ab extend`), a new case or a solve starts, the engine checks that what
  it writes fits on its disk with 1 GB to spare: a repair writes its copy and up to about 2 more times its mesh, an
  A/B test about 3.3 times the mesh a run. A refusal (`not enough disk space: ...`) gives both numbers: delete runs
  or results you no longer need, then try again.
- **The source must be serial** (a real `constant/polyMesh`). If only `processor*/` holds the mesh, reconstruct first
  (`reconstructPar -constant` / `reconstructParMesh -constant`) in a copy.

## Proving it helped

checkMesh numbers are not the goal; a run that converges better is. Use `meshdoctor ab <src> <name> --iters N`:
same case, same settings, original mesh vs repaired mesh. Then `meshdoctor judge` on each. Enough iterations matter:
a few tens of iterations show a trend, not an answer. Report residual levels and the last-window force means and
their spread, not just "it improved".

## Making and solving a case

- **No case at hand, or want a known one: `new`.** `meshdoctor new` lists the templates and their mesh sizes: the
  Ahmed body, the standard test shape for car aerodynamics (coarse 480k, medium 836k, fine 1.57M cells), and a wheel
  with a front wing in ground effect (medium, 920k). `meshdoctor new ahmed-body ahmed --size coarse` copies the
  template into the cases folder as `ahmed` and meshes it; then repair it, A/B test it or solve it like any case. A
  name that is taken is refused. `--replace` deletes a case made here and makes it again (after a mesh that failed):
  ask the user first.
- **Solving: `solve`.** It runs only in a case Mesh Doctor made (by `new`, or a copy made by `solve`). The first solve
  splits it onto `--np` processes (4 by default; 1 solves it whole), starts the flow with potentialFoam and runs
  foamRun to iteration `--to` (2000 by default). The same command with a higher `--to` continues from the latest
  written time, on the same processes. Stop on the run's page in the web app ends it at the iteration it has
  reached, writing it first; Ctrl+C ends it at the one it wrote last. While it runs, the engine starts no other job.
  A case the user made is never solved in place: `meshdoctor solve <srcCase> <name>` copies its mesh and settings,
  not its results, as the new case `<name>`, and solves that. The free memory and disk space are checked first; run
  one solve at a time.
- **Does the install give the right answer? Verify install.**
  `meshdoctor solve verify-install --template ahmed-body --size coarse --to 2000 --np 6` makes the coarse Ahmed body
  and solves it as the accuracy check did, in about 15 minutes on 6 cores. Its drag over the last 500 iterations
  should be within 2 % of 0.299 (`docs/validation.md`). Further off, something in the setup differs: the OpenFOAM
  version, a changed template, or a solve stopped short. The web app's Verify install, on its Solve screen, starts the
  same run and shows the comparison.
- **A steady run that won't settle: a transient run.** A steady run that plateaus on a flow that is unsteady by nature
  (a wing-tip vortex, a tyre wake) can't converge. `meshdoctor transient-plan <run>` says which time step the mesh
  allows at a largest Courant number of 1, 5 and 20, how many hours each takes, and which cells set it (`--sets DIR`
  writes them as a cell set). It only reads the case. Then `meshdoctor solve <name> --steady <run> [--co C]
  [--model DDES|URANS] [--to SECONDS] [--writes W]` makes `<name>` a transient run that starts from the steady flow
  (DDES at a Courant number of 1 by default, to 8 flow times). Its `--to`, its progress and its continuations are
  seconds of flow, not iterations. It writes W times a stretch (4 by default, up to 200), evenly to its end, and keeps
  every one: the flow at each time, for pictures of it over time (a continuation's `--writes` goes on from then);
  the disk guard counts them before it starts. It averages its flow (`UMean`, `pMean`, `UPrime2Mean`, `pPrime2Mean`) once its forces have
  settled: the solve switches the averaging on then, so the start-up isn't in it, and says from when; so does the run's
  page in the web app. A transient run made before Mesh Doctor averaged its flow gets the averaging when it is solved
  again.
- **Following a solve.** `meshdoctor judge <case>` says whether it has converged: it compares its last 200
  iterations (or time steps) with the 200 before, so it needs 400 of them. For a shorter run, such as a transient run
  of a few hundred time steps, `meshdoctor judge <case> auto` makes each window half the run (10 to 200). The
  dashboard (`meshdoctor serve`) and the web app's Solve screen draw its residuals and forces.

## Results, comparisons and pictures

- **What did a solved case give? `results`.** `meshdoctor results <case>` averages each force group's drag and
  vertical force over the judge's window (a steady run's last two judge windows, a transient run's from when its
  forces settled), or from `--from` to `--to` (iterations, or a transient run's seconds). Each comes with its
  standard deviation, its drift between the window's two halves and the uncertainty of its mean (batch means), in N;
  then CdA and ClA (the forces over q = ½ρU², with the case's own speed and density), L/D, Cd and Cl only where the
  case's own `forceCoeffs` gives a reference area, and how many orders each residual fell, with the judge's verdict.
  It warns when a force still drifts by more than 1 % (run longer before comparing it) and when the mesh has a single
  symmetry plane (the forces may be for half a model). Report the means with their uncertainty and drift, never a
  last value; `--json` gives the whole document.
- **Is a difference real? `compare`.** `meshdoctor compare <a> <b>` averages both over the same window (up to the
  shorter run's end, from the later of their judges' starts) and gives, for each force group in both, b's difference
  from a in N and in %, and whether it is real: larger than its noise (each side's uncertainty of the mean or its
  drift, whichever is larger, added in quadrature). If not, it is inside the noise: report that as no difference
  found, not as a small one. Two cases made from one template at two mesh sizes are a mesh study (any two are with
  `--mesh`), which also says whether each force moves less between the meshes than it swings. It warns when a design
  comparison's meshes differ by more than 2 % in cells, when only one is a half model, when their vertical forces
  point opposite ways, and when one still drifts. `meshdoctor compare --abtest <name>` compares an A/B test's two
  runs: its original mesh's (a) against its repaired mesh's (b), or its settings' against the variant's.
- **Pictures of the flow: `pictures`.** It needs ParaView: `meshdoctor check` says whether `pvbatch` is found and
  starts. `meshdoctor pictures <case>` draws its latest written time offscreen with the paraview-post skill's
  scripts: cuts coloured by speed, Cp and Cp,t (from the case's own `cuts.json`, or three made from the model's
  size), vortices (Q-criterion surfaces at three levels scaled by the free-stream speed) and spots of unphysical
  pressure on the walls (Cp below -5, a numerical error). `--time T` pictures another written time, `--mean` a
  transient run's mean flow (each cut also showing how much the speed swings), and `--kinds` picks what to make, of
  `cuts,vortices,spots` (the default), `times` (the first cut's speed at each written time, at most 50) and
  `fastest` (the cells that set a transient run's time step). ParaView reads the case through a folder of links; the
  set goes in the workspace's `.pictures/<case>/<time>/`, with `pictures.json` saying what each picture shows. The
  one thing it writes in a case: an earlier time of a split run Mesh Doctor made is joined into that run first
  (`reconstructPar -time`), as its solve would; a case you made is read as it is. It needs the flow toward -x with z
  up, the walls named by the case's force function object, and memory: about 0.6 GB a million cells, 0.9 GB for a
  time read split, 1.4 to 1.9 GB for a cut over time; run it as one big job at a time. A computer's first set starts
  with a self test (a test vortex that must come out red); if a set's notes say it didn't pass, or a picture is
  blank, see the ParaView rows of `docs/troubleshooting.md`. Show the pictures and say in a line what each shows (the
  web app's Pictures screen has them too). For a view it doesn't make, use the paraview-post scripts by hand,
  writing outside the case.

## What it cannot do

It does not refine, add layers, or fix leaks or missing surfaces: those need new meshing settings. Corners, sharp
edges and patch junctions never move, so a defect pinned against a sharp edge may stay. See `docs/limits.md`.

## Rules to keep

- Never write into the user's source case. Name test copies clearly (e.g. `test_<case>_<what>`).
- Report the before/after checkMesh table (max non-ortho, max skewness, bad tets, concave cells, failed checks).
- If a job fails or rolls back, stop and report what happened before trying something else.
