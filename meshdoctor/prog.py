# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""The meshdoctor command as it is typed here, for help and messages that give a command to run.

bin/meshdoctor, the launcher the setup scripts link into ~/.local/bin, says how it was started
(MESHDOCTOR_PROG); pip's meshdoctor command runs under that name; anything else gets
python3 -m meshdoctor, which works from the folder that holds meshdoctor/.
"""
import os, sys

MODULE = "python3 -m meshdoctor"


def name():
    """How to type the command here: what the launcher said, meshdoctor for pip's command, else MODULE."""
    told = os.environ.get("MESHDOCTOR_PROG", "").strip()
    if told:
        return told
    if sys.argv and os.path.basename(sys.argv[0] or "") == "meshdoctor":
        return "meshdoctor"
    return MODULE


def text(s):
    """s with every python3 -m meshdoctor in it written as the command is typed here."""
    return s.replace(MODULE, name())
