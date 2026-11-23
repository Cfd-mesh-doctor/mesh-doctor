# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Unit tests that need neither OpenFOAM nor a mesh.

    python3 -m unittest discover -s tests
"""
import contextlib, gc, io, json, math, os, re, shutil, subprocess, sys, tempfile, time, unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "meshdoctor"))
os.environ["MESHDOCTOR_CONFIG"] = os.devnull
import abtest, md_api, repair  # noqa: E402
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))    # leakcheck.py, beside this file
from leakcheck import setUpModule, tearDownModule  # noqa: E402,F401 (fails the module on a file left open)
import leakcheck  # noqa: E402


class BatchMeansTest(unittest.TestCase):
    def test_constant_signal(self):
        r = abtest.batch_means([5.0] * 100)
        self.assertEqual((r["mean"], r["u"], r["nBatches"], r["batchLen"]), (5.0, 0.0, 5, 20))

    def test_too_short(self):
        self.assertIsNone(abtest.batch_means([1.0] * 20))

    def test_slow_swing_gives_honest_uncertainty(self):
        x = [10 + math.sin(2 * math.pi * i / 400) for i in range(400)]   # one slow period
        r = abtest.batch_means(x)
        self.assertAlmostEqual(r["mean"], 10, places=6)
        self.assertGreater(r["u"], 0.3)                                 # not hidden by the long average


class NamesTest(unittest.TestCase):
    GOOD = ["case7", "mb_tutorial", "a.b-c", "X" * 80]
    BAD = ["", ".", "..", ".hidden", "a/b", "../x", "a b", "a;rm", "X" * 81, "a\nb"]

    def test_plain_names(self):
        for n in self.GOOD:
            self.assertEqual(repair.plain_name(n), n)
            self.assertTrue(md_api.SAFE.match(n), n)
        for n in self.BAD:
            with self.assertRaises(SystemExit, msg=n):
                repair.plain_name(n)
            self.assertFalse(md_api.SAFE.match(n), n)


class SourceCaseTest(unittest.TestCase):
    """A command's source case: the folder as given, else the case of that name in the cases folder."""

    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="md_src_"))
        self.addCleanup(shutil.rmtree, self.tmp)
        self.cases = os.path.join(self.tmp, "cases")
        os.makedirs(os.path.join(self.cases, "case7", "constant", "polyMesh"))
        os.makedirs(os.path.join(self.tmp, "outside"))    # next to the cases folder: never looked up in it
        self.here = os.path.join(self.tmp, "a", "b")        # where the command runs
        os.makedirs(os.path.join(self.here, "case1"))
        env = mock.patch.dict(os.environ, {"MESHDOCTOR_CASES": self.cases})
        env.start()
        self.addCleanup(env.stop)
        cwd = os.getcwd()
        os.chdir(self.here)
        self.addCleanup(os.chdir, cwd)

    def no_case(self, run):
        """The message a command stops with: no case."""
        with self.assertRaises(SystemExit) as e, contextlib.redirect_stdout(io.StringIO()):
            run()
        return str(e.exception.code)

    def test_a_folder_where_you_are_as_given(self):
        self.assertEqual(repair.source_case("case1"), os.path.join(self.here, "case1"))
        self.assertEqual(repair.source_case(os.path.join(self.cases, "case7")), os.path.join(self.cases, "case7"))

    def test_a_case_in_the_cases_folder_by_name_from_any_folder(self):
        with contextlib.redirect_stderr(io.StringIO()) as said:
            self.assertEqual(repair.source_case("case7"), os.path.join(self.cases, "case7"))
        self.assertEqual(said.getvalue(), f"using the case case7 in {self.cases}\n")   # which folder it used

    def test_a_folder_where_you_are_comes_first(self):
        os.makedirs(os.path.join(self.here, "case7"))
        self.assertEqual(repair.source_case("case7"), os.path.join(self.here, "case7"))

    def test_neither_stops_with_a_plain_message(self):
        # a path is only ever taken as given: "../outside" is next to the cases folder, not in it
        for arg in ("case9", "../outside", "sub/case7"):
            said = self.no_case(lambda: repair.source_case(arg))
            self.assertIn(f"no case {arg!r}: it is not a folder here, nor a case in the cases folder {self.cases}", said)

    def test_copy_full_and_ab_find_the_case_by_name(self):
        work = os.path.join(self.tmp, "work")
        with mock.patch.object(repair, "ROOT", work), contextlib.redirect_stdout(io.StringIO()) as out, \
                contextlib.redirect_stderr(io.StringIO()):
            repair.main(["copy", "case7", "case7-copy"])
        self.assertEqual(out.getvalue(), os.path.join(work, "case7-copy") + "\n")
        self.assertTrue(os.path.isdir(os.path.join(work, "case7-copy", "constant", "polyMesh")))
        with open(os.path.join(work, "case7-copy", ".meshDoctorCopy")) as f:
            self.assertEqual(f.read(), os.path.join(self.cases, "case7") + "\n")
        # an unknown case stops both before anything is copied, checked or solved
        with mock.patch.object(repair, "ROOT", work), mock.patch.object(abtest, "ROOT", work):
            self.assertIn("no case 'case9'", self.no_case(lambda: repair.main(["full", "case9", "x"])))
            self.assertIn("no case 'case9'", self.no_case(lambda: abtest.main(["case9", "x"])))
        self.assertEqual(sorted(os.listdir(work)), ["case7-copy"])



class StartFieldsTest(unittest.TestCase):
    """The folder of the source case both runs of an A/B test start from."""

    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="md_init_"))
        self.addCleanup(shutil.rmtree, self.tmp)
        self.src = os.path.join(self.tmp, "case")
        os.makedirs(os.path.join(self.src, "0"))

    def stops(self, run):
        """The message the A/B test stops with."""
        with self.assertRaises(SystemExit) as e, contextlib.redirect_stdout(io.StringIO()):
            run()
        return str(e.exception.code)

    def test_a_solution_you_already_have_else_the_case_s_own_0(self):
        self.assertEqual(abtest.start_fields(self.src), "0")
        os.makedirs(os.path.join(self.src, "0.warm"))
        self.assertEqual(abtest.start_fields(self.src), "0.warm")

    def test_init_as_given(self):
        os.makedirs(os.path.join(self.src, "0.warm"))
        self.assertEqual(abtest.start_fields(self.src, "0"), "0")

    def test_no_such_folder_stops_with_a_plain_message_before_anything_is_made(self):
        self.assertEqual(self.stops(lambda: abtest.start_fields(self.src, "0.cold")),
                         f"no start fields: {self.src} has no 0.cold/ folder. Pass --init with the folder both runs "
                         "should start from.")
        os.rmdir(os.path.join(self.src, "0"))
        work = os.path.join(self.tmp, "work")
        with mock.patch.object(abtest, "ROOT", work):
            said = self.stops(lambda: abtest.main([self.src, "x", "--no-ram-check"]))
        self.assertIn(f"{self.src} has no 0/ folder", said)
        self.assertFalse(os.path.exists(work))



class AbCopyTest(unittest.TestCase):
    """The A/B test's copies of a case: a case run in serial gets a decomposeParDict, in the copies only."""

    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="md_abcopy_"))
        self.addCleanup(shutil.rmtree, self.tmp)
        self.src = os.path.join(self.tmp, "case")
        for d in ("system", os.path.join("constant", "polyMesh"), "0"):
            os.makedirs(os.path.join(self.src, d))
        with open(os.path.join(self.src, "system", "controlDict"), "w") as f:
            f.write("application foamRun;")

    def copy(self, tag):
        """The decomposeParDict of the copy made as tag."""
        dst = os.path.join(self.tmp, tag)
        abtest.make_case(self.src, dst, "0")
        with open(os.path.join(dst, "system", "decomposeParDict")) as f:
            return f.read()

    def test_a_case_run_in_serial_gets_a_scotch_decomposition_in_the_copies_only(self):
        text = self.copy("base")
        self.assertIn("object      decomposeParDict;", text)
        self.assertIn("decomposer      scotch;", text)
        self.assertFalse(os.path.exists(os.path.join(self.src, "system", "decomposeParDict")))

    def test_a_case_s_own_decomposition_is_kept(self):
        with open(os.path.join(self.src, "system", "decomposeParDict"), "w") as f:
            f.write("numberOfSubdomains 6; decomposer hierarchical;")
        self.assertEqual(self.copy("fixed"), "numberOfSubdomains 6; decomposer hierarchical;")


class AbFollowUpTest(unittest.TestCase):
    """The A/B test that ab extend and ab hotspots work on: its folder, or the repaired run's name, from any folder."""

    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp(prefix="md_abdir_"))
        self.addCleanup(shutil.rmtree, self.tmp)
        self.work = os.path.join(self.tmp, "work")
        self.top = os.path.join(self.work, "wing-fix_ab")
        for t in ("0", "200"):
            os.makedirs(os.path.join(self.top, "fixed", "processor0", t))
        self.result({"iters": 200, "nProcs": 2, "fixed": {"residuals": {}}})
        self.here = os.path.join(self.tmp, "here")
        os.makedirs(self.here)
        cwd = os.getcwd()
        os.chdir(self.here)
        self.addCleanup(os.chdir, cwd)
        root = mock.patch.object(abtest, "ROOT", self.work)
        root.start()
        self.addCleanup(root.stop)

    def result(self, doc):
        abtest.schema.write(os.path.join(self.top, "ab_result.json"), doc, "abtest")

    def stops(self, run):
        """The message the command stops with."""
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as e:
                run()
        return str(e.exception.code)

    def test_the_repaired_run_s_name_from_any_folder(self):
        for arg in ("wing-fix", "wing-fix_ab"):
            with contextlib.redirect_stderr(io.StringIO()) as said:
                self.assertEqual(abtest.ab_dir(arg), self.top)
            self.assertEqual(said.getvalue(), f"using the A/B test wing-fix_ab in {self.work}\n")   # which one

    def test_a_folder_as_given(self):
        self.assertEqual(abtest.ab_dir(self.top), self.top)
        os.chdir(self.work)
        with contextlib.redirect_stderr(io.StringIO()) as said:
            self.assertEqual(abtest.ab_dir("wing-fix_ab"), self.top)
        self.assertEqual(said.getvalue(), "")                           # from where you are: nothing to say

    def test_in_the_workspace_the_name_still_means_the_test_not_the_repaired_copy(self):
        os.makedirs(os.path.join(self.work, "wing-fix", "constant"))
        os.chdir(self.work)
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(abtest.ab_dir("wing-fix"), self.top)

    def test_no_such_test_stops_with_a_plain_message_before_anything_runs(self):
        for arg in ("wing", "../wing-fix_ab", "sub/wing-fix"):
            self.assertIn(f"no A/B test result for {arg!r}: it is not an A/B test's folder here, nor a repaired run "
                          f"whose A/B test is in the workspace {self.work}", self.stops(lambda: abtest.ab_dir(arg)))
        for cmd in (["extend", "wing", "400"], ["hotspots", "wing"]):    # before the RAM check, or any run
            self.assertIn("no A/B test result for 'wing'", self.stops(lambda: abtest.main(cmd)))

    def test_extend_needs_a_whole_iteration_past_the_run_s_own(self):
        said = ("extend to which iteration? The repaired run is at iteration 200: give a whole number past it, "
                "e.g. meshdoctor ab extend wing-fix 400")
        for end in (["200"], ["100"], [], ["300.5"], ["more"]):
            self.assertEqual(self.stops(lambda: abtest.main(["extend", "wing-fix"] + end)), said)

    def test_extend_stops_on_a_test_that_has_not_finished_or_kept_no_fields(self):
        self.result({"iters": 200, "nProcs": 2})                            # its repaired run is still going
        self.assertEqual(self.stops(lambda: abtest.main(["extend", "wing-fix", "400"])),
                         f"the A/B test in {self.top} has not finished its repaired run yet: let it finish, then "
                         "extend it")
        self.result({"iters": 200, "nProcs": 2, "fixed": {"residuals": {}}})
        shutil.rmtree(os.path.join(self.top, "fixed", "processor0"))
        self.assertEqual(self.stops(lambda: abtest.main(["extend", "wing-fix", "400"])),
                         f"the repaired run in {self.top} has no decomposed fields (processor0/) to continue from")

    def test_extend_continues_the_named_test_to_that_iteration(self):
        calls = []

        def extend(top, end, variant=None):
            calls.append((top, end, variant))
            return {"fixedJudge": {}}
        with mock.patch.object(abtest, "extend", extend):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                abtest.main(["extend", "wing-fix", "400", "--no-ram-check"])
        self.assertEqual(calls, [(self.top, 400, None)])


def write_steady_run(d, n, p_of, drag_of):
    """A synthetic steady run in folder d: log.foamRun with p residuals, a forces file."""
    os.makedirs(os.path.join(d, "0"), exist_ok=True)
    with open(os.path.join(d, "0", "U"), "w") as f:
        f.write("internalField uniform (20 0 0);\nboundaryField\n{\n}\n")
    with open(os.path.join(d, "log.foamRun"), "w") as f:
        for t in range(1, n + 1):
            f.write(f"Time = {t}s\n\nGAMG:  Solving for p, Initial residual = {p_of(t)}, Final residual = 1e-9, "
                    "No Iterations 3\n\n")
    os.makedirs(os.path.join(d, "postProcessing", "body", "0"), exist_ok=True)
    with open(os.path.join(d, "postProcessing", "body", "0", "forces.dat"), "w") as f:
        for t in range(1, n + 1):
            f.write(f"{t} (({drag_of(t)} 0 -30) (0 0 0))\n")


