#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
#
# One-command setup on Ubuntu 22.04 (native or WSL): OpenFOAM 14, the Python packages, ParaView, and Mesh Doctor.
#
#   bash tools/setup_linux.sh               install what is missing (asks for your sudo password once)
#   bash tools/setup_linux.sh --dry-run     only print what it would do
#   bash tools/setup_linux.sh --no-paraview skip ParaView (about 600 MB; only the picture scripts need it)
#
# Safe to run again: anything already installed is skipped. It never touches your cases. Without a clone around
# it (e.g. run from a downloaded copy), it clones the repository to ~/mesh-doctor and builds there.
set -u
DRY=0; PV=1
for a in "$@"; do
    case "$a" in
        --dry-run) DRY=1 ;;
        --no-paraview) PV=0 ;;
        -h|--help) sed -n '5,12p' "$0"; exit 0 ;;
        *) echo "unknown option $a"; exit 2 ;;
    esac
done
REPO_URL=https://github.com/Cfd-mesh-doctor/mesh-doctor
BASHRC=/opt/openfoam14/etc/bashrc

run() {                         # print, then run unless --dry-run
    echo "+ $*"
    [ "$DRY" = 1 ] && return 0
    "$@" || { echo "FAILED: $*"; exit 1; }
}
have_pkg() { dpkg -s "$1" > /dev/null 2>&1; }
load_foam() {                   # OpenFOAM's bashrc reads variables nobody sets ($ZSH_NAME): never under set -u
    set +u
    . "$BASHRC"
    set -u
}

. /etc/os-release 2>/dev/null
if [ "${VERSION_CODENAME:-}" != "jammy" ]; then
    echo "This script is for Ubuntu 22.04 (jammy); this is ${PRETTY_NAME:-unknown}."
    echo "OpenFOAM 14 packages exist for other Ubuntu versions too: see https://openfoam.org/download/"
    exit 1
fi

# 1. OpenFOAM 14 from openfoam.org
if [ -f "$BASHRC" ]; then
    echo "OpenFOAM 14: already installed"
else
    echo "OpenFOAM 14: installing (about 1 GB)"
    run sudo sh -c "wget -qO /etc/apt/trusted.gpg.d/openfoam.asc https://dl.openfoam.org/gpg.key"
    run sudo sh -c "echo 'deb http://dl.openfoam.org/ubuntu jammy main' > /etc/apt/sources.list.d/openfoam.list"
    run sudo apt-get update -q
    run sudo apt-get install -y openfoam14
fi

# 2. Python packages and build tools (Mesh Doctor's repair map, the charts, contact sheets)
PKGS=""
for p in python3-numpy python3-matplotlib python3-pil git make g++; do have_pkg "$p" || PKGS="$PKGS $p"; done
if [ "$PV" = 1 ]; then for p in paraview python3-paraview; do have_pkg "$p" || PKGS="$PKGS $p"; done; fi
if [ -n "$PKGS" ]; then
    echo "Packages:$PKGS"
    run sudo apt-get install -y $PKGS
else
    echo "Packages: already installed"
fi

# 3. Mesh Doctor: build the OpenFOAM utilities
HERE=$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)
if [ -f "$HERE/Allwmake" ] && [ -d "$HERE/meshdoctor" ]; then
    ROOT=$HERE
else
    ROOT=$HOME/mesh-doctor
    [ -d "$ROOT/.git" ] || run git clone "$REPO_URL" "$ROOT"
fi
case "$ROOT" in
    /mnt/*) echo "Note: the repository is on a Windows drive ($ROOT). That works, but keep your cases under ~/." ;;
esac
if [ "$DRY" = 1 ]; then
    echo "+ (cd $ROOT && . $BASHRC && ./Allwmake)"
else
    (cd "$ROOT" && load_foam && ./Allwmake > log.Allwmake 2>&1) || { echo "FAILED: ./Allwmake, see $ROOT/log.Allwmake"; exit 1; }
    echo "Mesh Doctor: built"
fi

# 4. Load OpenFOAM in every new terminal
if grep -qs "openfoam14/etc/bashrc" "$HOME/.bashrc"; then
    echo "~/.bashrc: already loads OpenFOAM"
elif [ "$DRY" = 1 ]; then
    echo "+ echo '. $BASHRC' >> ~/.bashrc"
else
    echo ". $BASHRC" >> "$HOME/.bashrc"; echo "~/.bashrc: now loads OpenFOAM"
fi

# 5. The meshdoctor command in every new terminal: a link to the clone's bin/meshdoctor in ~/.local/bin
LINK=$HOME/.local/bin/meshdoctor
if [ "$(readlink -f "$LINK" 2>/dev/null)" = "$(readlink -f "$ROOT/bin/meshdoctor")" ]; then
    echo "meshdoctor command: already in ~/.local/bin"
elif [ -e "$LINK" ]; then
    echo "meshdoctor command: ~/.local/bin/meshdoctor is another one (from pip or pipx?), left as it is"
else
    run mkdir -p "$HOME/.local/bin"
    run ln -sfn "$ROOT/bin/meshdoctor" "$LINK"
    [ "$DRY" = 1 ] || echo "meshdoctor command: now in ~/.local/bin"
fi
if grep -qs '\.local/bin' "$HOME/.bashrc"; then
    echo "~/.bashrc: already puts ~/.local/bin on PATH"
elif [ "$DRY" = 1 ]; then
    echo "+ echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
else
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"; echo "~/.bashrc: now puts ~/.local/bin on PATH"
fi

# 6. A folder for cases, and the check
if [ "$DRY" = 0 ]; then
    load_foam
    mkdir -p "$FOAM_RUN"
    echo
    python3 "$ROOT/tools/toolkit_check.py"
    echo
    echo "Done. Open a new terminal (or run: . ~/.bashrc), then try the worked example:"
    echo "  cp -r $ROOT/examples/ahmed-body \$FOAM_RUN/ahmed && cd \$FOAM_RUN/ahmed && ./Allmesh"
    echo "In Claude Code with the cfd-toolkit plugin, /testrun does all of it."
fi
