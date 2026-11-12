# How Mesh Doctor works

Mesh Doctor has two halves:
- **the repair** looks only at the mesh, and needs no simulation results;
- **the checks that it helped** (A/B test, convergence judge, hotspots, map) run or read a simulation.

| Command | Needs | Gives |
|---|---|---|
| `inspect`, `fix`, `full` | a mesh (`constant/polyMesh`, serial or decomposed) | bad faces found, highlighted and corrected on a copy |
| `ab` | a case that runs (`0/`, `constant/`, `system/`) and a repaired copy from `full` | both meshes solved, residuals, forces and hotspots compared |
| `judge` | a run's log or residuals, and its forces | a convergence verdict |
| `ab hotspots`, `ab mode` | a solved case with written times | where the residuals, or a slow oscillation, are largest |
| `map` | a `full` run, plus optional hotspot layers | repairs drawn over hotspots, side and top views |
| `serve` | any of the above | the dashboard pages |

## 1. Detect

`foamMeshDoctor` (an OpenFOAM 14 utility in `foam/`) scores every face with OpenFOAM's own quality formulas, the same ones `checkMesh` and `snappyHexMesh` use:
- non-orthogonality;
- skewness (internal and boundary faces);
- face weight;
- the volume ratio of the two cells either side;
- face pyramids (an inverted pyramid means a cell is turned inside out).

A face's **badness** is its worst metric divided by its target, for example `nonOrtho / 65` or `0.05 / weight`. A face with badness 1 or less meets every target; 100 or more means an inverted pyramid. The targets come from a profile:

| Profile | Non-ortho | Skew | Boundary skew | Min weight | Min volume ratio |
|---|---|---|---|---|---|
| `openfoam` (default) | 65° | 4 | 4 | 0.05 | 0.01 |
| `strict` | 60° | 3 | 4 | 0.1 | 0.05 |

Choose one with `--profile strict`. Bad faces close together are grouped into **defect clusters**, so you see a handful of problem regions rather than thousands of faces.

## 2. Highlight

The worst faces, the cells around them and the nearby wall faces are written to `<copy>/meshDoctor/`, and the dashboard's Mesh Doctor page shows them in 3D, with the clusters listed by size. `inspect` stops here.

## 3. Correct

`fix` runs `foamMeshDoctor -fix` on the copy. It only **moves mesh points**:
- no cells are added or removed, so the decomposition, fields and patch names stay valid;
- points on walls may slide only along the wall: inside the plane on flat patches, re-projected onto the original surface on smooth curved walls, and along the original edge on feature edges. Corners, sharp edges, patch-to-patch junctions and processor boundaries never move, so the geometry is kept;
- a point move is accepted only if the worst face around that point gets better (or stays equal while the total badness drops), and no face pyramid or cell volume becomes invalid. The local worst quality can never get worse;
- passes repeat while they still help (up to 3).

Some faces cannot be fixed by moving points, typically inverted pyramids squeezed between walls. For those, `fix` **collapses** just those faces with OpenFOAM's `collapseEdges`, smooths with one more Mesh Doctor pass, and keeps the result only if `checkMesh` shows no regression; otherwise it puts the mesh back. This step does change the topology (a few faces and points fewer), so the A/B test cannot be used on such a copy. See [limits](limits.md).

`full` does copy → `checkMesh` → fix → `checkMesh`, and writes `<copy>/meshDoctor/result.json`. It records:
- every command run, with its log and exit code;
- the OpenFOAM version;
- checkMesh before and after, and the verdict (`improved`, `regressions`, `unchanged`);
- the defect clusters before and after;
- the largest point move;
- a checksum of the source case taken before and after (see [safety](safety.md)).

## 4. Did it help? The A/B test

`meshdoctor ab <case> <name>` makes two copies of your case with the **same setup**: one with the original mesh, one with the points from `<workspace>/<name>`. It solves both with `foamRun` for `--iters` iterations on `--np` cores. Both runs get the same split across cores (scotch, which depends only on the mesh connectivity), so the only difference is where the points are.

It writes `<workspace>/<name>_ab/ab_result.json` with, for both runs:
- residual levels, and the ratio repaired / original for each field (below 1 means the repaired mesh converges further);
- force means and how much they oscillate;
- seconds per iteration;
- the residual hotspots (next section).

Options:
- `--init 0` starts both from the case's `0/` fields; `--init 0.warm` or another folder starts from a solution you already have.
- `--variant simplec|simplec2|relax|lts` changes a solver setting on the second run instead. With `-` as the name, it compares a setting on the original mesh only.
- `ab extend <abDir> <endIter>` continues the second run further.

## 5. The convergence judge

`meshdoctor judge <case> [window]` compares the last `window` iterations with the ones before. It reads residuals from the `residuals` function object, or else from `log.foamRun*`, and reads forces from `forces` or `forceCoeffs`:

| Verdict | Means |
|---|---|
| converged | p residual below 1e-4, forces drift and oscillate less than 0.5 % |
| statistically steady | forces stationary (drift < 1 %, oscillation < 2 %) but residuals not low: use the window means |
| still converging | the p residual is still falling (by more than 10 % between windows) |
| not converged | residuals flat and forces still moving: a plateau or a slow oscillation |

Averages come with an uncertainty from batch means, so a slow swing is not hidden by a long average.

Forces are reported as drag (along the flow) and the vertical force, named **downforce** or **lift** by its sign:
- the flow direction is read from `0/U`, preferring an inlet patch;
- the up axis comes from, in order: the `up_axis` setting, the `liftDir` of `forceCoeffs`, or the cross-flow axis with the larger force.

## 6. Hotspots and the map

`foamResidualHotspots` finds the cells where the solution still changes most:
- either over one iteration (a residual map);
- or between two written times (`ab mode`), which catches a slow oscillation's shape.

The A/B test reports what share of the top hotspot cells lies near the defect clusters, for each mesh. If hotspots sit on defects in the original and move away after the repair, the bad cells were what held the run back.

`meshdoctor map <name> --hot "Label=<case>"` draws, on side and top views of the model:
- the defect clusters before and after repair;
- the top hotspot cells of each layer.

The ground plane is found from the geometry and left out of the drawing. Its normal is taken as "up".

## 7. The dashboard

`meshdoctor serve` shows four pages. See the [dashboard tour](dashboard.md).
- `/meshdoctor`: start repairs and A/B tests, view highlighted cells and results;
- `/meshmap`: the map;
- `/run`: a steady run as it happens (residuals, forces and the live judge);
- `/`: a transient run as it happens (forces, averaging window, time step).

Starting a job from the page runs the same commands as the command line.
