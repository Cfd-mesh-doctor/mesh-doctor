# Using this repository with Claude Code

The repository is also a Claude Code plugin, **cfd-toolkit**. It gives Claude the know-how and helper scripts for
CFD work, so it can run Mesh Doctor, set up and babysit OpenFOAM and SimScale cases, make ParaView pictures, run big
solves on Google Cloud, and read results honestly.

## Install

In Claude Code (terminal, desktop app or IDE):

```
/plugin marketplace add Cfd-mesh-doctor/mesh-doctor
/plugin install cfd-toolkit@mesh-doctor
```

Restart Claude Code if the skills don't show up. Update later with `/plugin marketplace update mesh-doctor`.

The skills tell Claude how to work; the programs still have to be on your machine. For Mesh Doctor follow the
README quickstart (OpenFOAM 14 + `./Allwmake`). ParaView, gcloud and a SimScale account are only needed for their
own skills.

## Skills

| Skill | Use it for |
|---|---|
| `mesh-doctor` | repairing an OpenFOAM mesh, lowering max non-orthogonality, A/B solver tests, convergence verdicts |
| `openfoam-wsl` | OpenFOAM 14 on WSL/Linux: snappyHexMesh for cars and wheels, RANS and DDES, restarts, memory, speed traps |
| `simscale` | SimScale Community plan: geometry prep, snappy sizing, cloning a setup across variants, the API, downloads |
| `paraview-post` | offscreen ParaView pictures (cuts, vortices, pressure spots) and convergence charts |
| `cloud-solve-gcp` | solving a big case on a Google Cloud VM with no SSH, and getting the results back |
| `cfd-results` | averaging windows, drift, comparing variants and meshes, coefficients, comparison workbooks |

## Slash commands

Type these in Claude Code (arguments in brackets are optional):

| Command | What it does |
|---|---|
| `/cfd-toolkit:dashboard [case]` | starts the live dashboard and opens it in the side panel: whole-job progress, iteration and time left, forces, residuals, Mesh Doctor pages |
| `/cfd-toolkit:run-status <case>` | iteration, speed, time left, force means and drift of a running or finished case, with a verdict |
| `/cfd-toolkit:solve <case> [ranks] [iterations]` | sizes the run, starts it in the background and opens the dashboard |
| `/cfd-toolkit:mesh-check <case> [name]` | checkMesh, Mesh Doctor repair on a copy, before/after table |
| `/cfd-toolkit:pictures <case> [patches]` | charts, cut planes, vortices, pressure spots and a contact sheet |
| `/cfd-toolkit:size <Mcells>` | fits in memory or not, local time, cloud cost, SimScale core hours |
| `/cfd-toolkit:toolkit-check` | what is installed and what is missing for each skill |
| `/cfd-toolkit:ahmed-demo [ranks] [iterations]` | the worked example from mesh to wind-tunnel comparison (about an hour on 6 cores) |
| `/cfd-toolkit:cloud-status <gs://bucket>` | progress of a Google Cloud solve |

In the Claude desktop app the dashboard opens in the browser side panel and keeps refreshing while you work; in a
terminal, Claude prints the link (`http://localhost:8765/`).

## Start here

1. `/cfd-toolkit:toolkit-check` to see what is installed.
2. `/cfd-toolkit:ahmed-demo` to run the worked example (`examples/ahmed-body`) and see every step once.
3. Copy that example for your own model: `docs/templates.md`. When something breaks: `docs/troubleshooting.md`.

Claude picks the right skill from what you ask ("fix this mesh", "make vortex pictures of this case", "set up the
next SimScale variant"). You can also name one: "use the simscale skill".

## Ground rules built into the skills

Claude works on copies (never your source case), asks before anything that costs money or downloads software,
never types your passwords or sign-in codes, and stops to report when a step fails.
