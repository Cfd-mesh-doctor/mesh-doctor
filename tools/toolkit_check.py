#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Is this machine ready for each CFD skill? Checks only; installs and changes nothing.

    python3 tools/toolkit_check.py

Prints one block per skill (mesh-doctor, openfoam-wsl, paraview-post, cloud-solve-gcp, cfd-results, simscale) with
what is there, what is missing and the command that installs it. Run it inside WSL on Windows.
Python 3 standard library only.
"""
import importlib.util
import os
import platform
import shutil
import subprocess

BASHRC = os.environ.get('MESHDOCTOR_FOAM_BASHRC', '/opt/openfoam14/etc/bashrc')
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OK, NO, MAYBE = 'ok  ', 'MISSING', 'note'


def sh(cmd):
    """Run cmd in bash with OpenFOAM loaded if it exists; return (exit code, output)."""
    pre = '. %s > /dev/null 2>&1; ' % BASHRC if os.path.isfile(BASHRC) else ''
    try:
        p = subprocess.run(['bash', '-c', pre + cmd], capture_output=True, text=True, timeout=60)
        return p.returncode, (p.stdout + p.stderr).strip()
    except Exception as e:
        return 1, str(e)


def has_py(mod):
    return importlib.util.find_spec(mod) is not None


def line(state, what, fix=''):
    print('  [%s] %s%s' % (state, what, ('\n           -> ' + fix) if fix and state != OK else ''))


def main():
    print('Machine: %s %s, Python %s' % (platform.system(), platform.release(), platform.python_version()))
    if platform.system() != 'Linux':
        print('This toolkit runs on Linux. On Windows, install WSL Ubuntu 22.04 and run this inside it:'
              '\n  wsl --install -d Ubuntu-22.04')
        return
    if 'microsoft' in platform.release().lower():
        print('Running inside WSL. Keep cases under ~ (not /mnt/c): OpenFOAM is many times slower there.')
    try:
        mem = int(open('/proc/meminfo').read().split()[1]) / 1048576
        print('Memory: %.0f GB (python3 skills/cfd-results/scripts/size_estimate.py <Mcells> says what fits)' % mem)
    except Exception:
        pass

    print('\nopenfoam-wsl (OpenFOAM 14 from openfoam.org)')
    of = os.path.isfile(BASHRC)
    line(OK if of else NO, 'OpenFOAM bashrc %s' % BASHRC, 'see README.md "Linux" (apt install openfoam14)')
    rc, out = sh('foamRun -help > /dev/null 2>&1 && echo yes; echo $WM_PROJECT_VERSION')
    ver = out.splitlines()[-1] if out else ''
    line(OK if 'yes' in out and ver.startswith('14') else NO, 'foamRun, version %s' % (ver or '?'),
         'OpenFOAM 14 (openfoam.org) is needed; ESI v2xxx releases do not work')
    for app in ('snappyHexMesh', 'surfaceFeatures', 'checkMesh', 'decomposePar', 'mpirun'):
        rc, out = sh('command -v %s' % app)
        line(OK if rc == 0 else NO, app, 'comes with openfoam14')

    print('\nmesh-doctor')
    for app in ('foamMeshDoctor', 'foamResidualHotspots'):
        rc, out = sh('command -v %s' % app)
        line(OK if rc == 0 else NO, app, 'cd %s && ./Allwmake' % HERE)
    line(OK if has_py('numpy') else NO, 'python3 numpy (repair map)', 'sudo apt install python3-numpy')
    line(OK if os.path.isfile(os.path.join(HERE, 'bin', 'meshdoctor')) else NO, 'bin/meshdoctor launcher')

    print('\nparaview-post')
    pv = shutil.which('pvbatch')
    line(OK if pv else NO, 'pvbatch (ParaView)', 'sudo apt install paraview python3-paraview')
    if pv:
        rc, out = sh('PYTHONPATH=/usr/lib/python3/dist-packages pvbatch --version 2>&1 | head -1')
        line(OK if rc == 0 else MAYBE, out or 'pvbatch --version failed')
    line(OK if has_py('matplotlib') else NO, 'python3 matplotlib (convergence charts)', 'sudo apt install python3-matplotlib')
    line(OK if has_py('PIL') else NO, 'python3 PIL (contact sheets)', 'sudo apt install python3-pil')

    print('\ncloud-solve-gcp')
    g = shutil.which('gcloud') or next((p for p in [os.path.expanduser('~/google-cloud-sdk/bin/gcloud'),
                                                    os.path.expanduser('~/gcloud-cli/google-cloud-sdk/bin/gcloud')]
                                        if os.path.isfile(p)), None)
    line(OK if g else MAYBE, 'gcloud CLI %s' % (g or 'not found'),
         'optional: https://cloud.google.com/sdk/docs/install (or upload with the console\'s Upload button)')

    print('\ncfd-results')
    line(OK, 'size_estimate.py (standard library only)')

    print('\nsimscale')
    line(MAYBE, 'needs a SimScale account signed in in a browser the AI agent can use; nothing to install')


if __name__ == '__main__':
    main()