class JudgeTest(unittest.TestCase):
    """abtest.judge on a synthetic steady run: log residuals + a forces file."""

    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="judge_test_")
        os.makedirs(os.path.join(self.d, "0"))
        with open(os.path.join(self.d, "0", "U"), "w") as f:
            f.write("internalField uniform (20 0 0);\nboundaryField\n{\n}\n")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def write_run(self, n, p_of, drag_of, d=None):
        write_steady_run(d or self.d, n, p_of, drag_of)

    def test_converged(self):
        self.write_run(600, lambda t: 1e-3 * math.exp(-t / 40) + 1e-6, lambda t: 50.0)
        j = abtest.judge(self.d, window=200)
        self.assertTrue(j["verdict"].startswith("converged"), j["verdict"])
        self.assertEqual(j["axes"]["vertical"], "downforce")
        import schema
        self.assertEqual(schema.validate(j, "judge"), [])
        self.assertAlmostEqual(j["average"]["drag"]["mean"], 50.0)

    def test_oscillating_plateau(self):
        self.write_run(600, lambda t: 5e-3, lambda t: 50 + 5 * math.sin(t / 15))
        j = abtest.judge(self.d, window=200)
        self.assertTrue(j["verdict"].startswith("not converged"), j["verdict"])

    def test_to_judges_the_run_as_it_was(self):
        # settled until 300, then a settings change sets it oscillating
        self.write_run(600, lambda t: 1e-3 * math.exp(-t / 30) + 1e-6 if t <= 300 else 5e-3,
                       lambda t: 50.0 if t <= 300 else 50 + 5 * math.sin(t / 15))
        whole, early = abtest.judge(self.d, window=100), abtest.judge(self.d, window=100, to=300)
        self.assertTrue(whole["verdict"].startswith("not converged"), whole["verdict"])
        self.assertTrue(early["verdict"].startswith("converged"), early["verdict"])
        self.assertEqual((early["to"], "to" in whole), (300, False))
        self.assertAlmostEqual(early["average"]["drag"]["mean"], 50.0)
        self.assertEqual(early["average"]["drag"]["to"], 300)
        import schema
        self.assertEqual(schema.validate(early, "judge"), [])
        self.assertEqual(early["schemaVersion"], "1.1")

    def test_auto_window(self):
        self.write_run(600, lambda t: 1e-5, lambda t: 50.0)
        self.assertEqual(abtest.judge(self.d, window=None)["window"], 200)
        self.assertEqual(abtest.judge(self.d, window=None, to=240)["window"], 120)
        self.assertEqual(abtest.judge(self.d, window=None, to=12)["window"], 10)
        self.assertEqual(abtest.judge(self.d, window=None, to=12)["verdict"], "too short")
        self.assertEqual(abtest.upto({"Time": [1, 2, 3], "p": [9, 8, 7]}, 2.5), {"Time": [1, 2], "p": [9, 8]})


def write_transient_run(d, n, p_last, co_max, drag_of, bounding=False, log="log.pimple"):
    """A synthetic PIMPLE run in folder d: 2 outer iterations per step, Courant lines, forces."""
    dt = 1e-3
    with open(os.path.join(d, log), "w") as f:
        for i in range(1, n + 1):
            f.write(f"Courant Number mean: 0.05 max: {co_max}\nTime = {i * dt:g}s\n\n")
            for k, p in ((1, 1e-2), (2, p_last)):
                f.write(f"PIMPLE: Iteration {k}\nGAMG:  Solving for p, Initial residual = {p}, "
                        "Final residual = 1e-7, No Iterations 5\n")
            if bounding:
                f.write("bounding k, min: -0.1 max: 2 average: 0.5\n")
    os.makedirs(os.path.join(d, "postProcessing", "body", "0"), exist_ok=True)
    with open(os.path.join(d, "postProcessing", "body", "0", "forces.dat"), "w") as f:
        for i in range(1, n + 1):
            f.write(f"{i * dt:g} (({drag_of(i)} 0 -30) (0 0 0))\n")


class TransientJudgeTest(unittest.TestCase):
    """abtest.judge on a synthetic transient (PIMPLE) run."""

    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="tjudge_test_")
        for sub in ("0", "system"):
            os.makedirs(os.path.join(self.d, sub))
        with open(os.path.join(self.d, "0", "U"), "w") as f:
            f.write("internalField uniform (20 0 0);\nboundaryField\n{\n}\n")
        with open(os.path.join(self.d, "system", "fvSchemes"), "w") as f:
            f.write("ddtSchemes\n{\n    default backward;\n}\n")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def write_run(self, n, p_last, co_max, drag_of, bounding=False):
        write_transient_run(self.d, n, p_last, co_max, drag_of, bounding)

    def judge(self):
        import caseinfo
        return abtest.judge(self.d, window=200, logs=caseinfo.solver_logs(self.d, ("log.pimple",)))

    def test_stationary_and_clean(self):
        self.write_run(600, 1e-5, 0.8, lambda i: 50 + 3 * math.sin(i / 7))   # shedding, steady mean
        j = self.judge()
        self.assertTrue(j["verdict"].startswith("converged"), j["verdict"])
        self.assertEqual(j["steps"]["converged"], 1.0)
        self.assertEqual(j["steps"]["outerIterations"], 2)
        self.assertAlmostEqual(j["average"]["drag"]["mean"], 50, delta=0.5)
        self.assertAlmostEqual(j["average"]["drag"]["from"], 0.2, places=6)  # 2 windows of steps, in seconds
        import schema
        self.assertEqual(schema.validate(j, "judge"), [])
        self.assertTrue(j["transient"])

    def test_flags_unconverged_steps_courant_and_bounding(self):
        self.write_run(600, 5e-3, 12, lambda i: 50 + 3 * math.sin(i / 7), bounding=True)
        j = self.judge()
        self.assertTrue(j["verdict"].startswith("statistically stationary, but check"), j["verdict"])
        self.assertEqual(j["steps"]["converged"], 0.0)
        self.assertEqual(j["steps"]["boundedFields"], ["k"])
        self.assertEqual(len(j["flags"]), 3)
        import schema
        self.assertEqual(schema.validate(j, "judge"), [])

    def test_drifting_mean(self):
        self.write_run(600, 1e-5, 0.8, lambda i: 50 + i / 10)
        self.assertTrue(self.judge()["verdict"].startswith("still developing"))


def write_field(path, values, ncomp=1, binary=True, gz=False):
    """An OpenFOAM vol field file with a nonuniform internalField (values flat: x0 y0 z0 x1 ...)."""
    import array, gzip
    typ, n = ("scalar" if ncomp == 1 else "vector"), len(values) // ncomp
    head = ("FoamFile\n{\n    format      %s;\n    arch        \"LSB;label=32;scalar=64\";\n"
            "    class       vol%sField;\n    object      f;\n}\ndimensions      [];\n\n"
            "internalField   nonuniform List<%s> \n%d\n(" % ("binary" if binary else "ascii", typ.capitalize(), typ, n)).encode()
    if binary:
        body = array.array("d", values).tobytes()
    else:
        rows = [" ".join(repr(float(x)) for x in values[i * ncomp:(i + 1) * ncomp]) for i in range(n)]
        body = ("\n" + "\n".join(r if ncomp == 1 else f"({r})" for r in rows) + "\n").encode()
    data = head + body + b")\n;\n\nboundaryField\n{\n}\n"
    with (gzip.open(path + ".gz", "wb") if gz else open(path, "wb")) as f:
        f.write(data)


class TransientPlanTest(unittest.TestCase):
    """tplan: field reading, the shadow case, and the plan, with OpenFOAM stubbed out."""

    def setUp(self):
        import tplan
        self.tp = tplan
        self.d = tempfile.mkdtemp(prefix="tplan_test_")
        self.case = os.path.join(self.d, "steady")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def test_read_internal(self):
        vals = [0.5, 1e-9, 3.25, -2.0, 7.0, 8.0]
        for kw in ({}, {"binary": False}, {"gz": True}, {"binary": False, "gz": True}):
            for ncomp in (1, 3):
                f = os.path.join(self.d, f"f{ncomp}_{len(kw)}_{kw.get('binary', 1)}")
                write_field(f, vals, ncomp, **kw)
                got = self.tp.read_internal(f + (".gz" if kw.get("gz") else ""))
                self.assertEqual(list(got), vals, (kw, ncomp))
        with open(os.path.join(self.d, "uniform"), "w") as f:
            f.write("internalField   uniform 0;\n")
        with self.assertRaises(ValueError):
            self.tp.read_internal(os.path.join(self.d, "uniform"))

    def make_case(self, nproc=2, t="300", cells=500):
        for sub in ("system", "constant", "0"):
            os.makedirs(os.path.join(self.case, sub), exist_ok=True)
        with open(os.path.join(self.case, "system", "controlDict"), "w") as f:
            f.write("deltaT          1;\n")
        with open(os.path.join(self.case, "system", "forceCoeffs"), "w") as f:
            f.write("forceCoeffs\n{\n    lRef            2;\n    Aref 1;\n}\n")
        with open(os.path.join(self.case, "0", "U"), "w") as f:
            f.write("internalField uniform (20 0 0);\nboundaryField\n{\n}\n")
        with open(os.path.join(self.case, "log.foamRun"), "w") as f:
            for i in range(1, 51):
                f.write(f"Time = {i}s\n\nExecutionTime = {1.9 * i} s  ClockTime = {2 * i} s\n\n")
        for p in range(nproc):
            d = os.path.join(self.case, f"processor{p}")
            os.makedirs(os.path.join(d, "constant", "polyMesh"))
            for tt in ("100", t):
                os.makedirs(os.path.join(d, tt))
                open(os.path.join(d, tt, "phi"), "w").close()
                open(os.path.join(d, tt, "U"), "w").close()
        return [os.path.join(self.case, f"processor{p}") for p in range(nproc)]

    def listing(self):
        return sorted((r, tuple(sorted(fs))) for r, _, fs in os.walk(self.case))

    def test_shadow_links_only_and_keeps_processor_order(self):
        self.make_case(nproc=12)
        self.assertEqual(self.tp.latest_time(self.case), ("300", True))
        before = self.listing()
        into = os.path.join(self.d, "shadow")
        os.makedirs(into)
        roots = self.tp.shadow(self.case, "300", True, into)
        self.assertEqual([os.path.basename(r) for r in roots], [f"processor{p}" for p in range(12)])
        self.assertTrue(os.path.islink(os.path.join(into, "processor10", "300", "phi")))
        self.assertTrue(os.path.islink(os.path.join(into, "processor10", "constant")))
        self.assertFalse(os.path.exists(os.path.join(into, "processor10", "300", "U")))
        open(os.path.join(into, "processor10", "300", "Co"), "w").close()     # what OpenFOAM writes
        self.assertEqual(self.listing(), before)

    def fake_post_process(self, rates_of, seen):
        """Stand-in for foamPostProcess: writes Co, C and Vc in each shadow root."""
        def run(into, t, nproc):
            seen.append((into, nproc))
            roots = [os.path.join(into, f"processor{p}") for p in range(nproc)]
            for p, r in enumerate(roots):
                co, c, v = rates_of(p)
                d = os.path.join(r, t)
                write_field(os.path.join(d, "Co"), co, binary=p % 2 == 0)
                write_field(os.path.join(d, "C"), c, 3)
                write_field(os.path.join(d, "Vc"), v, gz=True)
            log = os.path.join(into, "log.foamPostProcess")
            open(log, "w").close()
            return 0, log
        return run

    def test_plan(self):
        self.make_case(nproc=2)

        def rates_of(p):                  # 250 cells each; 5 fast cells in a cluster on processor 1
            co = [10.0 + (i % 7) for i in range(250)]
            c = [x for i in range(250) for x in (i * 0.1, p * 50.0, 0.0)]
            v = [1e-3] * 250
            if p == 1:
                for k in range(5):
                    co[100 + k] = 1000.0 - k
                    c[3 * (100 + k):3 * (100 + k) + 3] = [5.0 + 0.01 * k, 2.0, 1.0]
                    v[100 + k] = 1e-6
            return co, c, v
        seen, real = [], self.tp.post_process
        self.tp.post_process = self.fake_post_process(rates_of, seen)
        try:
            before = self.listing()
            p = self.tp.plan(self.case, targets=(1.0, 5.0), outer=3, top=5)
        finally:
            self.tp.post_process = real
        self.assertEqual(self.listing(), before)                         # the case is only read
        self.assertFalse(os.path.exists(seen[0][0]))                       # the shadow is removed
        self.assertEqual((p["cells"], p["processors"], p["time"], seen[0][1]), (500, 2, "300", 2))
        d = p["courantPerSecond"]
        self.assertEqual((d["max"], d["withoutTop"], d["median"]), (1000.0, 16.0, 13.0))
        self.assertEqual(p["cellsWithin2x"], 5)
        g = p["regions"][0]
        self.assertEqual(g["nCells"], 5)
        self.assertAlmostEqual(g["h"], 0.01)
        self.assertAlmostEqual(g["centre"][1], 2.0)
        self.assertEqual((p["speed"], p["length"], p["flowTimeSource"]), (20.0, 2.0, "8 L/U"))
        self.assertAlmostEqual(p["flowTime"], 0.8)
        self.assertAlmostEqual(p["secondsPerIteration"], 2.0)
        o = p["options"][0]
        self.assertAlmostEqual(o["deltaT"], 1e-3)
        self.assertAlmostEqual(o["deltaTWithoutTop"], 1 / 16)
        self.assertEqual(o["steps"], 800)
        self.assertAlmostEqual(o["hours"], 800 * 3 * 2.0 / 3600)
        self.assertAlmostEqual(p["options"][1]["deltaT"], 5e-3)
        self.assertEqual(self.schema.validate(p, "tplan"), [])
        self.assertAlmostEqual(o["hoursPerFlowSecond"], 3 * 2.0 / 1e-3 / 3600)
        text = self.tp.summary(p)
        self.assertIn("steady at 300: 500 cells", text)
        self.assertIn("set by 5 cells within 2x of the max", text)
        self.assertIn("800 steps, about 1.3 h at 3 outer iterations per step", text)

    def test_plan_errors(self):
        os.makedirs(os.path.join(self.case, "system"))
        with self.assertRaisesRegex(ValueError, "no time with a flux field"):
            self.tp.plan(self.case)
        self.make_case(nproc=1)
        with self.assertRaisesRegex(ValueError, "no phi at time 7"):
            self.tp.plan(self.case, t="7")
        for bad in ("7; rm -rf x", "../300", "-1", ""):
            with self.assertRaisesRegex(ValueError, "not a time"):
                self.tp.plan(self.case, t=bad)
        seen, real = [], self.tp.post_process

        def failing(into, t, nproc):
            seen.append(into)
            log = os.path.join(into, "log.foamPostProcess")
            with open(log, "w") as f:
                f.write("--> FOAM FATAL ERROR:\ncannot find phi\n")
            return 1, log
        self.tp.post_process = failing
        try:
            with self.assertRaisesRegex(RuntimeError, "exit 1.*cannot find phi"):
                self.tp.plan(self.case)
        finally:
            self.tp.post_process = real
        self.assertFalse(os.path.exists(seen[0]))

    @property
    def schema(self):
        import schema
        return schema


