---
description: "Run the worked example: Ahmed body mesh, Mesh Doctor, solve, charts, pictures, compare with the wind tunnel"
argument-hint: "[ranks] [iterations]"
---

# Ahmed body demo

Follow `examples/ahmed-body/README.md` step by step on a copy in `$FOAM_RUN/ahmed` (about an hour on 6 cores):
`./Allmesh`, `meshdoctor full`, `./Allrun <ranks> <iterations>` (the demo uses 6 and 2000; `Allrun` alone defaults to 4 ranks) in the background with
`/cfd-toolkit:dashboard $FOAM_RUN/ahmed` open, then the charts and pictures, and finally compare the last-500 mean Cd
with the README's table. Report each step as it finishes.

## Where things are

- The toolkit folder is `${CLAUDE_PLUGIN_ROOT}` (the plugin install), or the current folder if it holds `meshdoctor/`
  and `skills/`. On Windows, everything runs inside WSL: a Windows path `C:\<folder>` is `/mnt/c/<folder>` there. Run
  commands with `wsl -e bash <script.sh>` (write multi-line commands to a script file; inline quoting breaks).
- Load OpenFOAM first in every shell: `. /opt/openfoam14/etc/bashrc`.
- Cases live in the Linux file system (`~/...`) and are never edited in place: jobs work on copies.
