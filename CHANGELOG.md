# Changelog

## 0.3.0 (2026-11-16)

Everything since 0.1.0 (0.2.0 was the plugin version on main without a release).

- **Claude Code plugin `cfd-toolkit`** (`.claude-plugin/`, `skills/`): skills for Mesh Doctor, OpenFOAM on
  WSL/Linux, SimScale, ParaView post-processing, Google Cloud solves and reading results, with helper scripts.
  Install: `/plugin marketplace add Cfd-mesh-doctor/mesh-doctor`, then `/plugin install cfd-toolkit@mesh-doctor`.
- **AGENTS.md**: points any AI coding agent to the skill for each task.
- **Worked example `examples/ahmed-body`**: the Ahmed body from published dimensions, meshed, checked with Mesh
  Doctor, solved and compared with wind-tunnel measurements; also the template for new cases.
- **Slash commands** (`commands/`): `/testrun` tests the whole toolkit on the Ahmed example with live progress;
  `/cfd-toolkit:dashboard` opens the live dashboard in the side panel; also
  `run-status`, `solve`, `mesh-check`, `pictures`, `size`, `toolkit-check`, `ahmed-demo`, `cloud-status`.
- Dashboard: the live page follows a plain case (one `foamRun`, steady or transient) as well as the staged
  steady-then-DDES run, and hides the stage it doesn't use.
- paraview-post: how to bring a case in other axes into the toolkit's axes (`transformPoints -rotateFields`).
- **`tools/setup_linux.sh`, `tools/setup_windows.ps1`**: one-command setup (WSL + Ubuntu 22.04, OpenFOAM 14,
  Python packages, ParaView, Mesh Doctor), with a dry-run mode.
- **Template `examples/wheel-wing`**: front wing in ground effect and a rotating wheel on a moving ground.
- **Accuracy check `examples/ahmed-body/Allvalidate`** and `docs/validation.md`: three meshes and two slant angles
  against the wind tunnel.
- **`tools/toolkit_check.py`**: is this machine ready for each skill?
- **`skills/cfd-results/scripts/size_estimate.py`**: memory, time and cost for a mesh size, from measured runs.
- **docs/gallery.md**: pictures from the worked example.
- paraview-post fixes: the speed colour range follows `--uinf`; the force chart shows negative downforce (lift);
  side-view captions say the front is on the left.
- **docs/troubleshooting.md**, an issue template, this changelog.
- Data guard: GitHub's `support@github.com` (Dependabot's sign-off) is allowed.

## 0.1.0

- First release: Mesh Doctor repair (`full`, `copy`, `inspect`, `fix`), A/B solver test and judge, repair map,
  dashboard, experimental `ratchet` and `polish`, Docker, Apptainer + Slurm, data guard, CI.
