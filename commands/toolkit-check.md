---
description: "Is this computer ready for each CFD skill? Lists what is missing and how to install it"
---

# Toolkit check

Run `python3 tools/toolkit_check.py` inside WSL/Linux from the toolkit folder and show its result. For each MISSING
line, offer the install command it prints, and ask before installing anything (downloads need the user's OK). On
Windows without WSL, explain `wsl --install -d Ubuntu-22.04` and that it needs a restart.

## Where things are

- The toolkit folder is `${CLAUDE_PLUGIN_ROOT}` (the plugin install), or the current folder if it holds `meshdoctor/`
  and `skills/`. On Windows, everything runs inside WSL: a Windows path `C:\<folder>` is `/mnt/c/<folder>` there. Run
  commands with `wsl -e bash <script.sh>` (write multi-line commands to a script file; inline quoting breaks).
- Load OpenFOAM first in every shell: `. /opt/openfoam14/etc/bashrc`.
- Cases live in the Linux file system (`~/...`) and are never edited in place: jobs work on copies.
