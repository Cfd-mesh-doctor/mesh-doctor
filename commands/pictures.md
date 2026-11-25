---
description: "Make the standard picture set of a solved case: cut planes, vortices, pressure spots, charts"
argument-hint: "<case folder> [wall patches]"
---

# Pictures

Make pictures of the solved case in `$ARGUMENTS` without changing it: the picture set with Mesh Doctor (the mesh-doctor
skill's "Results, comparisons and pictures"), the rest with the paraview-post skill's scripts, into
`~/cfd-pictures/<case name>/` (make it first), outside the case.

1. Check the axes (x forward, flow toward -x, z up); if the case differs, say so before rendering. Memory: the volume
   read needs roughly 0.6 GB per million cells; check free RAM.
2. The picture set: `meshdoctor pictures <case>` (with `--mean` for a transient run's mean flow) makes the cut planes,
   the vortices and the pressure spots of its latest time in a folder of its own, which it prints: each kind in a
   subfolder, and `pictures.json` saying what each picture shows. It takes the walls from the case's force function
   object. If wall patches are given in the arguments, or it refuses for want of a force function object, make the
   same three by hand into `~/cfd-pictures/<case name>/`:
   - walls: from the arguments, else the `wall` patches in `constant/polyMesh/boundary` minus the ground
   - 2-3 cut planes through the model (write a cuts JSON from the model's bounding box, like `cuts_example.json`)
   - vortices with `vortex_views.py` at Q = 3000,10000,30000 for 15 m/s (scale by (U/15)^2 for other speeds)
   - pressure spots with `pressure_spots.py`

   If it refuses for another reason, say why and stop: no written result, no ParaView (`meshdoctor check`), or other
   axes (the paraview-post skill turns a copy, if the user wants).
3. Convergence charts with `plot_convergence.py`; quote the averaged forces from `meshdoctor results <case>`.
4. Contact sheets with `make_contact.py`, which reads one folder: `make_contact.py <folder> "" <sheet.png>` for each
   folder of pictures, the sheets in `~/cfd-pictures/<case name>/`. Show them, then list each file with one line on
   what it shows.

## Where things are

- The toolkit folder is `${CLAUDE_PLUGIN_ROOT}` (the plugin install), or the current folder if it holds `meshdoctor/`
  and `skills/`. On Windows, everything runs inside WSL: a Windows path `C:\<folder>` is `/mnt/c/<folder>` there. Run
  commands with `wsl -e bash <script.sh>` (write multi-line commands to a script file; inline quoting breaks).
- Load OpenFOAM first in every shell: `. /opt/openfoam14/etc/bashrc`.
- Cases live in the Linux file system (`~/...`) and are never edited in place: jobs work on copies.
