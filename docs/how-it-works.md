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

`meshdoctor ab <case> <name>` makes two copies of your case with the **same setup**: one with the original mesh, one with the points from `<workspace>/<name>`. It solves both with `foamRun` for `--iters` iterations on `--np` cores. Both runs get the same split across cores (scotch, which depends only on the mesh connectivity), so the only difference is where the points are. A case without a `system/decomposeParDict` (one you run in serial) gets one in both copies.

It writes `<workspace>/<name>_ab/ab_result.json` with, for both runs:
- residual levels, and the ratio repaired / original for each field (below 1 means the repaired mesh converges further);
- force means and how much they oscillate;
- seconds per iteration;
- the residual hotspots (next section).

Options:
- `--init 0` starts both from the case's `0/` fields; `--init 0.warm` or another folder starts from a solution you already have. Without `--init`, they start from `0.warm` when the case has one, else from `0/`.
- `--variant simplec|simplec2|relax|lts` changes a solver setting on the second run instead. With `-` as the name, it compares a setting on the original mesh only.
- `ab extend <name> <endIter>` continues the second run to iteration `<endIter>`; give it the same `<name>`, or the A/B test's folder.

## 5. The convergence judge

`meshdoctor judge <case> [window|auto] [--to N]` compares the last `window` iterations with the ones before (`auto`: half the run, 10 to 200). `--to N` judges the run as it was at iteration N, leaving out what came after, so two runs can be judged over the same iterations; the steady-run page does this for both runs of an A/B test (`GET /api/v1/abtests/{name}/judge?side=base|fixed&to=N`). It reads residuals from the `residuals` function object, or else from `log.foamRun*`, and reads forces from `forces` or `forceCoeffs`:

| Verdict | Means |
|---|---|
| converged | p residual below 1e-4, forces drift and oscillate less than 0.5 % |
| statistically steady | forces stationary (drift < 1 %, oscillation < 2 %) but residuals not low: use the window means |
| still converging | the p residual is still falling (by more than 10 % between windows) |
| not converged | residuals flat and forces still moving: a plateau or a slow oscillation |

Averages come with an uncertainty from batch means, so a slow swing is not hidden by a long average.

**Transient runs** (any `ddtSchemes` other than `steadyState`) get their own verdict, with `window` counted in time steps. Oscillating forces are expected there, so it asks three separate questions:
- are the force means stationary (drift under 2 % between the last two windows)?
- did each time step converge, meaning p fell below 1e-3 by the last PIMPLE outer iteration?
- is the time step sane: max Courant at most 1 (needed for DES/LES), and no field bounded in more than 5 % of steps?

The answer is "converged", "statistically stationary, but check: …" or "still developing", with every failed check named. Logs not called `log.foamRun*` are passed with `--log`, for example `meshdoctor judge <case> 500 --log log.pimple`.

The means start where the forces settled: MSER-5, a standard rule for cutting off the start of a run, finds for the drag and for the vertical force the start that makes the mean's standard error least, looking in the first half of the run only. Once both have settled, the means are from the later of the two (`settled`); until then they are over the last two windows.

Forces are reported as drag (along the flow) and the vertical force, named **downforce** or **lift** by its sign:
- the flow direction is read from `0/U`, preferring an inlet patch;
- the up axis comes from, in order: the `up_axis` setting, the `liftDir` of `forceCoeffs`, or the cross-flow axis with the larger force.

### A solved case's results