class SchemaTest(unittest.TestCase):
    """schema.py: version rules, the validator, and read/write."""

    def test_versions(self):
        import schema
        self.assertTrue(schema.compatible({}, "repair")[0])                       # legacy, no version
        self.assertTrue(schema.compatible({"schemaVersion": "1.7"}, "repair")[0])  # newer minor: fine
        self.assertFalse(schema.compatible({"schemaVersion": "2.0"}, "repair")[0])  # newer major: refused
        self.assertFalse(schema.compatible({"schemaVersion": "one"}, "repair")[0])

    def test_validator(self):
        import schema
        root = {"type": "object", "required": ["a", "n"],
                "properties": {"a": {"$ref": "#/$defs/pos"}, "n": {"type": ["integer", "null"]},
                               "tags": {"type": "array", "items": {"enum": ["x", "y"]}}},
                "additionalProperties": {"type": "number"}, "$defs": {"pos": {"type": "number", "minimum": 0}}}
        schema._cache["_t"] = root
        self.assertEqual(schema.validate({"a": 1, "n": None, "tags": ["x"], "extra": 2.5}, "_t"), [])
        errs = schema.validate({"a": -1, "n": True, "tags": ["z"], "extra": "s"}, "_t")
        self.assertEqual(len(errs), 4, errs)          # minimum, bool is not integer, enum, additional type
        self.assertIn("$: missing n", schema.validate({"a": 1}, "_t"))

    def test_write_read(self):
        import schema
        d = tempfile.mkdtemp(prefix="schema_test_")
        try:
            p = os.path.join(d, "r.json")
            doc = schema.write(p, {"x": 1}, "map")
            self.assertEqual(list(doc)[0], "schemaVersion")
            self.assertEqual(schema.read(p, "map")["schemaVersion"], schema.VERSIONS["map"])
            schema.write(p, {"schemaVersion": "9.0"})
            with self.assertRaises(schema.SchemaError):
                schema.read(p, "map")
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_every_schema_is_well_formed(self):
        import json, schema
        for kind in schema.VERSIONS:
            s = schema.schema(kind)
            self.assertIn("schemaVersion", s["required"], kind)
            self.assertEqual(s["properties"]["schemaVersion"]["pattern"], r"^%s\.\d+$" % schema.VERSIONS[kind].split(".")[0])
            json.dumps(s)


class BoundaryParserTest(unittest.TestCase):
    TEXT = """FoamFile { format ascii; class polyBoundaryMesh; }
3
(
    inlet { type patch; nFaces 10; startFace 100; }
    motorBike_frt-fairing:001%1
    {
        type            wall;
        inGroups        List<word> 1(motorBikeGroup);
        nFaces          42;
        startFace       110;
    }
    lowerWall { startFace 152; nFaces 7; type wall; }
)
"""

    def test_names_with_any_characters_and_any_order(self):
        try:
            import numpy  # noqa: F401  (a real one is used as it is)
        except ImportError:
            # mapdata imports numpy at the top, though patches() doesn't use it. The stand-in is for this test
            # only: a later test (meshdoctor check) must find numpy missing, as it is.
            sys.modules["numpy"] = type(sys)("numpy")
            self.addCleanup(sys.modules.pop, "mapdata", None)
            self.addCleanup(sys.modules.pop, "numpy", None)
        import mapdata
        self.assertEqual(mapdata.patches(self.TEXT), [
            ("inlet", "patch", 10, 100), ("motorBike_frt-fairing:001%1", "wall", 42, 110),
            ("lowerWall", "wall", 7, 152)])


