# Mesh Doctor

Finds bad cells in an OpenFOAM mesh, shows where they are, and corrects them **inside the mesh**: mesh points are moved, and faces that point moves cannot fix are collapsed. Your CAD and meshing settings are never touched, and your case is never modified (every job works on a copy).

It also answers "did it help?": an A/B solver test runs the same case on the original and the repaired mesh, and a convergence judge reads residuals and forces. A local dashboard shows all of it.

For **OpenFOAM 14 (openfoam.org)** on Linux, Windows through WSL, Docker, or a Slurm cluster.

- [How it works](docs/how-it-works.md): detect → highlight → correct, and which parts need simulation results
- [Dashboard tour](docs/dashboard.md)
- [Safety model](docs/safety.md): what protects your cases and your machine
- [Limits](docs/limits.md): what it does not do, and the experimental tools
- [AI agents](AGENTS.md): which skill guide to read for each task (works with any AI coding tool)
- [Worked example](examples/ahmed-body/README.md): the Ahmed body from STL to wind-tunnel comparison; copy it for your own case ([templates](docs/templates.md))
- [Gallery](docs/gallery.md): the pictures and charts the scripts make
- [Accuracy check](docs/validation.md): three meshes and two slant angles against the wind tunnel, and where steady RANS goes wrong
- [Troubleshooting](docs/troubleshooting.md): error messages and their fixes · [Changelog](CHANGELOG.md)
- [Claude Code plugin](docs/claude.md): CFD skills for Claude (OpenFOAM, SimScale, ParaView, cloud solves), installed with `/plugin marketplace add Cfd-mesh-doctor/mesh-doctor`; then type `/testrun`

## Quickstart

You need OpenFOAM 14 from openfoam.org and Python 3.8 or newer. numpy is needed only for the repair map. Pick your platform:

### One command (Windows or Ubuntu 22.04)

From a clone of this repository:

```powershell
powershell -ExecutionPolicy Bypass -File tools\setup_windows.ps1     # Windows: WSL + Ubuntu, then everything below
```
```bash
bash tools/setup_linux.sh                                          # Ubuntu 22.04 or inside WSL
```

They install only what is missing (OpenFOAM 14, numpy/matplotlib/PIL, ParaView, then `./Allwmake`), make OpenFOAM
load in new terminals, and finish with `tools/toolkit_check.py`. Add `-DryRun` / `--dry-run` to see the steps
first, `-NoParaView` / `--no-paraview` to skip ParaView. The first WSL install needs an administrator PowerShell and
a restart; run the script again afterwards. The steps by hand:

### Windows (WSL)
1. Install Ubuntu 22.04 from the Microsoft Store (or `wsl --install -d Ubuntu-22.04`), then follow **Linux** below inside the Ubuntu window.
2. Start the dashboard inside WSL: `meshdoctor serve`.
3. Open `http://localhost:8765` in your Windows browser. WSL forwards the port to Windows' own localhost only, not to the network.

Keep cases inside the WSL file system (`~/...`), not under `/mnt/c`: OpenFOAM is many times slower on Windows drives.

### Linux (Ubuntu 22.04, or WSL)

```bash
# OpenFOAM 14 (skip if you have it)
sudo sh -c "wget -qO /etc/apt/trusted.gpg.d/openfoam.asc https://dl.openfoam.org/gpg.key"
echo "deb http://dl.openfoam.org/ubuntu jammy main" | sudo tee /etc/apt/sources.list.d/openfoam.list
sudo apt update && sudo apt install openfoam14 python3-numpy

# Mesh Doctor
git clone https://github.com/Cfd-mesh-doctor/mesh-doctor mesh-doctor && cd mesh-doctor
. /opt/openfoam14/etc/bashrc
./Allwmake                    # builds foamMeshDoctor and foamResidualHotspots
bin/meshdoctor check          # says "ready", or lists what is missing
```

To type just `meshdoctor`, add the clone's `bin/` folder to your PATH (or link `bin/meshdoctor` into `~/bin`). With pip instead: `pip install ".[map]"` in a virtual environment (or `pipx install .`) gives the same command; `./Allwmake` is still needed for the OpenFOAM utilities.

### Docker (OpenFOAM included)

```bash
docker build -t meshdoctor .
docker run --rm -p 127.0.0.1:8765:8765 -v /path/to/cases:/cases:ro -v meshdoctor-work:/work meshdoctor
```

Then open `http://localhost:8765`. Cases are mounted read-only; results go to the `meshdoctor-work` volume. Always publish the port as `127.0.0.1:8765:8765`. Plain `8765:8765` would put the dashboard on your network. Any other command runs as `docker run ... meshdoctor <command>`.

### University cluster (Apptainer + Slurm, single node)
1. Build `meshdoctor.sif` from `cluster/meshdoctor.def` (needs root or `--fakeroot`, so usually on your own Linux machine), and copy it to the cluster.
2. Submit a job. Heavy work goes through the scheduler, never on the login node:

   ```bash
   export MESHDOCTOR_WORKSPACE=$HOME/meshdoctor-work      # outside every case
   sbatch cluster/slurm/repair.sbatch <source case> <run name>
   sbatch cluster/slurm/abtest.sbatch <source case> <run name>
   ```

   The image is taken from `$MESHDOCTOR_IMAGE`, else `~/meshdoctor.sif`. Adjust `--mem`, `--time` and your cluster's partition/account lines at the top of each file.
