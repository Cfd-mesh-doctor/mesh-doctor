---
name: cloud-solve-gcp
description: Solve an OpenFOAM case that is too big for the local PC on a Google Cloud VM without SSH - bucket upload, a VM whose startup script installs OpenFOAM 14, runs the case, uploads results and stops itself, progress watching, continuing a run, downloading and unpacking results. Use when a case needs more memory/cores than the local machine, or the user mentions Google Cloud / GCP / a cloud run.
---

# OpenFOAM on a Google Cloud VM (no SSH)

Scripts in `scripts/`: `gcp_run.sh` (does the whole run on the VM) and `vm_startup.sh` (the VM's startup script,
which starts gcp_run.sh once as a normal user).

## Ground rules

- **Money:** before creating or starting any VM, tell the user the machine type, the hourly price and the expected
  total, and get a clear yes. Never do a billing upgrade or enter payment details; the user does that.
- **Free trial:** $300 credit, 90 days, and **12 vCPUs total across all regions** (not adjustable). A free-trial
  account is not charged; only the user's own "Upgrade" can lead to card charges. A 12-vCPU / 96 GB custom N2 fits;
  bigger machines need an upgraded account and maybe a quota request.
- The user signs in (console and `gcloud auth login`). Never type their codes. After the job they can run
  `gcloud auth revoke`.
- Delete VMs or disks only with the user's OK. A stopped VM still bills its disk (~$0.33/day for 100 GB).

## Sizing

Solver ~1.7-2 GB per million cells; `decomposePar` is serial and needs much more (55-60 GB for a 31M-cell case), so
plan memory for decomposePar, or decompose locally and upload the decomposed case. On N2 machines use ranks = physical
cores = half the vCPUs. Measured: 31M cells, kOmegaSST steady, 6 ranks on 12 vCPUs: ~67 s per iteration, 1000
iterations in ~18 h, ~$15 of credit.

## Steps

1. **Pack the case:** a folder `CASE/` with `Allrun` that takes `RANKS [ITERATIONS]` (decomposePar if needed, then
   `foamRun -parallel`). `tar czf CASE.tar.gz CASE && sha256sum CASE.tar.gz > CASE.tar.gz.sha256`.
2. **Bucket:** create one (Standard, uniform access, public access prevented) in the VM's region. Upload
   `gcp_run.sh`, `CASE.tar.gz`, `CASE.tar.gz.sha256`. Files over a few MB: the user uploads them with the console's
   Upload button, or `gcloud storage cp` from WSL (installing gcloud is a download: ask first).
3. **VM:** Ubuntu 24.04, disk >= 100 GB, access scope Storage read-write, a maximum run duration with "stop" as the
   action (a safety net), metadata keys `bucket=gs://...`, `case=CASE` (optional `ranks`, `iterations`), and
   `vm_startup.sh` as the startup script (Advanced -> Automation). No SSH needed.
4. **Watch:** serial port 1 shows `cfdrun: started` ~30 s after boot. `gs://BUCKET/results/progress.txt` updates
   every 10 minutes (state, last iteration, force means and drift, end of the solver log). It reads in a signed-in
   browser at `https://storage.cloud.google.com/BUCKET/results/progress.txt`.
5. **End:** the script reconstructs the last time, uploads `results-fields-<T>-<stamp>.tar` (fields) and
   `results-small-<stamp>.tar.gz` (postProcessing, logs), and stops the VM. Download with
   `gcloud storage cp gs://BUCKET/results/... .` (~13 MiB/s seen).
6. **Results locally:** untar the time folder into a copy of the case (symlink `constant/` to save disk), add
   `case.foam`, then use the paraview-post and cfd-results skills.

## Continuing a run

The startup script runs only once (marker file `/var/lib/cfdrun-started`), so restarting the VM does nothing. To run
more iterations: set the `iterations` metadata higher, swap in a startup script with a new marker name (or remove the
marker), then start the VM. gcp_run.sh goes on from the latest save; the processor folders stay on the VM's disk.
Allrun should move the old solver log aside, and postProcessing gets new `<fo>/<startTime>/` folders - merge them.

## Console quirks (browser automation)

Closing the browser pane loses a half-filled form. Grid cells are often invisible to accessibility search: use
screenshots there. Large file uploads can't go through browser automation tools; the user uploads them.
