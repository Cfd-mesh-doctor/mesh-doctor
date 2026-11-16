---
description: "Test the whole toolkit on this machine: setup check, then the Ahmed body from mesh to wind-tunnel comparison, live in the side panel"
argument-hint: "[quick | full] [ranks]"
---

# Test run

A first run for a new user: proves every part of the toolkit works here, end to end, on the built-in Ahmed body
example. Mode from `$ARGUMENTS`: `quick` (default: 300 iterations, about 10 min on 6 cores, checks that everything
works but Cd is not settled yet) or `full` (2000 iterations, about 45 min, Cd comparable with the wind tunnel).
Ranks: the number in the arguments, else physical cores minus 2 (at most 8).

Report each step in one line as it finishes. Stop at the first failure, show the last lines of its log, and look it up
in `docs/troubleshooting.md`.

1. **Setup check:** `python3 tools/toolkit_check.py`. If OpenFOAM 14 is MISSING, stop and offer
   `/cfd-toolkit:toolkit-check` to install it (installs need the user's OK). ParaView missing only skips step 6.
2. **Copy:** `cp -r examples/ahmed-body $FOAM_RUN/ahmed_testrun` (if it exists, ask before replacing it), then
   `cd` there. Never run inside the toolkit folder.
3. **Mesh:** `./Allmesh` (about 3 min, 1.5 GB). Report the cell count (about 0.84 M) and max non-orthogonality
   (about 61); "concave cells" is the one expected failed check.
4. **Mesh Doctor:** `python3 -m meshdoctor full $FOAM_RUN/ahmed_testrun ahmed_testrun_fix` from the toolkit folder.
   Expected: nothing to repair, no regressions.
5. **Solve, live:** start `./Allrun <ranks> <300 or 2000>` in the background, then open the dashboard on it the way
   `/cfd-toolkit:dashboard $FOAM_RUN/ahmed_testrun` does, so the user watches the progress in the side panel. After
   a minute confirm it is iterating and give the finish time. Wait for it to end (do not poll faster than every few
   minutes) and check `log.foamRun` ends without FATAL and `log.reconstructPar` exists.
6. **Charts and pictures:** `plot_convergence.py` with `--total forcesTotal --uinf 40 --rho 1.205 --window <100 for
   quick, 500 for full>`, then `cut_views.py` with `examples/ahmed-body/cuts.json` and `vortex_views.py` at
   `20000,70000,200000`, both `--walls ahmed`, and `make_contact.py`. Show the contact sheet.
7. **Verdict:** mean Cd over the window against the wind tunnel's 0.285 (this example gave 0.280 at 2000
   iterations). Quick mode: say the Cd is not settled yet and offer `full`. Then a short table: step, time taken,
   OK or not. Leave the dashboard running and say how to stop it.

## Where things are

- The toolkit folder is `${CLAUDE_PLUGIN_ROOT}` (the plugin install), or the current folder if it holds `meshdoctor/`
  and `skills/`. On Windows, everything runs inside WSL: a Windows path `C:\<folder>` is `/mnt/c/<folder>` there. Run
  commands with `wsl -e bash <script.sh>` (write multi-line commands to a script file; inline quoting breaks).
- Load OpenFOAM first in every shell: `. /opt/openfoam14/etc/bashrc`.
- Cases live in the Linux file system (`~/...`) and are never edited in place: jobs work on copies.