class ApiV1Test(unittest.TestCase):
    """api_v1: routes, the one error format, request checks and the OpenAPI
    document, on a temporary cases folder and workspace.  Job starts are
    caught before anything is launched."""

    def setUp(self):
        import api_v1, schema
        self.api, self.schema = api_v1, schema
        self.d = tempfile.mkdtemp(prefix="api_test_")
        self.env = {k: os.environ.get(k) for k in ("MESHDOCTOR_CASES", "MESHDOCTOR_WORKSPACE")}
        os.environ["MESHDOCTOR_CASES"] = os.path.join(self.d, "cases")
        os.environ["MESHDOCTOR_WORKSPACE"] = os.path.join(self.d, "work")
        os.makedirs(os.path.join(self.d, "cases", "c1", "constant", "polyMesh"))
        open(os.path.join(self.d, "cases", "c1", "constant", "polyMesh", "owner"), "w").close()
        os.makedirs(os.path.join(self.d, "cases", "c1", "system"))
        open(os.path.join(self.d, "cases", "c1", "system", "controlDict"), "w").close()
        md = os.path.join(self.d, "work", "r1", "meshDoctor")
        os.makedirs(md)
        self.src = os.path.join(self.d, "cases", "c1")
        os.makedirs(os.path.join(self.src, "0"))
        schema.write(os.path.join(md, "result.json"), {"source": self.src, "finished": True}, "repair")
        import jobs
        self.jobs, self.launched = jobs, []
        self.saved = jobs._spawn, jobs.solver_running
        jobs._spawn = lambda argv: self.launched.append(argv) or 2 ** 22 + 7     # no process, no such pid
        jobs.solver_running = lambda: False

    def tearDown(self):
        self.jobs._spawn, self.jobs.solver_running = self.saved
        for k, v in self.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.d, ignore_errors=True)

    def get(self, path, **q):
        return self.api.handle("GET", "/api/v1" + path, {k: str(v) for k, v in q.items()})

    def post(self, path, doc, ctype="application/json"):
        body = doc if isinstance(doc, bytes) else json.dumps(doc).encode()
        return self.api.handle("POST", "/api/v1" + path, {}, body, ctype)

    def assertError(self, answer, status, code, text=""):
        got, doc, _ = answer
        self.assertEqual((got, doc["error"]["code"]), (status, code), doc)
        self.assertEqual(set(doc), {"error"})
        self.assertIn(text, doc["error"]["message"])

    def test_reads(self):
        self.assertEqual(self.get("/cases")[:2], (200, {"items": ["c1"], "cells": {"c1": None}}))   # empty owner
        with open(os.path.join(self.src, "constant", "polyMesh", "owner"), "w") as f:
            f.write("FoamFile\n{\n    note \"nPoints:1200 nCells:1000 nFaces:3400 nInternalFaces:2600\";\n}\n")
        self.assertEqual(self.get("/cases")[1]["cells"], {"c1": 1000})
        st, doc, _ = self.get("/repairs/r1")
        self.assertEqual((st, doc["source"]), (200, self.src))
        self.assertEqual(self.get("/repairs")[1]["items"][0]["name"], "r1")
        self.assertEqual(self.get("/")[1]["schemas"], self.schema.VERSIONS)
        self.assertEqual(self.get("/schemas/judge")[1]["$id"], self.schema.schema("judge")["$id"])
        st, rep, _ = self.get("/repairs/r1/report")
        self.assertEqual((st, rep["kind"], rep["documents"]["repair"]["source"]), (200, "meshdoctor-report", "cases/c1"))
        self.assertError(self.get("/repairs/nope/report"), 404, "not-found")

    def test_abtests_list_and_one_test(self):
        top = os.path.join(self.d, "work", "wing-fix_ab")
        for side in ("base", "fixed"):                 # each run's residuals function object
            rd = os.path.join(top, side, "postProcessing", "residuals", "0")
            os.makedirs(rd)
            with open(os.path.join(rd, "residuals.dat"), "w") as f:
                f.write("# Residuals\n# Time p Ux\n" + "".join(f"{t} {0.01 / t} N/A\n" for t in range(1, 6)))
        os.makedirs(os.path.join(top, "fixed", "meshDoctor"))          # a slow-oscillation map
        with open(os.path.join(top, "fixed", "meshDoctor", "mode_300_600.json"), "w") as f:
            json.dump({"from": "300", "to": "600", "summary": {"rmsDp": 1.5}, "shareOfTopChangeNearMeshDefects": 0.25,
                       "clusters": [{"sumScore2": 3.0, "nCells": 12, "centroid": [0.1, 0, 0.2], "h": 0.004,
                                     "maxNonOrtho": 71.0},
                                    {"sumScore2": 1.0, "nCells": 4, "centroid": [0.3, 0, 0.2]}]}, f)
        hist = {"Time": [1, 2], "p": [0.1, 0.05]}
        self.schema.write(os.path.join(top, "ab_result.json"), {
            "source": self.src, "label": "wing-fix", "iters": 5, "nProcs": 1, "init": "0", "window": 2,
            "started": "2026-11-23 10:00:00", "finished": "2026-11-23 10:05:00",
            "base": {"iterations": 5, "residualHistory": hist}, "fixed": {"iterations": 5, "residualHistory": hist},
            "fixedFull": {"residualHistory": hist}, "residualRatioFixedOverBase": {"p": 0.5, "Ux": None},
            "fixedJudge": {"verdict": "converged"}}, "abtest")
        with open(os.path.join(top, "ab_status.json"), "w") as f:
            json.dump({"step": "done", "time": "2026-11-23 10:05:01"}, f)
        duct = os.path.join(self.d, "work", "duct-fix_ab")          # still solving its first run: no result yet
        os.makedirs(duct)
        with open(os.path.join(duct, "ab_status.json"), "w") as f:
            json.dump({"step": "solving base", "time": "2026-11-23 11:00:00", "case": duct + "/base"}, f)

        st, doc, _ = self.get("/abtests")
        self.assertEqual(st, 200, doc)
        op = self.api.openapi()["paths"]["/abtests"]["get"]["responses"]["200"]["content"]["application/json"]
        self.assertEqual(self.schema.check(doc, op["schema"]), [])
        self.assertEqual(doc["items"], ["duct-fix", "wing-fix"])
        self.assertEqual(doc["tests"], {
            "duct-fix": {"step": "solving base", "updated": "2026-11-23 11:00:00", "finished": None, "ratios": {},
                         "verdict": None},
            "wing-fix": {"step": "done", "updated": "2026-11-23 10:05:01", "finished": "2026-11-23 10:05:00",
                         "ratios": {"p": 0.5}, "verdict": "converged"}})

        st, one, _ = self.get("/abtests/wing-fix")
        self.assertEqual(st, 200, one)
        self.assertEqual(self.schema.check(one, self.api.ABTEST), [])
        self.assertEqual(self.schema.validate(one["result"], "abtest"), [])
        self.assertNotIn("residualHistory", one["result"]["base"])        # live has the residuals instead
        self.assertNotIn("fixedFull", one["result"])
        rows = [[float(t), 0.01 / t, None] for t in range(1, 6)]
        self.assertEqual(one["live"], {"base": {"cols": ["Time", "p", "Ux"], "rows": rows},
                                       "fixed": {"cols": ["Time", "p", "Ux"], "rows": rows}})
        self.assertEqual(one["modes"], [{"from": "300", "to": "600", "summary": {"rmsDp": 1.5}, "nearDefects": 0.25,
                                         "top": [{"share": 0.75, "nCells": 12, "centroid": [0.1, 0, 0.2], "h": 0.004,
                                                  "maxNonOrtho": 71.0},
                                                 {"share": 0.25, "nCells": 4, "centroid": [0.3, 0, 0.2], "h": None,
                                                  "maxNonOrtho": None}]}])
        st, two, _ = self.get("/abtests/duct-fix")
        self.assertEqual((st, two["result"], two["live"], two["modes"]), (200, None, {"base": None, "fixed": None}, []))
        self.assertEqual(self.schema.check(two, self.api.ABTEST), [])
        self.assertError(self.get("/abtests/none"), 404, "not-found", "no A/B test none")
        paths = self.api.openapi()["paths"]
        self.assertIs(paths["/abtests/{name}"]["get"]["responses"]["200"]["content"]["application/json"]["schema"],
                      self.api.ABTEST)

    def test_abtest_live_answer(self):
        saved = dict(self.api._live)
        import server
        self.api.provide(abtest_live=server.run_status)
        self.addCleanup(lambda: (self.api._live.clear(), self.api._live.update(saved)))
        top = os.path.join(self.d, "work", "wing-fix_ab")
        for side in ("base", "fixed"):
            case = os.path.join(top, side)
            os.makedirs(os.path.join(case, "system"))
            with open(os.path.join(case, "system", "controlDict"), "w") as f:
                f.write("endTime 300;\n")
            write_steady_run(case, 120, lambda t: 1e-3 / t, lambda t: 50.0)
        self.schema.write(os.path.join(top, "ab_result.json"), {
            "source": self.src, "label": "wing-fix", "iters": 300, "nProcs": 1, "init": "0", "window": 50,
            "started": "2026-11-23 10:00:00"}, "abtest")
        with open(os.path.join(top, "ab_status.json"), "w") as f:
            json.dump({"step": "solving fixed", "time": "2026-11-23 10:02:00"}, f)
        st, doc, _ = self.get("/abtests/wing-fix/live")
        self.assertEqual(st, 200, doc)
        self.assertEqual(self.schema.check(doc, self.api.LIVE), [])
        solver = doc["solver"]
        self.assertEqual((doc["label"], solver["state"], solver["iteration"], solver["end"]),
                         ("wing-fix", "running", 120.0, 300.0))
        self.assertEqual(doc["stages"], [{"name": "Repaired mesh run", "from": 0, "to": 300}])
        self.assertEqual((doc["residuals"]["cols"], len(doc["residuals"]["rows"])), (["Time", "p"], 120))
        self.assertIn("verdict", doc["judge"])
        st, active, _ = self.get("/live/abtest")                  # the test running now
        self.assertEqual((st, active["label"]), (200, "wing-fix"))
        self.assertEqual(self.schema.check(active, self.api.LIVE), [])

    def test_a_cluster_as_the_repair_writes_it(self):
        # foamMeshDoctor's text files for one failing face (7, between cells 3 and 4) and a wall nearby, through
        # repair.cluster, then the route: its answer must match the shape the OpenAPI document gives the app.
        import repair
        run = os.path.join(self.d, "work", "r1")
        tagged = os.path.join(run, "meshDoctor", "before")
        os.makedirs(tagged)
        quad = lambda z: f"4 0 0 {z} 0.01 0 {z} 0.01 0.01 {z} 0 0.01 {z}"
        with open(os.path.join(tagged, "badFaces.txt"), "w") as f:
            f.write("B 7 internal 1.08 70 0.5 0.4 0.5 0.9 0 0 0 0.01 3 4\n")
        with open(os.path.join(tagged, "badCells.txt"), "w") as f:
            f.write(f"F 3 7 1.08 {quad(0)}\nF 3 8 0.2 {quad(0.01)}\nF 4 7 1.08 {quad(0)}\n"
                    "F 4 9 0.85 3 0 0 0 0.01 0 -0.01 0 0.01 -0.01\n")
        with open(os.path.join(tagged, "context.txt"), "w") as f:
            f.write(f"W 100 body {quad(0.02)}\nW 101 inlet {quad(5)}\n")              # the inlet is far away
        found = repair.cluster(run, "before", repair.PROFILES["openfoam"])
        self.assertEqual([(c["id"], c["kinds"], c["nFaces"]) for c in found], [(0, ["non-orthogonal"], 1)])
        st, doc, _ = self.get("/repairs/r1/clusters/0", tag="before")
        self.assertEqual(st, 200, doc)
        self.assertEqual(self.schema.check(doc, self.api.CLUSTER), [])
        self.assertEqual([(c["cell"], c["face"], c["hot"], len(c["xyz"])) for c in doc["cells"]],
                         [(3, 7, True, 12), (3, 8, False, 12), (4, 7, True, 12), (4, 9, False, 9)])
        self.assertEqual([(w["patch"], w["xyz"][2]) for w in doc["ctx"]], [("body", 0.02)])
        op = self.api.openapi()["paths"]["/repairs/{name}/clusters/{id}"]["get"]
        self.assertIs(op["responses"]["200"]["content"]["application/json"]["schema"], self.api.CLUSTER)
        self.assertError(self.get("/repairs/r1/clusters/1", tag="before"), 404, "not-found", "cluster 1 (before)")
        self.assertError(self.get("/repairs/r1/clusters/0", tag="after"), 404, "not-found")

    def test_errors(self):
        self.assertError(self.get("/repairs/nope"), 404, "not-found")
        self.assertError(self.get("/repairs/.hidden"), 400, "bad-request", "bad name")
        self.assertError(self.get("/nowhere"), 404, "not-found")
        self.assertError(self.get("/openapiXjson"), 404, "not-found")            # literal dots in routes
        self.assertError(self.get("/schemas/secret"), 404, "not-found")
        st, doc, headers = self.post("/cases", {})
        self.assertEqual((st, headers), (405, {"Allow": "GET"}))
        self.assertError(self.get("/repairs/r1/clusters/x"), 400, "bad-request")
        self.assertError(self.get("/repairs/r1/clusters/1", tag="bogus"), 400, "bad-request", "tag")
        self.assertError(self.get("/judge"), 400, "bad-request", "missing query parameter case")
        self.assertError(self.get("/judge", case="c1", window="abc"), 400, "bad-request", "integer")
        self.assertError(self.get("/judge", case="c1", window=5), 400, "bad-request", "5 < 10")
        self.assertError(self.get("/judge", case="c9"), 404, "not-found")
        self.assertError(self.get("/judge", case="work"), 404, "not-found")            # not a case folder
        self.assertError(self.get("/judge", case="c1", log="../x"), 400, "bad-request")  # log names only
        self.assertError(self.get("/judge", case="c1", log="log.none"), 404, "not-found", "no log matches")
        self.assertError(self.get("/live"), 503, "unavailable")                   # no live monitor in tests
        self.assertError(self.get("/judge", case="c1", avgFrom="nan"), 400, "bad-request", "finite")
        self.assertError(self.get("/judge", case="c1", avgFrom="inf"), 400, "bad-request", "finite")

    def test_abtest_judge_each_side(self):
        top = os.path.join(self.d, "work", "ab1_ab")
        settles = lambda t: 1e-3 * math.exp(-t / 30) + 1e-6
        for side, p_of, osc in (("base", lambda t: 5e-3, 5), ("fixed", settles, 0)):   # only the repaired mesh settles
            case = os.path.join(top, side)
            os.makedirs(os.path.join(case, "system"))
            open(os.path.join(case, "system", "controlDict"), "w").close()
            write_steady_run(case, 400, p_of, lambda t, a=osc: 50 + a * math.sin(t / 15))
        st, base, _ = self.get("/abtests/ab1/judge", side="base")
        self.assertEqual(st, 200, base)
        self.assertTrue(base["verdict"].startswith("not converged"), base["verdict"])
        self.assertEqual(base["window"], 200)                                     # half the run
        st, fixed, _ = self.get("/abtests/ab1/judge", side="fixed", to=300, window=100)
        self.assertTrue(fixed["verdict"].startswith("converged"), fixed["verdict"])
        self.assertEqual((fixed["to"], fixed["window"]), (300, 100))
        self.assertEqual(self.schema.validate(fixed, "judge"), [])
        # the hotspot run's log (written last) is not part of the test: here it would put p at 1 everywhere
        with open(os.path.join(top, "fixed", "log.foamRun_hot"), "w") as f:
            f.writelines(f"Time = {t}s\n\nGAMG:  Solving for p, Initial residual = 1, Final residual = 1e-9, "
                         "No Iterations 3\n\n" for t in range(1, 401))
        st, whole, _ = self.get("/abtests/ab1/judge", side="fixed")
        self.assertLess(whole["residuals"]["p"]["median"], 1e-4, whole["residuals"])
        self.assertError(self.get("/abtests/ab1/judge"), 400, "bad-request", "missing query parameter side")
        self.assertError(self.get("/abtests/ab1/judge", side="both"), 400, "bad-request", "side")
        self.assertError(self.get("/abtests/ab1/judge", side="fixed", to="-1"), 400, "bad-request")
        self.assertError(self.get("/abtests/ab1/judge", side="fixed", to="nan"), 400, "bad-request", "finite")
        self.assertError(self.get("/abtests/ab2/judge", side="base"), 404, "not-found", "no base run")
        self.assertError(self.get("/abtests/.x/judge", side="base"), 400, "bad-request")
        self.assertEqual((base["run"], fixed["run"]), ("ab1_ab/base", "ab1_ab/fixed"))
        # a test made with --base-from reused ab1's original-mesh run: its base is judged there
        top2 = os.path.join(self.d, "work", "ab2_ab")
        os.makedirs(os.path.join(top2, "base", "postProcessing"))
        reuse = lambda prev: self.schema.write(os.path.join(top2, "ab_result.json"), {"baseReusedFrom": prev}, "abtest")
        reuse(top)
        st, b2, _ = self.get("/abtests/ab2/judge", side="base")
        self.assertEqual((st, b2["run"], b2["verdict"]), (200, "ab1_ab/base", base["verdict"]))
        self.assertError(self.get("/abtests/ab2/judge", side="fixed"), 404, "not-found")   # nothing reused there
        for bad in ("/etc", os.path.join(self.d, "elsewhere", "ab1_ab", "..", "..", "x_ab"), top2, 42):
            reuse(bad)                                                # only a sibling test folder, by name
            self.assertError(self.get("/abtests/ab2/judge", side="base"), 404, "not-found")
        shutil.rmtree(os.path.join(top, "base", "system"))
        self.assertError(self.get("/abtests/ab1/judge", side="base"), 404, "not-found")   # not a case folder

    def test_live_abtest_is_the_active_test(self):
        saved = dict(self.api._live)
        try:
            self.api._live.clear()
            self.assertError(self.get("/live/abtest"), 503, "unavailable")
            asked = []
            self.api.provide(abtest_live=lambda n: asked.append(n) or {"error": "no A/B run found"})
            self.assertError(self.get("/live/abtest"), 404, "not-found")
            self.assertEqual(asked, [""])                                   # the server picks the test
            self.api.provide(abtest_live=lambda n: {"label": n or "r1", "labels": ["r1"]})
            self.assertEqual(self.get("/live/abtest")[:2], (200, {"label": "r1", "labels": ["r1"]}))
        finally:
            self.api._live.clear()
            self.api._live.update(saved)

    def test_live_judge(self):
        saved, calls = dict(self.api._live), []
        import abtest
        real = abtest.judge
        try:
            self.api._live.clear()
            self.assertError(self.get("/live/judge"), 503, "unavailable")
            self.api.provide(live_case=lambda: "")
            self.assertError(self.get("/live/judge"), 404, "not-found", "no live case")
            case = os.path.join(self.d, "live")
            for sub in ("0", "system"):
                os.makedirs(os.path.join(case, sub))
            open(os.path.join(case, "system", "controlDict"), "w").close()
            with open(os.path.join(case, "0", "U"), "w") as f:
                f.write("internalField uniform (20 0 0);\nboundaryField\n{\n}\n")
            with open(os.path.join(case, "system", "fvSchemes"), "w") as f:
                f.write("ddtSchemes\n{\n    default backward;\n}\n")
            self.api.provide(live_case=lambda: case)
            self.assertError(self.get("/live/judge"), 404, "not-found", "no solver log")
            # a steady start, then the transient stage: only the transient log is judged
            write_steady_run(case, 50, lambda t: 1e-1, lambda t: 500.0)
            write_transient_run(case, 600, 5e-3, 12, lambda i: 50 + 3 * math.sin(i / 7), log="log.ddes")
            abtest.judge = lambda *a, **k: calls.append(k) or real(*a, **k)
            st, j, _ = self.get("/live/judge", avgFrom=0.3)
            self.assertEqual(st, 200, j)
            self.assertTrue(j["transient"])
            self.assertTrue(j["verdict"].startswith("statistically stationary, but check"), j["verdict"])
            self.assertEqual((j["window"], j["steps"]["converged"], j["steps"]["outerIterations"]), (200, 0.0, 2))
            self.assertAlmostEqual(j["average"]["drag"]["from"], 0.3)
            self.assertEqual(self.schema.validate(j, "judge"), [])
            self.assertEqual(self.get("/live/judge", avgFrom=0.3)[1], j)        # same logs: the cached answer
            self.assertEqual(len(calls), 1)
            self.assertEqual([os.path.basename(f) for f in calls[0]["logs"]], ["log.ddes"])
            with open(os.path.join(case, "log.ddes"), "a") as f:               # the log grows: judged again
                f.write("Courant Number mean: 0.05 max: 12\nTime = 0.601s\n\n")
            self.get("/live/judge", avgFrom=0.3)
            self.assertEqual(len(calls), 2)
            self.assertError(self.get("/live/judge", window=5), 400, "bad-request")
        finally:
            abtest.judge = real
            self.api._live_judged.clear()
            self.api._live.clear()
            self.api._live.update(saved)

    def test_newer_result_file_is_refused_without_paths(self):
        p = os.path.join(self.d, "work", "r1", "meshDoctor", "result.json")
        self.schema.write(p, {"schemaVersion": "2.0"})
        self.assertError(self.get("/repairs/r1"), 409, "schema-version", "update Mesh Doctor")
        self.assertNotIn(self.d, self.get("/repairs/r1")[1]["error"]["message"])

    def test_job_requests_are_checked(self):
        repair = {"kind": "repair", "params": {"source": "c1", "name": "r2"}}
        self.assertError(self.post("/jobs", repair, "text/plain"), 415, "unsupported-media-type")
        self.assertError(self.post("/jobs", b"{nope"), 400, "bad-request", "not valid JSON")
        self.assertError(self.post("/jobs", b"x" * (self.api.MAX_BODY + 1)), 413, "too-large")
        self.assertError(self.post("/jobs", {"kind": "rm"}), 400, "bad-request", "kind")
        self.assertError(self.post("/jobs", {"kind": "repair", "params": {"name": "r2"}}), 400, "bad-request",
                         "missing source")
        self.assertError(self.post("/jobs", {"kind": "repair", "params": {"source": "c1", "name": "r2", "x": 1}}),
                         400, "bad-request", "unexpected x")
        self.assertError(self.post("/jobs", {"kind": "repair", "params": {"source": "c1", "name": ".."}}),
                         400, "bad-request")
        self.assertError(self.post("/jobs", {"kind": "abtest", "params": {"name": "r1", "iters": "many"}}),
                         400, "bad-request", "integer")
        self.assertError(self.post("/jobs", {"kind": "abextend", "params": {"name": "r1"}}), 400, "bad-request",
                         "missing to")
        self.assertError(self.post("/jobs", {"kind": "repair", "params": {"source": "c9", "name": "r2"}}),
                         404, "not-found")
        self.assertError(self.post("/jobs", {"kind": "repair", "params": {"source": "c1", "name": "r1"}}),
                         409, "exists")                                          # never deletes a run unasked
        self.jobs.solver_running = lambda: True
        self.assertError(self.post("/jobs", repair), 409, "busy")
        self.assertEqual(self.launched, [])

    def test_job_start_and_follow(self):
        st, doc, _ = self.post("/jobs", {"kind": "repair", "params": {"source": "c1", "name": "r2"}})
        self.assertEqual((st, doc["kind"], doc["name"], doc["state"]), (202, "repair", "r2", "queued"))
        self.assertEqual(self.schema.validate(doc, "job"), [])
        self.assertEqual(doc["links"]["self"], "/api/v1/jobs/" + doc["id"])
        self.assertEqual(doc["links"]["repair"], "/api/v1/repairs/r2")
        self.assertEqual(doc["log"], "r2.log")                         # workspace-relative
        argv = self.launched[0]
        self.assertTrue(argv[1].endswith("jobrun.py"), argv)
        cmd = argv[argv.index("--") + 1:]                              # an argument list, no shell
        self.assertEqual(cmd[2:], ["full", self.src, "r2", "--profile", "openfoam"])
        self.assertEqual(self.get("/jobs")[1]["items"][0]["id"], doc["id"])
        self.assertEqual(self.get("/jobs/" + doc["id"])[1]["state"], "queued")
        self.assertError(self.post("/jobs", {"kind": "repair", "params": {"source": "c1", "name": "r3"}}),
                         409, "busy", doc["id"])                       # one big job at a time, from the job files
        self.assertError(self.get("/jobs/no;such"), 400, "bad-request")
        self.assertError(self.get("/jobs/20260101-000000-repair-x-abcd"), 404, "not-found")

    def test_variant_reuses_an_earlier_original_mesh_run(self):
        ab = os.path.join(self.d, "work", "r1_ab")
        os.makedirs(ab)
        self.schema.write(os.path.join(ab, "ab_result.json"),
                          {"source": self.src, "iters": 200, "init": "0", "base": {"forces": {}}}, "abtest")
        st, doc, _ = self.post("/jobs", {"kind": "abtest", "params": {"name": "r1", "init": "0", "variant": "simplec"}})
        self.assertEqual((st, doc["name"]), (202, "c1_simplec"), doc)
        cmd = self.launched[0]
        self.assertEqual(cmd[cmd.index("--base-from") + 1], ab)

    def test_abtest_starts_from_0_warm_when_the_case_has_one_else_0(self):
        import md_api
        self.assertError(self.post("/jobs", {"kind": "abtest", "params": {"name": "r1", "init": "0.cold"}}),
                         400, "bad-request", "source case has no 0.cold directory")
        st, doc, _ = self.post("/jobs", {"kind": "abtest", "params": {"name": "r1"}})
        self.assertEqual(st, 202, doc)
        cmd = self.launched[0]
        self.assertEqual(cmd[cmd.index("--init") + 1], "0")             # the default: the case has no 0.warm
        os.makedirs(os.path.join(self.src, "0.warm"))
        for init, used in (("auto", "0.warm"), ("0", "0")):
            with mock.patch.object(md_api, "_submit", lambda kind, params, label, cmd, **kw: (params, cmd)):
                params, cmd = md_api.ab_start("r1", 200, init)
            self.assertEqual((params["init"], cmd[cmd.index("--init") + 1]), (used, used))   # recorded as used

    def test_abextend_goes_past_where_the_second_run_is(self):
        ab = os.path.join(self.d, "work", "r1_ab")
        os.makedirs(os.path.join(ab, "fixed"))
        self.schema.write(os.path.join(ab, "ab_result.json"), {"source": self.src, "iters": 200, "init": "0",
                          "fixed": {"forces": {}}, "extensions": [{"from": "200", "to": 400}]}, "abtest")
        extend = lambda to: self.post("/jobs", {"kind": "abextend", "params": {"name": "r1", "to": to}})
        self.assertError(extend(600), 409, "not-ready", "second run has no decomposed fields to continue from")
        for t in ("0", "200", "400"):                                   # 200 iterations, then extended to 400
            os.makedirs(os.path.join(ab, "fixed", "processor0", t))
        for to in (300, 400):
            self.assertError(extend(to), 400, "bad-request",
                             "target must be between 401 and 5000: the second run is at iteration 400")
        self.assertEqual(self.launched, [])                             # refused before anything starts
        st, doc, _ = extend(600)
        self.assertEqual(st, 202, doc)
        cmd = self.launched[0]
        self.assertEqual((cmd[-3], os.path.basename(cmd[-2]), cmd[-1]), ("extend", "r1_ab", "600"))

    def test_openapi_matches_the_table(self):
        doc = self.get("/openapi.json")[1]
        self.assertEqual(doc["openapi"], "3.1.0")
        ops = [(t, m) for t, ms in doc["paths"].items() for m in ms]
        self.assertEqual(sorted(ops), sorted((r.template, r.method.lower()) for r in self.api.ROUTES))
        ids = [o["operationId"] for ms in doc["paths"].values() for o in ms.values()]
        self.assertEqual(len(ids), len(set(ids)))
        for t, ms in doc["paths"].items():
            for o in ms.values():
                declared = {x["name"] for x in o.get("parameters", []) if x["in"] == "path"}
                self.assertEqual(declared, set(re.findall(r"{(\w+)}", t)), t)
                self.assertIn("default", o["responses"])
        # Starting a job needs the launch token (the local page) or the web app's pairing key: either one.
        self.assertEqual(doc["paths"]["/jobs"]["post"]["security"], [{"launchToken": []}, {"pairingKey": []}])
        key = doc["components"]["securitySchemes"]["pairingKey"]
        self.assertEqual((key["type"], key["in"], key["name"]), ("apiKey", "header", "X-MD-Key"))
        self.assertEqual(sorted(doc["components"]["schemas"]["Error"]["properties"]["error"]["properties"]
                                ["code"]["enum"]), sorted(self.api.STATUS))
        refs = re.findall(r'"\$ref": "schemas/(\w+)"', json.dumps(doc))
        self.assertTrue(refs and all(k in self.schema.VERSIONS for k in refs), refs)


