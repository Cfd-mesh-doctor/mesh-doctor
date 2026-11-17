# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
#
# One-command setup on Windows 10/11: WSL with Ubuntu 22.04, then OpenFOAM 14, Python packages, ParaView and Mesh
# Doctor inside it (tools/setup_linux.sh).
#
#   powershell -ExecutionPolicy Bypass -File tools\setup_windows.ps1            install what is missing
#   powershell -ExecutionPolicy Bypass -File tools\setup_windows.ps1 -DryRun    only print what it would do
#   ... -NoParaView                                                             skip ParaView
#
# First time: installing WSL needs an administrator PowerShell and a restart. After the restart Ubuntu opens and asks
# for a Linux user name and password (your choice; the password is for sudo). Then run this script again.
param([switch]$DryRun, [switch]$NoParaView)
$ErrorActionPreference = 'Stop'
$Distro = 'Ubuntu-22.04'

function Say($m) { Write-Host $m }

# 1. WSL and Ubuntu 22.04
$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
$have = $false
if ($wsl) {
    # wsl -l -q prints UTF-16; strip the NUL bytes before comparing
    $list = (& wsl.exe -l -q 2>$null) -join "`n" -replace "`0", ''
    $have = $list -split "`n" | Where-Object { $_.Trim() -eq $Distro }
}
if (-not $have) {
    Say "WSL with $Distro is not installed."
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($DryRun) { Say "+ wsl --install -d $Distro   (needs administrator, then a restart)"; exit 0 }
    if (-not $admin) {
        Say "Open PowerShell as administrator (right-click > Run as administrator) and run this script again."
        exit 1
    }
    & wsl.exe --install -d $Distro
    Say ""
    Say "Restart Windows. Ubuntu then opens and asks for a user name and password; after that, run this script again."
    exit 0
}
Say "WSL: $Distro is installed"

# 2. Everything inside Ubuntu: run setup_linux.sh from this folder (seen from WSL as /mnt/<drive>/...)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$drive = $here.Substring(0, 1).ToLower()
$linux = '/mnt/' + $drive + ($here.Substring(2) -replace '\\', '/') + '/setup_linux.sh'
$args2 = @()
if ($DryRun) { $args2 += '--dry-run' }
if ($NoParaView) { $args2 += '--no-paraview' }
Say "Running setup_linux.sh inside $Distro (asks for your Linux password for sudo)"
& wsl.exe -d $Distro -- bash $linux @args2
if ($LASTEXITCODE -ne 0) { Say "setup_linux.sh failed (exit $LASTEXITCODE): see the messages above."; exit $LASTEXITCODE }

Say ""
Say "Ready. Open 'Ubuntu 22.04' from the Start menu for an OpenFOAM terminal. The dashboard (meshdoctor serve) is"
Say "then at http://localhost:8765 in your Windows browser. Keep cases in the Linux home (~), not under /mnt/c."
