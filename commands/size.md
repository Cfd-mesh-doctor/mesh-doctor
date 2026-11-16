---
description: "Will a mesh of N million cells fit on this machine, how long will it take, what will the cloud or SimScale cost?"
argument-hint: "<million cells> [--iters N]"
---

# Size and cost

Run `python3 skills/cfd-results/scripts/size_estimate.py $ARGUMENTS`, adding `--ram` (from `free -g` inside WSL)
and `--cores` (physical cores minus 2) unless given. Summarise in three lines: fits here or not, local time, cloud
time and cost, SimScale core hours. Say the numbers are +-30 %.

## Where things are

- The toolkit folder is `${CLAUDE_PLUGIN_ROOT}` (the plugin install), or the current folder if it holds `meshdoctor/`
  and `skills/`. On Windows, everything runs inside WSL: a Windows path `C:\<folder>` is `/mnt/c/<folder>` there. Run
  commands with `wsl -e bash <script.sh>` (write multi-line commands to a script file; inline quoting breaks).
- Load OpenFOAM first in every shell: `. /opt/openfoam14/etc/bashrc`.
- Cases live in the Linux file system (`~/...`) and are never edited in place: jobs work on copies.