class TemplatesTest(unittest.TestCase):
    """templates.py: the templates, the case job's checks, and making a case with a stand-in Allmesh and
    OpenFOAM environment, so neither OpenFOAM nor a mesh is needed."""

    ALLMESH = """#!/bin/sh
cd "${0%/*}" || exit 1
: > log.surfaceFeatures
: > log.blockMesh
[ -n "$MD_TEST_FAIL" ] && exit 1
printf 'Refinement phase\\nMorphing phase\\nShrinking and layer addition phase\\n' > log.snappyHexMesh
mkdir -p constant/polyMesh
printf 'FoamFile\\n{\\n    note "nPoints:900 nCells:480 nFaces:2000 nInternalFaces:1500";\\n}\\n' > constant/polyMesh/owner
: > log.checkMesh
"""

    def setUp(self):
        import api_v1, jobs, jobrun, schema, templates
        self.api, self.jobs, self.jobrun, self.schema, self.t = api_v1, jobs, jobrun, schema, templates
        self.d = tempfile.mkdtemp(prefix="templates_test_")
        self.addCleanup(shutil.rmtree, self.d, True)
        self.cases = os.path.join(self.d, "cases")
        os.makedirs(os.path.join(self.cases, "mine", "constant", "polyMesh"))      # a case you made
        bashrc = os.path.join(self.d, "bashrc")
        with open(bashrc, "w") as f:
            f.write("export WM_PROJECT_DIR=/nowhere\n")
        env = mock.patch.dict(os.environ, {"MESHDOCTOR_CASES": self.cases, "MD_TEST_FAIL": "",
                                           "MESHDOCTOR_WORKSPACE": os.path.join(self.d, "work"),
                                           "MESHDOCTOR_FOAM_BASHRC": bashrc})
        env.start()
        self.addCleanup(env.stop)
        self.launched = []
        for obj, attr, value in ((jobs, "_spawn", lambda argv: self.launched.append(argv) or 2 ** 22 + 7),
                                 (jobs, "solver_running", lambda: False), (templates, "POLL_S", 0.05)):
            patcher = mock.patch.object(obj, attr, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def post(self, params):
        return self.api.handle("POST", "/api/v1/jobs", {}, json.dumps({"kind": "case", "params": params}).encode(),
                               "application/json")

    def assertRefused(self, answer, status, code, text):
        got, doc, _ = answer
        self.assertEqual((got, doc["error"]["code"]), (status, code), doc)
        self.assertIn(text, doc["error"]["message"])
        self.assertNotIn(self.d, doc["error"]["message"])                   # never this machine's folders

    def stand_in(self):
        """A template like the Ahmed body's, with the stand-in Allmesh, and things a copy leaves out."""
        ex = os.path.join(self.d, "examples")
        src = os.path.join(ex, "ahmed-body")
        for sub in ("system", "constant/geometry", "0", "log.x"):
            os.makedirs(os.path.join(src, sub))
        files = {"Allmesh": self.ALLMESH, "Allvalidate": "#!/bin/sh\nexit 1\n", "make_ahmed.py": "",
                 "system/blockMeshDict": "blocks ( hex (0 1 2 3 4 5 6 7) (130 15 15) simpleGrading (1 1 1) );\n",
                 "constant/geometry/README": "", "constant/geometry/ahmed.stl": "solid"}
        for rel, text in files.items():
            with open(os.path.join(src, rel), "w") as f:
                f.write(text)
        patcher = mock.patch.object(self.t, "EXAMPLES", ex)
        patcher.start()
        self.addCleanup(patcher.stop)

    def make(self, *args, **kw):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = self.t.make(*args, **kw)
        return rc, out.getvalue().strip().splitlines()

    def test_the_templates_list_their_sizes_and_each_resizes_its_own_blocks(self):
        st, doc, _ = self.api.handle("GET", "/api/v1/templates", {})
        self.assertEqual(st, 200)
        ok = next(r.ok for r in self.api.ROUTES if r.template == "/templates")
        self.assertEqual(self.schema.check(doc, ok), [])
        items = {t["name"]: t for t in doc["items"]}
        self.assertEqual(list(items), ["ahmed-body", "wheel-wing"])
        self.assertEqual([s["name"] for s in items["ahmed-body"]["sizes"]], ["coarse", "medium", "fine"])
        self.assertEqual((items["ahmed-body"]["size"], items["wheel-wing"]["size"]), ("medium", "medium"))
        for name, t in self.t.TEMPLATES.items():       # the blocks each size replaces are in the template, once
            with open(os.path.join(self.t.EXAMPLES, name, "system", "blockMeshDict")) as f:
                self.assertEqual(f.read().count(t["blocks"]), 1, name)
        with mock.patch.object(self.t, "EXAMPLES", self.d):                  # no examples folder: none to make
            self.assertEqual(self.api.handle("GET", "/api/v1/templates", {})[1], {"items": []})
            self.assertRefused(self.post({"template": "wheel-wing", "name": "w"}), 404, "not-found", "no template")

    def test_a_case_job_makes_a_new_folder_of_the_size_asked_for(self):
        st, doc, _ = self.post({"template": "ahmed-body", "size": "coarse", "name": "ahmed"})
        self.assertEqual((st, doc["kind"], doc["name"], doc["log"]), (202, "case", "ahmed", ".cases/ahmed.log"))
        self.assertEqual(self.schema.validate(doc, "job"), [])
        self.assertEqual(doc["links"]["cases"], "/api/v1/cases")
        argv = self.launched[0]
        cmd = argv[argv.index("--") + 1:]
        self.assertTrue(cmd[1].endswith("templates.py"), cmd)
        self.assertEqual(cmd[2:], ["make", "ahmed-body", "ahmed", "--size", "coarse"])
        self.assertTrue(os.path.isdir(os.path.join(self.d, "work", ".cases")))   # where its log goes

    def test_a_case_job_refuses_a_name_that_is_taken_and_a_size_the_template_hasnt(self):
        self.assertRefused(self.post({"template": "ahmed-body", "name": "mine"}), 409, "exists", "never changed")
        self.assertRefused(self.post({"template": "ahmed-body", "name": "mine", "replace": True}), 409, "exists",
                           "never changed")
        self.assertRefused(self.post({"template": "wheel-wing", "size": "coarse", "name": "w"}), 400, "bad-request",
                           "has no coarse mesh")
        self.assertRefused(self.post({"template": "nope", "name": "w"}), 404, "not-found", "no template nope")
        self.assertRefused(self.post({"template": "../x", "name": "w"}), 400, "bad-request", "template")
        self.assertRefused(self.post({"template": "wheel-wing", "name": "../w"}), 400, "bad-request", "name")
        # A case made here before (its marker) is made again only when asked to.
        made = os.path.join(self.cases, "ahmed")
        os.makedirs(made)
        open(os.path.join(made, self.t.MARKER), "w").close()
        self.assertRefused(self.post({"template": "ahmed-body", "name": "ahmed"}), 409, "exists", "replace it")
        st, doc, _ = self.post({"template": "ahmed-body", "name": "ahmed", "replace": True})
        self.assertEqual((st, doc["params"]["replace"]), (202, True))
        self.assertEqual(self.launched[-1][-1], "--replace")
        self.assertTrue(os.path.isdir(made))                    # the job deletes it, not the request
        with mock.patch.dict(os.environ, {"MESHDOCTOR_WORKSPACE": os.path.join(self.cases, "meshdoctor")}):
            self.assertRefused(self.post({"template": "ahmed-body", "name": "meshdoctor"}), 400, "bad-request",
                               "workspace")

    def test_the_ram_guard_checks_the_mesh_the_job_will_make(self):
        need = int(480_000 * 2.2 / 1024) + 512                  # the coarse Ahmed body
        with mock.patch.object(self.t.ramguard, "available_mb", lambda: need - 1):
            self.assertRefused(self.post({"template": "ahmed-body", "size": "coarse", "name": "a"}), 409,
                               "not-enough-memory", "mesh of 480,000 cells")
        with mock.patch.object(self.t.ramguard, "available_mb", lambda: need):
            self.assertEqual(self.post({"template": "ahmed-body", "size": "coarse", "name": "a"})[0], 202)

    def test_make_copies_the_template_resizes_it_and_meshes_it(self):
        self.stand_in()
        rc, lines = self.make("ahmed-body", "a1", "coarse")
        self.assertEqual(rc, 0, lines)
        self.assertEqual(lines[-1], "a1: 480 cells, ready in the cases folder")
        case = os.path.join(self.cases, "a1")
        with open(os.path.join(case, "system", "blockMeshDict")) as f:
            self.assertIn("(104 12 12)", f.read())
        left = sorted(os.listdir(case))
        for gone in ("Allvalidate", "0", "log.x"):
            self.assertNotIn(gone, left)
        self.assertFalse(os.path.exists(os.path.join(case, "constant", "geometry", "ahmed.stl")))
        self.assertTrue(os.path.isfile(os.path.join(case, "constant", "geometry", "README")))
        with open(os.path.join(case, self.t.MARKER)) as f:
            mark = json.load(f)
        self.assertEqual((mark["template"], mark["size"], mark["state"], mark["step"], mark["cells"]),
                         ("ahmed-body", "coarse", "done", "done", 480))
        job = {"kind": "case", "name": "a1", "created": "2000-01-01T00:00:00Z"}
        self.assertEqual(self.jobs.progress(job, os.path.join(self.d, "work"))["fraction"], 1.0)
        self.assertIn("a1", self.api.handle("GET", "/api/v1/cases", {})[1]["items"])    # listed, with its mesh
        self.assertEqual(self.make("ahmed-body", "a1", "coarse")[0], 1)                  # made already

    def test_a_failed_mesh_says_where_and_can_be_made_again(self):
        self.stand_in()
        with mock.patch.dict(os.environ, {"MD_TEST_FAIL": "1"}):
            rc, lines = self.make("ahmed-body", "a2", "medium")
        self.assertEqual((rc, lines[-1]), (1, "the mesh failed at blockMesh: see log.blockMesh in the case's folder"))
        with open(os.path.join(self.cases, "a2", self.t.MARKER)) as f:
            self.assertEqual(json.load(f)["state"], "failed")
        rc, lines = self.make("ahmed-body", "a2", "medium")
        self.assertEqual(rc, 1)
        self.assertIn("replace it", lines[-1])
        rc, lines = self.make("ahmed-body", "a2", "medium", replace=True)
        self.assertEqual((rc, lines[0]), (0, "replacing a2, which a template made here before"))
        with open(os.path.join(self.cases, "a2", "system", "blockMeshDict")) as f:
            self.assertIn("(130 15 15)", f.read())                                       # medium: the template's own

    def test_without_openfoams_environment_it_says_which_setting(self):
        self.stand_in()
        with open(os.environ["MESHDOCTOR_FOAM_BASHRC"], "w") as f:
            f.write("true\n")
        with mock.patch.dict(os.environ, {"WM_PROJECT_DIR": ""}):
            rc, lines = self.make("ahmed-body", "a3", "medium")
        self.assertEqual(rc, 1)
        self.assertIn("OpenFOAM's environment didn't load: check the bashrc setting", lines[-1])

    def test_progress_follows_allmesh_and_snappyhexmeshs_phases(self):
        case = os.path.join(self.cases, "p")
        os.makedirs(case)
        w = self.t.Watch(case)
        seen = [w.step()]
        for program in ("surfaceFeatures", "blockMesh"):
            open(os.path.join(case, "log." + program), "w").close()
            seen.append(w.step())
        snappy = os.path.join(case, "log.snappyHexMesh")
        for text in ("Refinement level 3 inside wake\nRefinement phase\n", "Morphing phase\n", "Shrinking and lay",
                     "er addition phase\nLayer addition iteration 0\n"):
            with open(snappy, "a") as f:
                f.write(text)
            seen.append(w.step())
        open(os.path.join(case, "log.checkMesh"), "w").close()
        seen.append(w.step())
        self.assertEqual(seen, ["geometry", "surfaceFeatures", "blockMesh", "snappyHexMesh: refining",
                                "snappyHexMesh: snapping", "snappyHexMesh: snapping", "snappyHexMesh: adding layers",
                                "checkMesh"])
        status = self.t.Status(case, "ahmed-body", "medium")
        status.step("snappyHexMesh: snapping")
        job = {"kind": "case", "name": "p", "created": "2000-01-01T00:00:00Z"}
        self.assertEqual(self.jobs.progress(job, os.path.join(self.d, "work"))["fraction"], 0.35)

    def test_a_job_error_names_no_folder_of_the_cases_folder(self):
        log = os.path.join(self.d, "job.log")
        with open(log, "w") as f:
            f.write(f"Running snappyHexMesh on {self.cases}/a1/system\n")
        self.assertEqual(self.jobrun._last_line(log, os.path.join(self.d, "work")),
                         "Running snappyHexMesh on a1/system")

    def test_the_apps_demo_has_the_templates_as_the_engine_lists_them(self):
        app = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "src", "demo", "templates.json")
        with open(app, encoding="utf-8") as f:
            self.assertEqual(json.load(f), {"items": self.t.listing()},
                             "remake it: python3 -c \"import sys, json; sys.path.insert(0, 'meshdoctor'); import "
                             "templates; print(json.dumps({'items': templates.listing()}, indent=2, ensure_ascii=False))\"")

    def test_the_command_lists_the_templates_and_refuses_an_unknown_one(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(self.t.main([]), 0)
        self.assertIn("ahmed-body: Ahmed body.", out.getvalue())
        self.assertIn("--size coarse  about 480,000 cells: for a quick look; its drag", out.getvalue())
        with self.assertRaises(SystemExit) as e:
            self.t.main(["nope", "x"])
        self.assertIn("no template nope", str(e.exception.code))


class MachineTest(unittest.TestCase):
    """GET /api/v1/machine: what the app's size estimator fills in (ramguard.machine)."""

    def setUp(self):
        import api_v1, ramguard
        self.api, self.rg = api_v1, ramguard
        self.saved = os.environ.get("MESHDOCTOR_RAM_LIMIT_MB")

    def tearDown(self):
        if self.saved is None:
            os.environ.pop("MESHDOCTOR_RAM_LIMIT_MB", None)
        else:
            os.environ["MESHDOCTOR_RAM_LIMIT_MB"] = self.saved

    def test_the_threads_of_one_core_count_once(self):
        # two sockets of two cores, two threads per core: 8 processors, 4 cores
        blocks = [f"processor\t: {i}\nphysical id\t: {i // 4}\ncore id\t\t: {i // 2 % 2}\n" for i in range(8)]
        self.assertEqual(self.rg.physical_cores("\n".join(blocks)), 4)
        # without physical ids (one socket), each core id once
        self.assertEqual(self.rg.physical_cores("core id\t: 0\n\ncore id\t: 1\n\ncore id\t: 1\n"), 2)

    def test_no_core_ids_is_unknown(self):
        self.assertIsNone(self.rg.physical_cores("processor\t: 0\nBogoMIPS\t: 48.00\n\nprocessor\t: 1\n"))
        self.assertIsNone(self.rg.physical_cores(""))

    def test_the_route_reports_the_ram_limit_setting(self):
        os.environ["MESHDOCTOR_RAM_LIMIT_MB"] = "20480"
        status, doc, _ = self.api.handle("GET", "/api/v1/machine", {})
        self.assertEqual(status, 200)
        self.assertEqual(set(doc), {"cpus", "cores", "memoryMb", "ramLimitMb"})
        self.assertEqual(doc["ramLimitMb"], 20480)
        self.assertGreaterEqual(doc["cpus"], 1)
        os.environ["MESHDOCTOR_RAM_LIMIT_MB"] = "lots"
        self.assertIsNone(self.rg.machine()["ramLimitMb"])
        os.environ.pop("MESHDOCTOR_RAM_LIMIT_MB")
        self.assertIsNone(self.rg.machine()["ramLimitMb"])

    def test_the_route_is_in_the_openapi_document(self):
        op = self.api.openapi()["paths"]["/machine"]["get"]
        self.assertEqual(op["operationId"], "machine")


class ReportTest(unittest.TestCase):
    """report.py: one portable file per run, worker paths removed, data intact."""

    def setUp(self):
        import report, schema
        self.report, self.schema = report, schema
        self.d = tempfile.mkdtemp(prefix="report_test_")
        self.ws, self.cases = os.path.join(self.d, "work"), os.path.join(self.d, "cases")
        md = os.path.join(self.ws, "r1", "meshDoctor")
        os.makedirs(md)
        os.makedirs(os.path.join(self.ws, "r1_ab"))
        self.blob = "AAAA+/usr/xBBB/+/Zm9v" * 80                   # base64 with "+/" that looks like a path
        schema.write(os.path.join(md, "result.json"), {
            "case": os.path.join(self.ws, "r1"), "source": os.path.join(self.cases, "c1"),
            "verdict": {"improved": ["nSkew"], "regressions": [], "unchanged": []},
            "runs": [{"cmd": "checkMesh", "log": f"see {self.ws}/r1/log.checkMesh and /opt/of/etc/bashrc"}],
            "note": "</script><script>alert(1)</script>", "openfoam": "14"}, "repair")
        schema.write(os.path.join(md, "map.json"), {"side": {"nx": 1, "ny": 1, "data": self.blob},
                                                    "hot": [{"case": os.path.join(self.ws, "r1_ab", "base")}]})
        schema.write(os.path.join(self.ws, "r1_ab", "ab_result.json"), {"source": os.path.join(self.cases, "c1"),
                                                                       "iters": 30}, "abtest")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def test_bundle(self):
        r = self.report.build("r1", ws=self.ws, cases=self.cases)
        text = json.dumps(r)
        self.assertNotIn(self.d, text)                                  # no worker path left anywhere
        d = r["documents"]
        self.assertEqual(d["repair"]["case"], "workspace/r1")
        self.assertEqual(d["repair"]["source"], "cases/c1")
        self.assertEqual(d["repair"]["runs"][0]["log"], "see workspace/r1/log.checkMesh and bashrc")
        self.assertEqual(d["map"]["side"]["data"], self.blob)          # encoded data untouched
        self.assertEqual(d["map"]["hot"][0]["case"], "workspace/r1_ab/base")
        self.assertEqual(sorted(d), ["abtest", "map", "repair"])
        self.assertEqual(self.schema.validate(r, "report"), [])
        self.assertEqual(r["contents"]["repair"]["sha256"], self.report.digest(d["repair"]))
        self.assertEqual(r["redacted"]["paths"], 6)

    def test_html_embeds_safely(self):
        r = self.report.build("r1", ws=self.ws, cases=self.cases)
        page = self.report.html(r)
        with open(self.report.VIEWER, encoding="utf-8") as f:
            viewer = f.read()
        self.assertEqual(page.count("</script>"), viewer.count("</script>"))   # data cannot close the tag
        self.assertIn("connect-src 'none'", page)                       # an exported report never goes online
        data = page.split('<script type="application/json" id="md-report">')[1].split("</script>")[0]
        self.assertEqual(json.loads(data), r)

    def test_html_is_one_file_with_pinned_scripts(self):
        r = self.report.build("r1", ws=self.ws, cases=self.cases)
        for page in (self.report.html(r), self.report.html()):
            self.assertNotIn("<script src=", page)                      # nothing to fetch: one file
            policy = re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"', page).group(1)
            allowed = re.search(r"script-src ([^;]+)", policy).group(1).split()
            self.assertTrue(all(a.startswith("'sha256-") for a in allowed), allowed)   # hashes only
            self.assertNotIn("'self'", policy)
            inline = re.findall(r"<script>(.*?)</script>", page, re.S)
            self.assertEqual(len(inline), 3)                            # md.js, chart.js, report.js
            self.assertEqual(sorted(allowed), sorted(self.report.csp_hash(js) for js in inline))
            self.assertIn("MD.chart = chart", inline[1])
        self.assertIn('<script type="application/json" id="md-report"></script>', self.report.html())   # empty viewer

    def test_missing_and_bad_names(self):
        with self.assertRaises(FileNotFoundError):
            self.report.build("nope", ws=self.ws, cases=self.cases)
        with self.assertRaises(FileNotFoundError):
            self.report.build("r1", ab="other", ws=self.ws, cases=self.cases)
        with self.assertRaises(ValueError):
            self.report.build("../r1", ws=self.ws, cases=self.cases)

    def test_version_matches_pyproject(self):
        import version
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pyproject.toml")) as f:
            self.assertIn(f'version = "{version.VERSION}"', f.read())


class PagesTest(unittest.TestCase):
    """The pages load script only from web/js/; STRICT pages have none inline; markup only via MD.render."""
    WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "meshdoctor", "web")
    MARKUP = re.compile(r"innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function")

    def read(self, *p):
        with open(os.path.join(self.WEB, *p), encoding="utf-8") as f:
            return f.read()

    def test_script_files_and_strict_pages(self):
        import server
        self.assertTrue(server.STRICT <= set(server.PAGES.values()))
        for name in sorted(set(server.PAGES.values())):
            page = self.read(name)
            srcs = re.findall(r'<script src="([^"]+)"', page)
            for src in srcs:
                self.assertTrue(server.SCRIPT.match("/" + src), (name, src))      # the server serves it
                self.assertTrue(os.path.isfile(os.path.join(self.WEB, src)), (name, src))
            if name in server.STRICT:
                self.assertEqual(srcs[0], "js/md.js", name)
                inline = r'<script(?![^>]*\b(?:src=|type="application/json"))[^>]*>'   # data, not code, is fine
                self.assertIsNone(re.search(inline, page), name)                         # nothing inline
                self.assertIsNone(re.search(r"\son[a-z]+\s*=", page), name)                # no onclick= etc.
                self.assertIsNone(self.MARKUP.search(page), name)

    def test_only_md_render_writes_markup(self):
        for f in sorted(os.listdir(os.path.join(self.WEB, "js"))):
            if f.endswith(".js") and f != "md.js":
                self.assertIsNone(self.MARKUP.search(self.read("js", f)), f)
        self.assertEqual(len(re.findall(r"innerHTML", self.read("js", "md.js").split("// ---- /api/v1")[0])), 2)

    def test_script_route_takes_plain_names_only(self):
        import server
        for bad in ["/js/../server.py", "/js/md.js/", "/js/.md.js", "/js/sub/md.js", "/js/MD.js", "/js/md.mjs",
                    "/js/md.js%00", "/js/" + "a" * 50 + ".js"]:
            self.assertIsNone(server.SCRIPT.match(bad), bad)
        self.assertEqual(server.SCRIPT.match("/js/md.js").group(1), "md.js")


