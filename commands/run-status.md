---
description: "Progress of a running or finished OpenFOAM case: iteration, speed, time left, forces and how settled they are"
argument-hint: "<case folder>"
---

# Run status

Report on the OpenFOAM case in `$ARGUMENTS` without changing anything.

1. Find the solver log (`log.foamRun`; restarts may leave `log.foamRun.<date>`), `endTime` in
   `system/controlDict`, and whether a solver is running (`pgrep -x foamRun`, `ps -C foamRun -o rss=`).
2. From the log: last iteration (or time), seconds per iteration over the last ~50 steps (`ExecutionTime`), time left
   to `endTime`, and the latest initial residuals.
3. Forces: run `skills/paraview-post/scripts/plot_convergence.py <case> ~/cfd-pictures/<case name> status "<case name>"`
   with the right `--total`, `--drag/--down`, `--uinf`, `--rho` (read them from the case's force function objects),
   so the charts go outside the case. Show the means over the last window, the drift between the last two windows,
   and the residual drop. `meshdoctor results <case>` gives the means with the uncertainty of each, CdA, ClA and L/D,
   and the judge's verdict.
4. Verdict in one line: still settling / settled (drift under ~1 %) / diverging, and how many more iterations look
   needed. Follow the cfd-results skill.
5. Offer `/cfd-toolkit:dashboard <case>` to watch it live in the side panel.

## Where things are

- The toolkit folder is `${CLAUDE_PLUGIN_ROOT}` (the plugin install), or the current folder if it holds `meshdoctor/`
  and `skills/`. On Windows, everything runs inside WSL: a Windows path `C:\<folder>` is `/mnt/c/<folder>` there. Run
  commands with `wsl -e bash <script.sh>` (write multi-line commands to a script file; inline quoting breaks).
- Load OpenFOAM first in every shell: `. /opt/openfoam14/etc/bashrc`.
- Cases live in the Linux file system (`~/...`) and are never edited in place: jobs work on copies.
