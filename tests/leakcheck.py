# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Fail a test module on errors Python can only print, such as a file left open.

Python notices a file left open when it frees the file object, and warns then (a ResourceWarning). Under
-W error::ResourceWarning the warning is an error, but an error raised while an object is freed can't stop the code
that freed it: Python prints it ("Exception ignored in: ...") and carries on, and the tests would pass. A test module
that takes setUpModule and tearDownModule from here records each such error and fails at its end if there was one:

    from leakcheck import setUpModule, tearDownModule  # noqa: E402,F401

A file left open is such an error in that module's tests without -W too (a plain `python3 -m unittest`).
"""
import gc
import sys
import warnings

seen = []          # what Python could only print while a module that uses this ran


def _record(unraisable):
    seen.append(f"{unraisable.exc_type.__name__}: {unraisable.exc_value}")
    sys.__unraisablehook__(unraisable)          # and print it as Python would, with where it happened


def setUpModule():
    warnings.filterwarnings("error", category=ResourceWarning)
    seen.clear()
    sys.unraisablehook = _record


def tearDownModule():
    gc.collect()                                # an object held in a reference cycle is freed only now
    sys.unraisablehook = sys.__unraisablehook__
    found, seen[:] = seen[:], []
    if found:
        raise AssertionError(f"{len(found)} error(s) Python could only print (see \"Exception ignored\" above), such "
                             "as a file left open:\n  " + "\n  ".join(found))