class CommandNameTest(unittest.TestCase):
    """prog.py and the main help: commands are given as they are typed here (item 159)."""

    HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    MAIN = os.path.join(HERE, "meshdoctor", "__main__.py")

    def run_main(self, argv, argv0, told=None):
        """(output, MESHDOCTOR_PROG as main left it) for __main__.main(argv) started as argv0."""
        import importlib.util
        spec = importlib.util.spec_from_file_location("md_main_for_test", self.MAIN)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        out = io.StringIO()
        with mock.patch.dict(os.environ), mock.patch.object(sys, "argv", [argv0]), contextlib.redirect_stdout(out):
            os.environ.pop("MESHDOCTOR_PROG", None)
            if told is not None:
                os.environ["MESHDOCTOR_PROG"] = told
            self.assertEqual(mod.main(argv), 0)
            left = os.environ.get("MESHDOCTOR_PROG")
        return out.getvalue(), left

    def test_name(self):
        import prog
        with mock.patch.dict(os.environ), mock.patch.object(sys, "argv", [self.MAIN]):
            os.environ.pop("MESHDOCTOR_PROG", None)
            self.assertEqual(prog.name(), "python3 -m meshdoctor")
            os.environ["MESHDOCTOR_PROG"] = "  "
            self.assertEqual(prog.name(), "python3 -m meshdoctor")             # blank: not a name
            os.environ["MESHDOCTOR_PROG"] = "/opt/md/bin/meshdoctor"
            self.assertEqual(prog.name(), "/opt/md/bin/meshdoctor")
            self.assertEqual(prog.text("try: python3 -m meshdoctor check"), "try: /opt/md/bin/meshdoctor check")
        with mock.patch.dict(os.environ), mock.patch.object(sys, "argv", ["/usr/local/bin/meshdoctor"]):
            os.environ.pop("MESHDOCTOR_PROG", None)
            self.assertEqual(prog.name(), "meshdoctor")                        # pip's command
            self.assertEqual(prog.text("python3 -m meshdoctor serve"), "meshdoctor serve")

    def test_help_from_the_meshdoctor_command(self):
        out, left = self.run_main([], self.MAIN, told="meshdoctor")
        self.assertIn("\n    meshdoctor serve  [--port 8765]", out)
        self.assertIn("New here? meshdoctor check says whether this machine is ready. Then meshdoctor serve", out)
        self.assertIn("run meshdoctor pair --open in a", out)
        self.assertIn("(meshdoctor config)", out)
        self.assertNotIn("python3 -m", out)
        self.assertNotIn("Run it from the folder", out)
        self.assertEqual(left, "meshdoctor")
        out, left = self.run_main(["help"], "/usr/local/bin/meshdoctor")          # pip's command
        self.assertIn("\n    meshdoctor full   <srcCase> <name>", out)
        self.assertNotIn("python3 -m", out)
        self.assertEqual(left, "meshdoctor")                                    # what the tools are told

    def test_help_from_the_clone(self):
        out, left = self.run_main(["--help"], self.MAIN)
        self.assertIn("\n    python3 -m meshdoctor serve  [--port 8765]", out)
        self.assertIn("New here? python3 -m meshdoctor check", out)
        self.assertIn("Run it from the folder that holds meshdoctor/. To type just meshdoctor in any folder", out)
        self.assertEqual(left, "python3 -m meshdoctor")

    def test_unknown_command(self):
        with self.assertRaises(SystemExit) as e:
            self.run_main(["serv"], self.MAIN, told="meshdoctor")
        self.assertEqual(str(e.exception.code), "unknown command 'serv'; try: meshdoctor help")

    @unittest.skipUnless(os.name == "posix" and shutil.which("sh") and shutil.which("readlink"), "needs sh")
    def test_launcher_says_how_it_was_started(self):
        import subprocess
        launcher = os.path.abspath(os.path.join(self.HERE, "bin", "meshdoctor"))
        tmp = tempfile.mkdtemp(prefix="md_prog_")
        try:
            os.symlink(launcher, os.path.join(tmp, "meshdoctor"))
            env = {k: v for k, v in os.environ.items() if k not in ("MESHDOCTOR_PROG", "PYTHONPATH")}

            def first_line(path_dirs, script):
                env["PATH"] = os.pathsep.join(path_dirs + [os.path.dirname(sys.executable), "/usr/bin", "/bin"])
                r = subprocess.run(["sh", script, "help"], env=env, capture_output=True, text=True, timeout=60)
                self.assertEqual(r.returncode, 0, r.stderr)
                return next(line for line in r.stdout.splitlines() if " serve  [--port" in line).strip()

            self.assertTrue(first_line([tmp], os.path.join(tmp, "meshdoctor")).startswith("meshdoctor serve "))
            self.assertTrue(first_line([], launcher).startswith(launcher + " serve "))   # not on PATH: its path
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


