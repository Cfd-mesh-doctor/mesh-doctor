# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""caseinfo.py on small synthetic cases (no OpenFOAM needed).

    python3 -m unittest tests/test_caseinfo.py
"""
import os, shutil, struct, sys, tempfile, unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "meshdoctor"))
os.environ["MESHDOCTOR_CONFIG"] = os.devnull                # ignore any local config file
for _k in ("MESHDOCTOR_FLOW_AXIS", "MESHDOCTOR_UP_AXIS"):
    os.environ.pop(_k, None)
import caseinfo  # noqa: E402
import config  # noqa: E402

# settings from the environment only, on every platform (no WSL call on Windows)
config.settings = lambda: {k: v for k, (v, _) in config.resolve().items()}

HDR = "FoamFile\n{\n    format      %s;\n    class       volVectorField;\n    object      U;\n}\n"


class Case:
    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix="caseinfo_test_")

    def write(self, rel, data):
        p = os.path.join(self.dir, *rel.split("/"))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(data if isinstance(data, bytes) else data.encode())

    def forces(self, group, rows, t0="0"):
        """rows: [(t, (px,py,pz), (vx,vy,vz))] in the OpenFOAM 'forces' layout."""
        body = "# Forces\n# Time forces(pressure viscous)\n" + "".join(
            f"{t} (({p[0]} {p[1]} {p[2]}) ({v[0]} {v[1]} {v[2]}))\n" for t, p, v in rows)
        self.write(f"postProcessing/{group}/{t0}/forces.dat", body)

    def close(self):
        shutil.rmtree(self.dir, ignore_errors=True)


class FreestreamTest(unittest.TestCase):
    def setUp(self):
        self.c = Case()

    def tearDown(self):
        self.c.close()

    def test_uniform_internal_field(self):
        self.c.write("0/U", HDR % "ascii" + "internalField uniform (-15 0 0);\nboundaryField\n{\n}\n")
        self.assertEqual(caseinfo.flow(self.c.dir)[:2], (0, -1))

    def test_variable_and_include(self):
        self.c.write("0/include/ic", "flowVelocity (0 30 0);\n")
        self.c.write("0/U", HDR % "ascii" + '#include "include/ic"\ninternalField uniform $flowVelocity;\n'
                     "boundaryField\n{\n    inlet { type fixedValue; value $internalField; }\n}\n")
        self.assertEqual(caseinfo.freestream_uncached(self.c.dir), [0.0, 30.0, 0.0])

    def test_binary_list_is_skipped_and_inlet_preferred(self):
        n = 50000
        data = struct.pack("<%dd" % (3 * n), *([7.0, 8.0, 9.0] * n))
        body = (HDR % "binary").replace("format", 'arch "LSB;label=32;scalar=64";\n    format').encode() + \
            b"internalField nonuniform List<vector> \n%d\n(" % n + data + b")\n;\n" + \
            b"boundaryField\n{\n    ground { type fixedValue; value uniform (5 0 0); }\n" + \
            b"    frontInlet { type fixedValue; value uniform (0 0 -12); }\n}\n"
        self.c.write("0/U", body)
        self.assertEqual(caseinfo.freestream_uncached(self.c.dir), [0.0, 0.0, -12.0])

    def test_no_velocity_falls_back_to_plus_x(self):
        self.assertEqual(caseinfo.flow(self.c.dir)[:2], (0, 1))

    def test_axis_settings_override(self):
        os.environ["MESHDOCTOR_FLOW_AXIS"], os.environ["MESHDOCTOR_UP_AXIS"] = "-y", "x"
        try:
            self.c.forces("body", [(1, (100, 1, 50), (0, 0, 0))])
            d = caseinfo.describe(self.c.dir)
            self.assertEqual((d["flowAxis"], d["flowSign"], d["upAxis"]), (1, -1, 0))
            self.assertEqual(d["source"], {"flow": "config flow_axis", "up": "config up_axis"})
        finally:
            del os.environ["MESHDOCTOR_FLOW_AXIS"], os.environ["MESHDOCTOR_UP_AXIS"]


class DescribeTest(unittest.TestCase):
    def setUp(self):
        self.c = Case()
        self.c.write("0/U", HDR % "ascii" + "internalField uniform (15 0 0);\nboundaryField\n{\n}\n")

    def tearDown(self):
        self.c.close()

    def test_groups_axes_and_downforce(self):
        rows = [(i, (30, -60, 1), (1, 0, 0)) for i in range(1, 11)]
        self.c.forces("body", rows)
        self.c.forces("wing", [(i, (5, -40, 0), (0, 0, 0)) for i in range(1, 11)])
        d = caseinfo.describe(self.c.dir)
        self.assertEqual(d["total"], "body")
        self.assertEqual((d["flowAxis"], d["flowSign"], d["upAxis"], d["vertical"]), (0, 1, 1, "downforce"))
        frc = caseinfo.parse_forces(self.c.dir)
        self.assertEqual(caseinfo.series(frc, d, "body", "drag")[-1], (10.0, 31.0))
        self.assertEqual(caseinfo.series(frc, d, "wing", "vertical")[-1], (10.0, 40.0))

    def test_restart_later_file_wins(self):
        self.c.forces("body", [(1, (1, 2, 0), (0, 0, 0)), (2, (1, 2, 0), (0, 0, 0))], t0="0")
        self.c.forces("body", [(2, (9, 2, 0), (0, 0, 0)), (3, (9, 2, 0), (0, 0, 0))], t0="2")
        frc = caseinfo.parse_forces(self.c.dir)
        self.assertEqual(frc["body"]["Time"], [1.0, 2.0, 3.0])
        self.assertEqual(frc["body"]["Fx"], [1.0, 9.0, 9.0])

    def test_force_coeffs_converted_and_lift_dir_used(self):
        self.c.write("system/forceCoeffs", "rho rhoInf;\nrhoInf 1.2;\nliftDir (0 0 1);\n")
        self.c.write("postProcessing/forceCoeffs/0/forceCoeffs.dat",
                     "# Force coefficients\n# liftDir   : (0 0 1)\n# dragDir   : (1 0 0)\n"
                     "# magUInf   : 20\n# Aref      : 0.75\n# Time\tCm\tCd\tCl\tCl(f)\tCl(r)\n"
                     "1\t0.1\t0.4\t-0.2\t0\t0\n2\t0.1\t0.5\t-0.1\t0\t0\n")
        frc = caseinfo.parse_forces(self.c.dir)
        d = caseinfo.describe(self.c.dir, frc)
        self.assertEqual((d["upAxis"], d["source"]["up"]), (2, "forceCoeffs liftDir"))
        q = 0.5 * 1.2 * 20 ** 2 * 0.75
        self.assertAlmostEqual(caseinfo.series(frc, d, "forceCoeffs", "drag")[-1][1], 0.5 * q)
        self.assertAlmostEqual(caseinfo.series(frc, d, "forceCoeffs", "vertical")[-1][1], 0.1 * q)


class LogResidualsTest(unittest.TestCase):
    def test_first_solve_per_step_and_restart(self):
        c = Case()
        try:
            step = ("Time = {t}s\n\nsmoothSolver:  Solving for Ux, Initial residual = {u}, Final residual = 1e-5, No Iterations 2\n"
                    "GAMG:  Solving for p, Initial residual = {p}, Final residual = 1e-6, No Iterations 5\n"
                    "GAMG:  Solving for p, Initial residual = 0.5, Final residual = 1e-6, No Iterations 5\n\n")
            c.write("log.foamRun", "".join(step.format(t=t, u=0.1 / t, p=0.2 / t) for t in (1, 2, 3)))
            c.write("log.foamRun_ext_4", step.format(t=3, u=9, p=9) + step.format(t=4, u=0.01, p=0.02))
            os.utime(os.path.join(c.dir, "log.foamRun"), (1, 1))         # older than the extension
            r = caseinfo.log_residuals(caseinfo.solver_logs(c.dir))
            self.assertEqual(r["Time"], [1.0, 2.0, 3.0, 4.0])
            self.assertEqual(r["p"], [0.2, 0.1, 9.0, 0.02])               # first p solve; later log wins at t=3
            self.assertAlmostEqual(r["Ux"][1], 0.05)
        finally:
            c.close()


if __name__ == "__main__":
    unittest.main()
