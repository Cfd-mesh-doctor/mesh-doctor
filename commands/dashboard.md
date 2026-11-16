---
description: "Start the live CFD dashboard and open it in the side panel (run progress, forces, residuals, Mesh Doctor)"
argument-hint: "[case folder to follow live]"
---

# Live dashboard

Start the Mesh Doctor dashboard and show it to the user, following the case in `$ARGUMENTS` (if given).

1. If `curl -s -o /dev/null -w "%{http_code}" http://localhost:8765/` already answers 200, it is running: skip to
   step 3 (if a different case should be followed, say so and offer to restart it).
2. Start it in the background inside WSL from the toolkit folder: `python3 -m meshdoctor serve --case <case>`
   (without `--case` if none was given). Use `run_in_background` (or `nohup ... &`), then wait until the URL answers
   (up to ~20 s).
3. Open `http://localhost:8765/` in the side panel: in the Claude desktop app use the built-in browser tools
   (`preview_start` with that url, or `navigate`); in a terminal-only session print the link for the user to open.
4. Tell the user what each page shows, one line each:
   - `/` the followed case live: iteration or time, forces per group, residuals, averaging window, end time
   - `/run` a solver run started from Mesh Doctor (A/B test) with the live convergence judge
   - `/meshdoctor` repairs: checkMesh before/after, problem regions, 3D view
   - `/meshmap` where the mesh was repaired versus where the flow still moves
5. Leave it running. To stop it later: `pkill -f "meshdoctor serve"` inside WSL (only that process).

## Where things are

- The toolkit folder is `${CLAUDE_PLUGIN_ROOT}` (the plugin install), or the current folder if it holds `meshdoctor/`
  and `skills/`. On Windows, everything runs inside WSL: a Windows path `C:\<folder>` is `/mnt/c/<folder>` there. Run
  commands with `wsl -e bash <script.sh>` (write multi-line commands to a script file; inline quoting breaks).
- Load OpenFOAM first in every shell: `. /opt/openfoam14/etc/bashrc`.
- Cases live in the Linux file system (`~/...`) and are never edited in place: jobs work on copies.