@unittest.skipUnless(os.name == "posix", "the engine runs on Linux")
class ServePortTest(unittest.TestCase):
    """meshdoctor serve on a port another program holds (item 162)."""

    def test_a_port_in_use_says_so_before_the_banner(self):
        import socket, server
        saved = {k: getattr(server, k) for k in ("CASE", "PORT", "HOSTS", "ORIGINS", "APP_ORIGINS", "APP_KEY")}
        self.addCleanup(lambda: [setattr(server, k, v) for k, v in saved.items()])
        tmp = tempfile.mkdtemp(prefix="md_port_")
        self.addCleanup(shutil.rmtree, tmp, True)
        holder = socket.socket()
        self.addCleanup(holder.close)
        holder.bind(("127.0.0.1", 0))
        holder.listen(1)
        port = holder.getsockname()[1]
        out = io.StringIO()
        env = {"MESHDOCTOR_PROG": "meshdoctor", "MESHDOCTOR_WORKSPACE": os.path.join(tmp, "work"),
               "MESHDOCTOR_KEY_FILE": os.path.join(tmp, "app.key")}
        with mock.patch.dict(os.environ, env), contextlib.redirect_stdout(out), \
                self.assertRaises(SystemExit) as e:
            server.main(["--port", str(port)])
        self.assertEqual(str(e.exception.code),
                         f"port {port} is already in use: is meshdoctor serve already running, in another terminal? "
                         f"Use that one, or start this one on another port: meshdoctor serve --port {port + 1}")
        self.assertEqual(out.getvalue(), "")                       # no banner, no pairing link
        self.assertFalse(os.path.exists(os.path.join(tmp, "work")))  # nor a workspace made for it
        self.assertFalse(os.path.exists(os.path.join(tmp, "app.key")))


class ServeStopTest(unittest.TestCase):
    """Ctrl+C on meshdoctor serve: it says it stopped and how to start it again, not a traceback (pass 170).
    And its banner (pass 179)."""

    def serve_until_ctrl_c(self, args):
        import server
        saved = {k: getattr(server, k) for k in ("CASE", "PORT", "HOSTS", "ORIGINS", "APP_ORIGINS", "APP_KEY")}
        self.addCleanup(lambda: [setattr(server, k, v) for k, v in saved.items()])
        tmp = tempfile.mkdtemp(prefix="md_stop_")
        self.addCleanup(shutil.rmtree, tmp, True)
        fake = mock.MagicMock()                                    # a server stopped with Ctrl+C at once
        fake.serve_forever.side_effect = KeyboardInterrupt
        out = io.StringIO()
        env = {"MESHDOCTOR_PROG": "meshdoctor", "MESHDOCTOR_CONFIG": os.devnull,
               "MESHDOCTOR_WORKSPACE": os.path.join(tmp, "work"), "MESHDOCTOR_KEY_FILE": os.path.join(tmp, "app.key")}
        with mock.patch.dict(os.environ, env), contextlib.redirect_stdout(out), \
                mock.patch.object(server.http.server, "ThreadingHTTPServer", return_value=fake):
            server.main(args)                                      # no KeyboardInterrupt comes out
        fake.server_close.assert_called_once()
        return out.getvalue()

    def test_ctrl_c_stops_it_plainly(self):
        out = self.serve_until_ctrl_c(["--port", "8799"])
        self.assertIn("\nLeave this window open while you use Mesh Doctor; Ctrl+C here stops it.\n", out)
        self.assertTrue(out.endswith("\n\nMesh Doctor stopped. Jobs it started keep running; to see them again, "
                                     "start it with: meshdoctor serve --port 8799\n"), out[-160:])

    def test_the_banner_says_a_new_key_needs_a_restart(self):
        out = self.serve_until_ctrl_c(["--port", "8799"])          # the web app's own address: a pairing link
        # serve reads the key when it starts: a key made later works only once it restarts (pair --new's help says so).
        self.assertIn("\n  (the link holds the key: treat it like a password; a new key: meshdoctor pair --new, then "
                      "restart Mesh Doctor)\n", out)

    def test_in_a_container_its_jobs_stop_too(self):
        real = os.path.exists                                      # as if inside Docker (serve checks /.dockerenv)
        with mock.patch("os.path.exists", side_effect=lambda path: path == "/.dockerenv" or real(path)):
            out = self.serve_until_ctrl_c(["--port", "8799", "--container"])
        self.assertTrue(out.endswith("\n\nMesh Doctor stopped.\n"), out[-160:])


class SetupEndingTest(unittest.TestCase):
    """setup_linux.sh ends with what to run next, as meshdoctor check and the Install page do (pass 171)."""

    def test_it_names_check_serve_and_pair(self):
        import subprocess
        repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(repo, "tools", "setup_linux.sh"), encoding="utf-8") as f:
            script = f.read()
        ending = script[script.index("\n# 6. "):]                  # its last step: a folder for cases, and the check
        tmp = tempfile.mkdtemp(prefix="md_setup_")
        self.addCleanup(shutil.rmtree, tmp, True)
        stubs = 'DRY=0; ROOT=/repo; FOAM_RUN="$1/run"; load_foam() { :; }; python3() { :; }\n'
        out = subprocess.run(["bash", "-c", stubs + ending, "setup", tmp], capture_output=True, text=True,
                             check=True).stdout
        for command in ("meshdoctor check", "meshdoctor serve", "meshdoctor pair --open"):
            with self.subTest(command):
                self.assertRegex(out, rf"\n  {re.escape(command)}  +\S")   # one a line, with what it does
        self.assertIn("http://localhost:8765", out)
        self.assertIn("cp -r /repo/examples/ahmed-body $FOAM_RUN/ahmed", out)


class SelfCheckTest(unittest.TestCase):
    """meshdoctor check: one line per check, then what to do next (item 161); and the same checks as GET
    /api/v1/check, worded without this machine's folders (app item 216)."""

    @staticmethod
    def foam(missing=()):
        import selfcheck
        return {"project": "OpenFOAM", "version": "14", "appbin": "/opt/x/bin",
                "progs": {p: "" if p in missing else "/opt/x/bin/" + p for p in selfcheck.PROGRAMS}}

    @contextlib.contextmanager
    def checking(self, foam, cases=True, free=8192):
        """selfcheck with a temporary cases folder (or none), workspace and bashrc, the given OpenFOAM environment
        and free memory; yields (selfcheck, the temporary folder)."""
        import selfcheck
        tmp = tempfile.mkdtemp(prefix="md_check_")
        self.addCleanup(shutil.rmtree, tmp, True)
        folder, ws, bashrc = (os.path.join(tmp, d) for d in ("cases", "work", "bashrc"))
        if cases:
            os.mkdir(folder)
        open(bashrc, "w").close()
        resolved = {"cases": (folder, "test"), "workspace": (ws, "test"), "bashrc": (bashrc, "test"),
                    "live_case": ("", "default")}
        with mock.patch.object(selfcheck.config, "resolve", return_value=resolved), \
                mock.patch.object(selfcheck, "foam_env", return_value=foam), \
                mock.patch.object(selfcheck.ramguard, "available_mb", return_value=free), \
                mock.patch.object(selfcheck.ramguard, "limit_mb", return_value=None), \
                mock.patch.dict(os.environ, {"MESHDOCTOR_PROG": "meshdoctor"}):
            yield selfcheck, tmp

    def run_check(self, foam):
        out = io.StringIO()
        with self.checking(foam) as (selfcheck, _), contextlib.redirect_stdout(out):
            code = selfcheck.main([])
        return code, out.getvalue()

    def test_ready_says_what_to_do_next(self):
        code, out = self.run_check(self.foam())
        self.assertEqual(code, 0, out)
        self.assertIn("\nready\nNext: try a repair on OpenFOAM's motorBike tutorial (the README's \"First run\")", out)
        self.assertIn("its dashboard with meshdoctor serve; for the web app, run meshdoctor pair --open in a second "
                      "terminal.\n", out)
        self.assertNotIn("problem(s)", out)

    def test_a_problem_says_to_check_again(self):
        code, out = self.run_check(None)                                   # no OpenFOAM environment
        self.assertEqual(code, 1)
        self.assertIn("FAIL  OpenFOAM", out)
        self.assertIn("\n1 problem(s) to fix before using Mesh Doctor; then run meshdoctor check again\n", out)
        self.assertNotIn("Next:", out)

    def test_each_missing_program_says_who_makes_it(self):
        # foamCourantCells is Mesh Doctor's own (./Allwmake builds it), mpirun is MPI's, checkMesh OpenFOAM's
        code, out = self.run_check(self.foam(missing=("foamCourantCells", "mpirun", "checkMesh")))
        self.assertEqual(code, 1)
        self.assertRegex(out, r"FAIL  foamCourantCells +not built; run \./Allwmake in the repository, with OpenFOAM "
                              r"14 loaded\n")
        self.assertRegex(out, r"FAIL  mpirun +not found; A/B tests and solves need it to run on several cores: "
                              r"sudo apt install openmpi-bin\n")
        self.assertRegex(out, r"FAIL  checkMesh +not found in the OpenFOAM environment; it comes with OpenFOAM 14")
        self.assertIn("\n3 problem(s) to fix", out)
        self.assertRegex(out, r"ok    foamRun +/opt/x/bin/foamRun\n")       # the command says where each one is

    def test_the_api_answer_names_no_folders(self):
        import api_v1
        for foam, cases in ((None, False), (self.foam(missing=("foamMeshDoctor",)), True), (self.foam(), True)):
            with self.subTest(openfoam=bool(foam), cases=cases), self.checking(foam, cases) as (selfcheck, tmp):
                doc = selfcheck.report()
                self.assertEqual(self.schema_problems(doc, api_v1.READINESS), [])
                self.assertNotIn(tmp, json.dumps(doc))
                self.assertNotIn("/opt/x", json.dumps(doc))
                self.assertNotIn(os.path.basename(tmp), json.dumps(doc))
                by = {c["id"]: c for c in doc["checks"]}
                self.assertEqual(doc["ready"], all(c["state"] != "fail" for c in doc["checks"]))
                self.assertEqual(by["cases"]["state"], "ok" if cases else "warn")
                if not foam:
                    self.assertFalse(doc["ready"])
                    self.assertEqual((by["openfoam"]["state"], by["openfoam"]["found"]),
                                     ("fail", "no OpenFOAM environment"))
                    self.assertEqual(by["openfoam"]["command"], "meshdoctor config")
                    self.assertEqual(by["cases"]["command"], "meshdoctor config")
                    self.assertNotIn("foamRun", by)                 # no programs without an environment
                else:
                    self.assertEqual(by["foamRun"], {"id": "foamRun", "label": "foamRun", "group": "programs",
                                                     "state": "ok", "found": "found", "fix": None, "command": None})
                self.assertEqual(by["memory"]["found"], "8.0 GB available")

    @staticmethod
    def schema_problems(doc, sch):
        import schema
        return schema.check(doc, sch)

    def test_the_cells_that_fit_are_what_the_ram_guard_lets_through(self):
        import ramguard
        with self.checking(self.foam(), free=8192) as (selfcheck, _):
            doc = selfcheck.report()
        self.assertEqual(doc["memory"]["availableMb"], 8192)
        for kind in ("repair", "solve"):
            n = doc["memory"]["cells"][kind]
            self.assertEqual(n, ramguard.max_cells(kind, 8192))
            with mock.patch.object(ramguard, "available_mb", return_value=8192):
                for cells, fits in ((n, True), (n + 1000, False)):
                    with mock.patch.object(ramguard, "mesh_cells", return_value=cells):
                        self.assertEqual(ramguard.check("case", kind)[0], fits, (kind, cells))
        self.assertEqual(ramguard.max_cells("repair", 100), 0)              # less than the headroom
        with self.checking(self.foam(), free=None) as (selfcheck, _):
            doc = selfcheck.report()
        self.assertEqual(doc["memory"]["cells"], {"repair": None, "solve": None})
        self.assertEqual({c["id"]: c["state"] for c in doc["checks"]}["memory"], "warn")
        self.assertTrue(doc["ready"])                                        # a warning doesn't stop a job

    def test_the_route_runs_one_check_at_a_time(self):
        import api_v1, selfcheck
        api_v1._check.update(doc=None, at=-1e9)
        self.addCleanup(api_v1._check.update, doc=None, at=-1e9)
        answers = iter([{"ready": True, "n": 1}, {"ready": True, "n": 2}])
        with mock.patch.object(selfcheck, "report", side_effect=lambda: next(answers)) as report:
            first = api_v1.handle("GET", "/api/v1/check", {})
            again = api_v1.handle("GET", "/api/v1/check", {})          # just after: the same answer
            self.assertEqual((first[0], first[1]["n"], again[1]["n"], report.call_count), (200, 1, 1, 1))
            api_v1._check["at"] -= api_v1.CHECK_REUSE_S + 1                 # later on: checked again
            self.assertEqual(api_v1.handle("GET", "/api/v1/check", {})[1]["n"], 2)
        op = api_v1.openapi()["paths"]["/check"]["get"]
        self.assertEqual(op["operationId"], "readiness")
        self.assertEqual(api_v1.handle("POST", "/api/v1/check", {}, b"{}", "application/json")[0], 405)