3. To see the dashboard for a cluster run, start `meshdoctor serve` there and reach it through an SSH tunnel (see **Running it**).

For an install shared by several users, `./Allwmake -site` puts the utilities in OpenFOAM's site folder.

## First run: the motorBike tutorial

This uses OpenFOAM's own motorBike case, so you can try everything before using your own cases (about 15–20 minutes on 4 cores, 1–2 GB of memory).

```bash
. /opt/openfoam14/etc/bashrc
mkdir -p $FOAM_RUN && cd $FOAM_RUN
cp -r $FOAM_TUTORIALS/incompressibleFluid/motorBikeSteady motorBike
cp $FOAM_TUTORIALS/resources/geometry/motorBike.obj.gz motorBike/constant/geometry/
(cd motorBike && surfaceFeatures && blockMesh && snappyHexMesh) > mesh.log

meshdoctor full motorBike mb                   # copy, checkMesh, repair, checkMesh
meshdoctor ab motorBike mb --iters 200 --np 4  # solve original vs repaired mesh
meshdoctor map mb --hot "Original=$FOAM_RUN/meshdoctor/mb_ab/base" --hot "Repaired=$FOAM_RUN/meshdoctor/mb_ab/fixed"
meshdoctor serve                               # http://localhost:8765/meshdoctor
```

- `full` prints its verdict: which checkMesh numbers improved, and any that got worse (there should be none). For this mesh, typically every skewed and low-weight face is gone, with no check worse. The full record is in `$FOAM_RUN/meshdoctor/mb/meshDoctor/result.json`.
- `ab` runs both solves on copies and compares residuals, forces and where the residuals are highest. `--iters 200` is enough to see a difference; use more for a converged answer.
- `map` draws where the mesh was repaired on top of where the flow will not settle.
- With OpenFOAM loaded, the default source folder is `$FOAM_RUN` and the workspace is `$FOAM_RUN/meshdoctor`; `meshdoctor config` shows the ones in use.

## Running it

```bash
meshdoctor help                       # every command; <command> --help for its options
meshdoctor full <case> <name>         # repair a copy of <case> as <workspace>/<name>
meshdoctor ab <case> <name>           # A/B solver test: original vs repaired mesh
meshdoctor judge <case>               # is this run converged?
meshdoctor serve [--case <case>]      # dashboard; --case picks the live run to watch
```

Without the `bin/` launcher or pip, `python3 -m meshdoctor <command>` from the clone does the same.

**On another machine** (a cluster node, a lab PC): the dashboard listens on 127.0.0.1 only. Reach it through an SSH tunnel, never a public address:

```bash
ssh -L 8765:localhost:8765 <you>@<host>
```

Then open `http://localhost:8765` on your own computer.

**Memory:** a repair needs about 1.5 KB per cell and a solve about 1.35 KB per cell, plus 0.5 GB. Mesh Doctor refuses a job that would not fit in free memory; `meshdoctor check` shows how many cells fit now. Only one big job runs at a time.

## Configuration
Settings come from environment variables, else `~/.config/meshdoctor/config.ini`, else defaults. `meshdoctor config` prints the values in use and where each came from.

```ini
[paths]
# where the dashboard looks for source cases (default $FOAM_RUN, else ~/OpenFOAM/run)
cases = ~/cases
# where every copy and result goes (default <cases>/meshdoctor); keep it outside every case
workspace = ~/meshdoctor-work
# the case shown on the live transient page
# live_case = ~/cases/myRun
# only if the case does not say: flow from 0/U, up from forceCoeffs liftDir or the forces
# flow_axis = -x
# up_axis = z
# the most memory a job may use, in MB
# ram_limit_mb = 16000
```

Comments go on their own lines. Each setting has an environment variable that wins over the file: `MESHDOCTOR_CASES`, `MESHDOCTOR_WORKSPACE`, `MESHDOCTOR_FOAM_BASHRC` (the OpenFOAM bashrc, found automatically when OpenFOAM is loaded), `MESHDOCTOR_LIVE_CASE`, `MESHDOCTOR_FLOW_AXIS`, `MESHDOCTOR_UP_AXIS` and `MESHDOCTOR_RAM_LIMIT_MB`. `MESHDOCTOR_CONFIG` points to another config file.

Force groups, flow direction and the up axis are read from each case (the `forces` or `forceCoeffs` function objects and `0/U`), so most cases need no settings.

## Contributing: the data guard
This repository must never contain simulation data, CAD, spreadsheets, personal paths or team names. After cloning, turn on the guard hooks once:

```bash
git config core.hooksPath .githooks
```

- `pre-commit` checks every staged file, and `pre-push` checks the whole history.
- `python3 tools/data_guard.py --tree` checks at any time.
- Private words to block (team or project names) go in `.data-guard-private.txt`, which is git-ignored and never committed.
- Tests: `python3 -m unittest discover -s tests`, `python3 tests/security_check.py --start`, and with OpenFOAM loaded `tests/integration_motorbike.sh`.

## Licence
Copyright (C) 2026 The Mesh Doctor authors (see `AUTHORS`).

GPL-3.0-or-later (see `LICENSE`), because the C++ utilities link against OpenFOAM, which is GPL-3. OpenFOAM is a registered trademark of OpenCFD Ltd; this project is not affiliated with or endorsed by OpenCFD or the OpenFOAM Foundation.
