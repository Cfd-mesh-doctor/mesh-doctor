#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
#
# Mesh Doctor repair as a batch job (never on the login node).
#
#   export MESHDOCTOR_WORKSPACE=$HOME/meshdoctor-work      # outside every case
#   sbatch cluster/slurm/repair.sbatch <source case> <run name>
#
# Memory: about 1.5 KB per cell + 0.5 GB (10M cells -> 15 GB).  Adjust --mem.
# The repair itself is serial.  Partition/account lines depend on your cluster.
#SBATCH --job-name=meshdoctor-repair
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=1
#SBATCH --mem=16G
#SBATCH --time=04:00:00
#SBATCH --output=meshdoctor-repair-%j.log
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: sbatch repair.sbatch <source case> <run name>" >&2; exit 2; }
SRC=$(readlink -f "$1"); NAME=$2
IMG=${MESHDOCTOR_IMAGE:-$HOME/meshdoctor.sif}
: "${MESHDOCTOR_WORKSPACE:?set MESHDOCTOR_WORKSPACE to a folder outside every case}"
mkdir -p "$MESHDOCTOR_WORKSPACE"; chmod 700 "$MESHDOCTOR_WORKSPACE"
export MESHDOCTOR_CASES=$(dirname "$SRC")
# the source case is mounted read-only inside the container: it can only be read
apptainer run --bind "$SRC:$SRC:ro" --bind "$MESHDOCTOR_WORKSPACE" "$IMG" full "$SRC" "$NAME"
