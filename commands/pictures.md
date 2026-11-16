---
description: "Make the standard picture set of a solved case: cut planes, vortices, pressure spots, charts"
argument-hint: "<case folder> [wall patches]"
---

# Pictures

Use the paraview-post skill on the case in `$ARGUMENTS` (read-only).

1. Wall patches: from the arguments, else the `wall` patches in `constant/polyMesh/boundary` minus the ground.
   Check the axes (x forward, flow toward -x, z up); if the case differs, say so before rendering.
2. Memory: the volume read needs roughly 0.6 GB per million cells; check free RAM.
3. Make, into `<case>/pictures`:
   - convergence charts with `plot_convergence.py`
   - 2-3 cut planes through the model (write a cuts JSON from the model's bounding box, like `cuts_example.json`)
   - vortices with `vortex_views.py` at Q = 3000,10000,30000 for 15 m/s (scale by (U/15)^2 for other speeds)
   - pressure spots with `pressure_spots.py`
   - one contact sheet with `make_contact.py`
4. Show the contact sheet, then list each file with one line on what it shows.

## Where things are

- The toolkit folder is `${CLAUDE_PLUGIN_ROOT}` (the plugin install), or the current folder if it holds `meshdoctor/`
  and `skills/`. On Windows, everything runs inside WSL: a Windows path `C:\<folder>` is `/mnt/c/<folder>` there. Run
  commands with `wsl -e bash <script.sh>` (write multi-line commands to a script file; inline quoting breaks).
- Load OpenFOAM first in every shell: `. /opt/openfoam14/etc/bashrc`.
- Cases live in the Linux file system (`~/...`) and are never edited in place: jobs work on copies.
