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

Claude picks the right skill from what you ask ("fix this mesh", "make vortex pictures of this case", "set up the
next SimScale variant"). You can also name one: "use the simscale skill".

## Ground rules built into the skills

Claude works on copies (never your source case), asks before anything that costs money or downloads software,
never types your passwords or sign-in codes, and stops to report when a step fails.