class CommandHelpTest(unittest.TestCase):
    """Each command's own help gives commands as they are typed here, as the main help does (item 160)."""

    def help_of(self, call, told="meshdoctor"):
        """What call() prints, or exits with, while the command is called told (None: python3 -m meshdoctor)."""
        out = io.StringIO()
        with mock.patch.dict(os.environ), mock.patch.object(sys, "argv", ["md_test"]), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            os.environ.pop("MESHDOCTOR_PROG", None)
            if told is not None:
                os.environ["MESHDOCTOR_PROG"] = told
            try:
                call()
            except SystemExit as e:
                if not isinstance(e.code, int):                  # sys.exit(text): the text is the help
                    out.write(str(e.code))
        return out.getvalue()

    def test_each_command_names_itself(self):
        import jobs, pairing, report, schema, server, tplan
        from experimental import polish, ratchet
        cases = [
            ("meshdoctor full    <srcCase> <name>", lambda: repair.main([])),
            ("meshdoctor ab <srcCase> <fixedName>", lambda: abtest.main([])),
            ("meshdoctor ab extend <abDir> <endIter>", lambda: abtest.main(["--help"])),
            ("meshdoctor judge <case>", lambda: abtest.main(["judge"])),
            ("meshdoctor config shows <workspace>", lambda: abtest.main([])),
            ("meshdoctor jobs [list", lambda: jobs.main(["help"])),
            ("meshdoctor schema <kind> <file>", lambda: schema.main([])),
            ("meshdoctor experimental polish <srcCase>", lambda: polish.main([])),
            ("meshdoctor experimental ratchet <srcCase>", lambda: ratchet.main([])),
            ("usage: meshdoctor report", lambda: report.main(["--help"])),
            ("usage: meshdoctor transient-plan", lambda: tplan.main(["--help"])),
            ("usage: meshdoctor serve", lambda: server.main(["--help"])),
            ("usage: meshdoctor pair", lambda: pairing.main(["--help"])),
        ]
        for want, call in cases:
            with self.subTest(want):
                out = self.help_of(call)
                self.assertIn(want, out)
                self.assertNotRegex(out, r"python3 (-m|\S+\.py)")

    def test_from_the_clone(self):
        import pairing, report, server, tplan
        with self.subTest("ab"):
            self.assertIn("\n    python3 -m meshdoctor ab hotspots <abDir>\n", self.help_of(lambda: abtest.main([]), None))
        for command, module in [("report", report), ("transient-plan", tplan), ("serve", server), ("pair", pairing)]:
            with self.subTest(command):
                self.assertIn("usage: python3 -m meshdoctor " + command,
                              self.help_of(lambda: module.main(["--help"]), None))

    def test_pair_new_says_to_restart_the_engine(self):
        """A new key counts only once the engine restarts: pair's help and its notes say so (item 168)."""
        import pairing
        flat = lambda text: " ".join(text.split())                       # argparse wraps its help
        self.assertIn("--new make a new key; restart the engine to use it (it reads the key when it starts), and "
                      "every paired browser must pair again", flat(self.help_of(lambda: pairing.main(["--help"]))))
        self.assertIn("pair --new make a new key: restart the engine, then every paired browser must pair again "
                      "(the engine reads the key when it starts)", flat(pairing.__doc__))


class PairingTest(unittest.TestCase):
    """pairing.py: which app addresses count, the key file, and the pairing link."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="md_pair_")
        self.old = os.environ.get("MESHDOCTOR_KEY_FILE")
        os.environ["MESHDOCTOR_KEY_FILE"] = os.path.join(self.tmp, "sub", "app.key")

    def tearDown(self):
        if self.old is None:
            os.environ.pop("MESHDOCTOR_KEY_FILE", None)
        else:
            os.environ["MESHDOCTOR_KEY_FILE"] = self.old
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_origins(self):
        import pairing
        good, bad = pairing.parse_origins(
            "https://mesh-doctor.vercel.app, https://App.Example.org:8443/ http://localhost:5173 "
            "http://127.0.0.1:5173 http://[::1]:4173 https://mesh-doctor.vercel.app")
        self.assertEqual(good, ["https://mesh-doctor.vercel.app", "https://app.example.org:8443",
                                "http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:4173"])
        self.assertEqual(bad, [])
        for b in ["http://example.org", "https://example.org/app", "https://*.vercel.app", "javascript:alert(1)",
                  "https://ex_ample.org", "https://-bad.org", "ftp://localhost", "https://", "localhost:5173",
                  "http://localhost.evil.org", "https://example.org?x=1", "https://user@example.invalid"]:
            self.assertEqual(pairing.parse_origins(b), ([], [b]), b)
        self.assertEqual(pairing.parse_origins(""), ([], []))

    def test_key_file(self):
        import pairing
        k1 = pairing.load_key()
        self.assertRegex(k1, pairing.KEY)
        self.assertEqual(pairing.load_key(), k1)                        # kept, not remade
        path = os.environ["MESHDOCTOR_KEY_FILE"]
        if os.name == "posix":
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
            os.chmod(path, 0o644)
            self.assertEqual(pairing.load_key(), k1)
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)       # made private again
        k2 = pairing.new_key()
        self.assertNotEqual(k2, k1)
        self.assertEqual(pairing.load_key(), k2)
        with open(path, "w") as f:
            f.write("short")
        self.assertEqual(pairing.load_key(create=False), "")
        self.assertRegex(pairing.load_key(), pairing.KEY)                  # a bad file is replaced

    def test_link_keeps_the_key_after_the_hash(self):
        import pairing
        key = "A" * 43
        url = pairing.link("https://mesh-doctor.vercel.app", 8768, key)
        before, after = url.split("#", 1)
        self.assertEqual(before, "https://mesh-doctor.vercel.app/connect")
        self.assertEqual(after, f"key={key}&engine=http%3A%2F%2Flocalhost%3A8768")

    def pair(self, argv, state):
        """(pairing.main(argv)'s output, the engine_state mock) while the engine on the port is in this state."""
        import pairing
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"MESHDOCTOR_PROG": "meshdoctor", "MESHDOCTOR_PORT": "8765"}), \
                mock.patch.object(pairing, "engine_state", return_value=state) as seen, \
                contextlib.redirect_stdout(out):
            self.assertEqual(pairing.main(argv), 0)
        self.assertNotIn("python3 -m", out.getvalue())
        return out.getvalue(), seen

    def test_pair_says_whether_the_engine_is_running(self):
        out, seen = self.pair([], "running")
        port, origin, key = seen.call_args[0]
        self.assertEqual((port, origin), (8765, "https://mesh-doctor.vercel.app"))   # asked as the web app would
        with open(os.environ["MESHDOCTOR_KEY_FILE"]) as f:
            self.assertEqual(key, f.read().strip())                                    # with this key
        self.assertIn("The engine is running on port 8765, so the link works now.\n", out)
        out, seen = self.pair(["--port", "8770"], "none")
        self.assertEqual(seen.call_args[0][0], 8770)
        self.assertIn("No engine is running on port 8770 yet: start it first, in another terminal: "
                      "meshdoctor serve --port 8770\n", out)
        out, _ = self.pair([], "unknown")
        self.assertIn("If the engine isn't running yet, start it first, in another terminal: meshdoctor serve\n", out)
        out, _ = self.pair(["--new"], "old-key")
        self.assertIn("The engine running on port 8765 still has the old key: restart it (Ctrl+C in its terminal, "
                      "then meshdoctor serve) for this link to work.\n", out)
        out, _ = self.pair([], "old-key")                                  # a pair --new made earlier
        self.assertIn("The engine running on port 8765 has another key (from before a pair --new?): restart it "
                      "(Ctrl+C in its terminal, then meshdoctor serve) for this link to work.\n", out)

    def serve_stub(self, status, body, key=None):
        """A throwaway HTTP server on a free port of this machine, answering every GET with status and body
        (with a key: as the engine does, a 403 about the pairing key to any other X-MD-Key)."""
        import http.server, threading

        class Stub(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if key is not None and self.headers.get("X-MD-Key") != key:
                    self.send_response(403)
                    self.end_headers()
                    self.wfile.write(b'{"error": {"code": "forbidden", "message": "forbidden: missing or wrong '
                                     b'pairing key (pair again: meshdoctor pair)"}}')
                    return
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        httpd = http.server.HTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        return httpd.server_address[1]

    def test_engine_state(self):
        import pairing, socket
        api = json.dumps({"apiVersion": "1.2", "openapi": "/api/v1/openapi.json"}).encode()
        self.assertEqual(pairing.engine_state(self.serve_stub(200, api)), "running")
        engine = self.serve_stub(200, api, key="K" * 43)
        self.assertEqual(pairing.engine_state(engine, "https://mesh-doctor.vercel.app", "K" * 43), "running")
        self.assertEqual(pairing.engine_state(engine, "https://mesh-doctor.vercel.app", "N" * 43), "old-key")
        self.assertEqual(pairing.engine_state(self.serve_stub(403, b"forbidden: cross-site request")), "unknown")
        self.assertEqual(pairing.engine_state(self.serve_stub(404, b"<html>not here</html>")), "unknown")
        self.assertEqual(pairing.engine_state(self.serve_stub(200, b"<html>another app</html>")), "unknown")
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        closed = s.getsockname()[1]
        s.close()
        self.assertEqual(pairing.engine_state(closed), "none")

    def test_server_compare(self):
        import server
        self.assertTrue(server._same("abc", b"abc"))
        self.assertFalse(server._same("abd", b"abc"))
        self.assertFalse(server._same("", b""))                             # no key set: never a match
        self.assertFalse(server._same("éè", b"abc"))               # non-ASCII text: no exception
        self.assertIn("X-MD-Key", server.APP_HEADERS)


@unittest.skipUnless(os.path.isdir("/proc"), "the local runner needs Linux")
class LocalRunnerTest(unittest.TestCase):
    """jobs.py + jobrun.py with real processes (python -c ...), never OpenFOAM."""

    def setUp(self):
        import jobs, schema
        self.jobs, self.schema = jobs, schema
        self.ws = tempfile.mkdtemp(prefix="jobs_test_")
        self.saved = jobs.solver_running
        jobs.solver_running = lambda: False

    def tearDown(self):
        for j in self.jobs.list_jobs(self.ws):
            if j["state"] in self.jobs.ACTIVE:
                self.jobs.cancel(j["id"], self.ws)
        self.jobs.solver_running = self.saved
        shutil.rmtree(self.ws, ignore_errors=True)

    def run_job(self, code, name="t1"):
        return self.jobs.submit("repair", {}, name, [sys.executable, "-c", code], log=name + ".log", ws=self.ws)

    def wait(self, job_id, states, timeout=15):
        t0 = time.time()
        while time.time() - t0 < timeout:
            j = self.jobs.get(job_id, self.ws)
            if j["state"] in states:
                return j
            time.sleep(0.1)
        self.fail(f"job {job_id} still {j['state']}")

    def test_a_wrapper_that_never_answers_is_stopped(self):
        """_spawn waits a while for the wrapper to say its pid, then stops it: nothing is left running, and its
        pipe is closed (a Popen dropped while its process runs, or an open pipe, warns as it is freed)."""
        slow = os.path.join(self.ws, "slow.py")
        with open(slow, "w") as f:
            f.write("import time\ntime.sleep(60)\n")
        seen, t0 = len(leakcheck.seen), time.monotonic()
        with mock.patch.object(self.jobs, "SPAWN_TIMEOUT", 0.5), self.assertRaises(self.jobs.Refused) as e:
            self.jobs._spawn([sys.executable, slow])
        self.assertEqual(e.exception.code, "internal")
        self.assertLess(time.monotonic() - t0, 30)          # stopped, not waited for
        gc.collect()
        self.assertEqual(leakcheck.seen[seen:], [])

    def test_done(self):
        j = self.wait(self.run_job("print('hello from the job')")["id"], ("done", "failed"))
        self.assertEqual((j["state"], j["exitCode"], j["error"]), ("done", 0, None))
        self.assertTrue(j["started"] and j["finished"])
        self.assertEqual(self.schema.validate(j, "job"), [])
        with open(os.path.join(self.ws, "t1.log")) as f:
            self.assertIn("hello from the job", f.read())

    def test_failed_says_why_without_paths(self):
        code = f"import sys; sys.exit('stopped: see {self.ws}/t1/log.x')"
        j = self.wait(self.run_job(code)["id"], ("done", "failed"))
        self.assertEqual((j["state"], j["exitCode"]), ("failed", 1))
        self.assertIn("stopped: see t1/log.x", j["error"])
        self.assertNotIn(self.ws, j["error"])

    def test_busy_then_cancel_stops_the_whole_group(self):
        mark = os.path.basename(self.ws)                               # unique per test run
        code = ("import subprocess, sys, time; subprocess.Popen([sys.executable, '-c', "
                f"'import time; time.sleep(60) # {mark}']); time.sleep(60)")
        j = self.wait(self.run_job(code)["id"], ("running",))
        time.sleep(0.5)                                                # let the grandchild start
        self.assertEqual(len([c for _, _, c in self.jobs.procs() if mark in c and "jobrun.py" not in c]), 2)
        with self.assertRaises(self.jobs.Refused) as e:
            self.run_job("pass", "t2")
        self.assertEqual(e.exception.code, "busy")
        j = self.jobs.cancel(j["id"], self.ws, wait=10)
        self.assertEqual(j["state"], "cancelled")
        time.sleep(0.5)
        self.assertEqual([c for _, _, c in self.jobs.procs() if mark in c], [])   # child and grandchild gone
        self.assertIsNone(self.jobs.busy(self.ws))

    def test_lost_job_is_marked_failed(self):
        os.makedirs(self.jobs.jobs_dir(self.ws))
        jid = "20260101-000000-repair-t3-abcd"
        self.jobs.save(self.jobs.path_of(jid, self.ws), {
            "id": jid, "kind": "repair", "params": {}, "name": "t3", "state": "running", "runner": "local",
            "created": "2026-01-01T00:00:00Z", "started": "2026-01-01T00:00:01Z", "finished": None,
            "pid": 2 ** 22 + 7, "exitCode": None, "log": "t3.log", "result": None, "error": None})
        j = self.jobs.get(jid, self.ws)
        self.assertEqual(j["state"], "failed")
        self.assertIn("without reporting", j["error"])


class LeakCheckTest(unittest.TestCase):
    """A file left open fails the test module (tests/leakcheck.py), though Python itself only prints it."""

    def run_module(self, body, *flags):
        """Run a one-test module that takes leakcheck's setUpModule and tearDownModule."""
        with tempfile.TemporaryDirectory(prefix="leak_test_") as d:
            with open(os.path.join(d, "test_leaky.py"), "w") as f:
                f.write("import unittest\nfrom leakcheck import setUpModule, tearDownModule  # noqa: F401\n\n\n"
                        "class T(unittest.TestCase):\n    def test_it(self):\n        " + body + "\n")
            env = dict(os.environ, PYTHONPATH=os.path.dirname(os.path.abspath(__file__)))
            return subprocess.run([sys.executable, *flags, "-m", "unittest", "test_leaky"], cwd=d, env=env,
                                  capture_output=True, text=True, timeout=60)

    def test_a_file_left_open_fails_the_module(self):
        for flags in (["-W", "error::ResourceWarning"], []):      # as on GitHub, and a plain run
            r = self.run_module("open(__file__).read()", *flags)
            self.assertEqual(r.returncode, 1, r.stderr)
            self.assertIn("ERROR: tearDownModule (test_leaky)", r.stderr)
            self.assertIn("unclosed file", r.stderr)

    def test_a_file_closed_passes(self):
        r = self.run_module("with open(__file__) as f:\n            f.read()", "-W", "error::ResourceWarning")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("Exception ignored", r.stderr)


if __name__ == "__main__":
    unittest.main()
