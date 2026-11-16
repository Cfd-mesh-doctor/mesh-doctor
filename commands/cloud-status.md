---
description: "Progress of a Google Cloud solve started with the cloud-solve-gcp skill"
argument-hint: "<gs://bucket>"
---

# Cloud run status

Read `<bucket>/results/progress.txt` (`gcloud storage cat`, or in a signed-in browser at
`https://storage.cloud.google.com/<bucket>/results/progress.txt`). Report the state, last iteration, force means and
drift, and estimate the finish time from the iteration rate. If it is done, list the result files and offer to
download them (ask first: they can be several GB). Never start, stop or delete VMs without the user's OK.

## Where things are

- The toolkit folder is `${CLAUDE_PLUGIN_ROOT}` (the plugin install), or the current folder if it holds `meshdoctor/`
  and `skills/`. On Windows, everything runs inside WSL: a Windows path `C:\<folder>` is `/mnt/c/<folder>` there. Run
  commands with `wsl -e bash <script.sh>` (write multi-line commands to a script file; inline quoting breaks).
- Load OpenFOAM first in every shell: `. /opt/openfoam14/etc/bashrc`.
- Cases live in the Linux file system (`~/...`) and are never edited in place: jobs work on copies.