`meshdoctor results <case> [--from T] [--to T] [--json]` (`GET /api/v1/results/{case}?from=&to=`; `GET /api/v1/results` gives every case's that has a force history, newest first, and `GET /api/v1/results/{case}/forces` each group's forces over the whole run, thinned for charts) gives each force group's drag and vertical force over an averaging window: the judge's by default (a steady run's last two judge windows, a transient run's from when its forces settled), or the one `--from` and `--to` give, in iterations or a transient run's seconds. For each it gives the mean, the standard deviation, the drift between the window's two halves and the uncertainty of the mean from batch means, in N. With them come CdA and ClA (the forces over q = ½ρU², ρ the case's `rhoInf` and U its freestream speed), L/D, and Cd and Cl for a group that a `forceCoeffs` function object covers, with that object's own `Aref`, `magUInf` and `rhoInf`. Each residual's first and final level and how many orders it fell are listed, with the judge's verdict. It warns in plain words when a force still drifts by more than 1 % over the window (run longer before comparing it with another run), and when the mesh has a single symmetry plane, since then the forces may be for half a model. It only reads the case.

### When a steady run cannot converge: the transient plan

A steady run that plateaus on a physically unsteady flow (a wing-tip vortex, a tyre wake) will not converge however long it runs. The way on is a transient run with time-averaged forces, which costs far more. `meshdoctor transient-plan <case>` says how much before you start one:
- it runs Mesh Doctor's `foamCourantCells` on the steady result (OpenFOAM's `CourantNo` function where that isn't built), which gives each cell's Courant number per second of time step, `0.5 Σ|φ| / V`;
- with `adjustTimeStep`, the largest of these sets the time step: `dt = maxCo / max`;
- for each max Courant number (`--co`, default 1, 5 and 20) it gives the time step, the number of steps for the flow time, and the hours, from the steady run's seconds per iteration and `--outer` PIMPLE iterations per step (default 3);
- the flow time is `--flow-time`, or 8 body lengths of flow from `--length` or a `forceCoeffs` `lRef`; without one, the plan gives hours per 0.1 s of flow;
- it finds the 100 fastest cells (`--top`) and groups them by place, and says how much larger the time step would be without them. A few tiny cells often set the time step for the whole mesh. With `foamCourantCells`, each place also says what may make it fast: its nearest wall and how far from it the cells are, the flow's speed there, and the cells' shape (aspect ratio and non-orthogonality);
- `--sets <folder>` also writes those cells as the cell set `fastestCells`, laid out as the case is (`[processorN/]constant/polyMesh/sets/fastestCells`): copy its folders into the case to see the cells in paraFoam (Include Sets) or to pick them with `topoSet`. A case split on processes gets it for each process, and for its whole mesh too where it has the one it was split from: each cell is found there by its processor's `cellProcAddressing`. Without that, it is for each process only (in paraFoam, a Decomposed Case), and the plan says why.

The case is only read: OpenFOAM runs in a temporary shadow case whose mesh, settings, flux and velocity are links to it. The answer is a versioned JSON document (`tplan` schema). DES and LES need max Co ≤ 1. URANS with enough outer correctors usually runs higher, so the plan shows both.

In the web app, a solved run's page has Plan a transient run: the engine makes the same plan as a job and the page shows it, with the hours on the run's own processes and where the fastest cells are. The job saves their cell set in the workspace, in `.tplans/<case>.sets`. The Cases screen plans a case you made the same way once it has a result: Plan a transient run, under its name.

**The transient run itself:** `meshdoctor solve <name> --steady <run>` makes the new case `<name>` a transient run of a solved steady run: its mesh, settings and latest result with its face flux, solved in time from there, so with no `potentialFoam`. By default it is DDES (`kOmegaSSTDES` with F2 shielding, so the boundary layers stay RANS and the wake's eddies are resolved), with second-order time steps (`backward`), `LUST` for the velocity, PIMPLE with 3 outer correctors and a time step OpenFOAM adjusts to a largest Courant number of 1 (`--co`; DDES takes 2 at most). Its first time step is the plan's, when one was made of the same result. `--model URANS` keeps the steady run's own RAS model and can run at a Courant number up to 20, with its outer correctors relaxed above 1. It runs 8 flow times over the body (8 L/U) unless `--to` gives the time in s, and writes four times a stretch unless `--writes W` asks for more or fewer (up to 200), evenly to its end, keeping every one: the flow at each time, for pictures of it over time; `meshdoctor solve <name> --to S` continues it from its latest written time, and a continuation's `--writes` goes for its later stretches too. On several processes each time stays split on them, but the latest of each stretch, which is joined: ParaView opens them all as a Decomposed Case. It averages its flow from when its forces have settled, so the start-up isn't in the average: its function objects go in `system/functions`, which OpenFOAM reads again when it changes as the run solves, with a `fieldAverage` (`UMean`, `pMean`, `UPrime2Mean` and `pPrime2Mean`: the mean flow and how much it swings) that is off at first. The solve checks the forces before each stretch and every half a minute as it solves, and switches it on once they have settled; each time written from then on holds the average, and a continuation carries it on. The steady run is only read.

In the web app, a solved run's plan has Start a transient run: you give its name, DDES or URANS, the largest Courant number (the dialog shows the plan's time step, steps and hours at it), the time to solve to (8 L/U by default), the times it writes a stretch, each kept, with the disk space they take said first, and the processes. Its page follows it in seconds: its time and time step, its residuals and forces over time, its time step and Courant number (mean and largest) at each time step, and the transient judge over the last half of its time steps, its means from when the forces settled (shaded on the forces chart), and from when the run averages its flow, with the latest time written with the average, and the written times it keeps. Stop and Continue work as for a steady run, with the time in s; Continue asks the times it writes a stretch too.

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
- `/`: a transient run as it happens (forces, averaging window, time step), and the transient judge's three answers for it, refreshed once a minute.

Starting a job from the page runs the same commands as the command line, and so does starting one from the web app.
