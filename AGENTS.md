# Instructions for AI coding agents

This repository is **Mesh Doctor** (OpenFOAM 14 mesh repair, solver A/B tests, a convergence judge and a local
dashboard) plus a set of **CFD skills**: Markdown guides with tested helper scripts. Any agent can use them.

## Read the matching skill before you start

| The user wants to... | Read first |
|---|---|
| check or repair an OpenFOAM mesh, lower max non-orthogonality, run an A/B solver test, judge convergence | `skills/mesh-doctor/SKILL.md` |
| set up, mesh, run or restart an OpenFOAM case (WSL or Linux), size a run to the machine | `skills/openfoam-wsl/SKILL.md` |
| work in SimScale (geometry, meshing, cloning a setup across variants, its API, downloads) | `skills/simscale/SKILL.md`, then `skills/simscale/references/` |
| make ParaView pictures (cuts, vortices, pressure spots) or convergence charts | `skills/paraview-post/SKILL.md` (scripts in `skills/paraview-post/scripts/`) |
| solve a big case on a Google Cloud VM | `skills/cloud-solve-gcp/SKILL.md` (scripts in `skills/cloud-solve-gcp/scripts/`) |
| read, average, compare or report CFD forces and residuals | `skills/cfd-results/SKILL.md` |

Each SKILL.md starts with a short front-matter block (name, description) followed by the instructions. Follow them as
written; they record what failed in practice, not just what should work.

## Ground rules

- **Never modify the user's source case.** Every job works on a copy (Mesh Doctor does this itself).
- **Ask before** anything that costs money (cloud VMs, paid plans), downloads or installs software, or deletes data.
- **Never type the user's passwords, sign-in codes or payment details**; the user does sign-ins themselves.
- **Stop and report** when a step fails or a check regresses, before trying something else.
- Run one memory-heavy job (meshing, solving, mesh repair, big ParaView reads) at a time; check free memory first.
- Mesh Doctor and the scripts run on Linux (WSL on Windows) with OpenFOAM 14 from openfoam.org. See `README.md`.

## Working on this repository

- No simulation data, CAD, meshes, results, team names or personal paths may be committed: `tools/data_guard.py`
  runs as a pre-commit and pre-push hook (`git config core.hooksPath .githooks`). Use the motorBike tutorial or
  neutral names (case1, case7) in tests.
- Licence GPL-3.0-or-later (the C++ tools link OpenFOAM).
- Claude Code users can install the skills as a plugin: see `docs/claude.md`.
