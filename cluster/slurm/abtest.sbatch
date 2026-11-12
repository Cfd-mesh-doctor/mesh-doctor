#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
#
# Solver A/B test (original vs repaired mesh) as a batch job on ONE node.
#
#   export MESHDOCTOR_WORKSPACE=$HOME/meshdoctor-work      # same as for the repair
#   sbatch --ntasks=8 cluster/slurm/abtest.sbatch <source case> <repair run name> [--iters 200 --init 0]
#
# Memory: about 1.35 KB per cell for the whole solve + 0.5 GB.  The two runs go
# one after the other.  MPI runs inside the container on this node only
# (multi-node MPI from a container is a later step).
#SBATCH --job-name=meshdoctor-ab
#SBATCH --nodes=1
#SBATCH --ntasks=6
#SBATCH --mem=16G
#SBATCH --time=12:00:00
#SBATCH --output=meshdoctor-ab-%j.log
set -euo pipefail
[ $# -ge 2 ] || { echo "usage: sbatch abtest.sbatch <source case> <repair run name> [abtest options]" >&2; exit 2; }
SRC=$(readlink -f "$1"); NAME=$2; shift 2
IMG=${MESHDOCTOR_IMAGE:-$HOME/meshdoctor.sif}
: "${MESHDOCTOR_WORKSPACE:?set MESHDOCTOR_WORKSPACE to the folder used for the repair}"
export MESHDOCTOR_CASES=$(dirname "$SRC")
apptainer run --bind "$SRC:$SRC:ro" --bind "$MESHDOCTOR_WORKSPACE" "$IMG" \
    ab "$SRC" "$NAME" --np "${SLURM_NTASKS:-6}" "$@"
