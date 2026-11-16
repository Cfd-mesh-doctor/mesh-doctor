---
description: "Check an OpenFOAM mesh and repair it with Mesh Doctor on a copy, then show the before/after"
argument-hint: "<case folder> [run name]"
---

# Mesh check and repair

Use the mesh-doctor skill. Case: first word of `$ARGUMENTS`; run name: second word, else `<case name>_fix`.

1. Estimate memory first: `python3 skills/cfd-results/scripts/size_estimate.py <million cells>` (cells from the
   `constant/polyMesh/owner` header note) and check free RAM. One big job at a time.
2. `python3 -m meshdoctor full <case> <name>` from the toolkit folder (it copies; the source is never changed).
3. Report the checkMesh table before -> after (max non-orthogonality, max skewness, bad tets, concave cells, failed
   checks), any regressions, and whether anything was rolled back.
4. Open `http://localhost:8765/meshdoctor?run=<name>` in the side panel (start `/cfd-toolkit:dashboard` first if the
   dashboard is not running).
5. If max non-orthogonality is still above ~65 or bad tets remain, offer `meshdoctor experimental ratchet` or
   `polish --tets --tet-cap 1`; offer `meshdoctor ab` to prove the repair in the solver.

## Where things are

- The toolkit folder is `${CLAUDE_PLUGIN_ROOT}` (the plugin install), or the current folder if it holds `meshdoctor/`
  and `skills/`. On Windows, everything runs inside WSL: a Windows path `C:\<folder>` is `/mnt/c/<folder>` there. Run
  commands with `wsl -e bash <script.sh>` (write multi-line commands to a script file; inline quoting breaks).
- Load OpenFOAM first in every shell: `. /opt/openfoam14/etc/bashrc`.
- Cases live in the Linux file system (`~/...`) and are never edited in place: jobs work on copies.
