---
description: "Start an OpenFOAM solve in the background (sized first) and follow it on the dashboard"
argument-hint: "<case folder> [ranks] [iterations]"
---

# Solve

Case, ranks and iterations from `$ARGUMENTS` (defaults: physical cores minus 2, the case's endTime).

1. Size it: cells -> `size_estimate.py`. If the solve does not fit in memory, stop and offer the cloud-solve-gcp skill.
2. Make sure nothing else heavy runs (`ps -eo comm,rss --sort=-rss | head`). Ask before stopping anything.
3. If the case has an `Allrun` taking `ranks [iterations]` (like `examples/ahmed-body`), run that in the background;
   otherwise `decomposePar` (if not decomposed), `potentialFoam -parallel` (first start only), `foamRun -parallel`.
   Use `run_in_background`; logs stay in the case folder.
4. After about a minute confirm it is iterating (`Time =` lines in `log.foamRun`, no `FATAL`), and give the seconds
   per iteration and the expected finish time.
5. Run `/cfd-toolkit:dashboard <case>` so the user can watch it in the side panel.

A case Mesh Doctor made (`meshdoctor new`) is solved with `meshdoctor solve <case> --to N --np P` instead: it checks the
memory, does step 3 itself and lists the run on the web app's Solve screen. A copy of a case the user made can be
solved that way too (`skills/mesh-doctor/SKILL.md`, Making and solving a case).

## Where things are

- The toolkit folder is `${CLAUDE_PLUGIN_ROOT}` (the plugin install), or the current folder if it holds `meshdoctor/`
  and `skills/`. On Windows, everything runs inside WSL: a Windows path `C:\<folder>` is `/mnt/c/<folder>` there. Run
  commands with `wsl -e bash <script.sh>` (write multi-line commands to a script file; inline quoting breaks).
- Load OpenFOAM first in every shell: `. /opt/openfoam14/etc/bashrc`.
- Cases live in the Linux file system (`~/...`) and are never edited in place: jobs work on copies.
