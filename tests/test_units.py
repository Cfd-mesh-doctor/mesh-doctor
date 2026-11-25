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

    def test_full_and_ab_check_the_disk_before_anything_is_copied(self):
        import diskguard
        work = os.path.join(self.tmp, "work")
        with open(os.path.join(self.cases, "case7", "constant", "polyMesh", "points"), "w") as f:
            f.write("p" * 100)
        os.makedirs(os.path.join(self.cases, "case7", "0"))
        out = io.StringIO()
        with mock.patch.object(repair, "ROOT", work), mock.patch.object(abtest, "ROOT", work), \
                mock.patch.object(diskguard, "free_mb", lambda folder: diskguard.KEEP_MB - 1), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            for argv, run in ((["full", "case7", "x", "--no-ram-check"], repair.main),
                              (["case7", "-", "--variant", "simplec", "--no-ram-check"], abtest.main)):
                with self.assertRaises(SystemExit) as e:
                    run(argv)
                self.assertEqual(e.exception.code, 4, argv)
        free = diskguard.text(diskguard.KEEP_MB - 1)
        # the copy and its points' backup (1 MB), and the sets and room to collapse faces of its 1 MB mesh (3 MB);
        # the A/B test's two runs: each a copy (1 MB), its split and two written times (3 MB)
        said = out.getvalue()
        self.assertIn("not enough disk space: the copy of case7 and its repair need about 4 MB, and the disk has "
                      f"{free} free (the engine keeps 1.0 GB free)", said)
        self.assertIn(f"not enough disk space: the A/B test case7_simplec needs about 8 MB, and the disk has {free} "
                      "free", said)
        self.assertFalse(os.path.exists(work))                              # nothing copied, nothing solved



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

    def test_extend_checks_the_disk_before_the_run_goes_on(self):
        import diskguard
        sparse(os.path.join(self.top, "fixed", "constant", "polyMesh", "points"), diskguard.MB)
        out = io.StringIO()
        with mock.patch.object(diskguard, "free_mb", lambda folder: diskguard.KEEP_MB), \
                mock.patch.object(abtest, "extend", lambda *a, **kw: self.fail("it went on")), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()), \
                self.assertRaises(SystemExit) as e:
            abtest.main(["extend", "wing-fix", "400", "--no-ram-check"])
        self.assertEqual(e.exception.code, 4)
        self.assertIn("not enough disk space: running wing-fix's second run longer needs about 1 MB, and the disk has "
                      f"{diskguard.text(diskguard.KEEP_MB)} free", out.getvalue())     # a time it writes, split


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
        self.assertEqual(early["schemaVersion"], "1.2")

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
        # its forces settled from the start (the vertical one is steady): averaged over all of it, in seconds
        self.assertEqual((j["settled"], j["average"]["drag"]["from"]), (0.001, 0.001))
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
        j = self.judge()
        self.assertTrue(j["verdict"].startswith("still developing"))
        # its forces haven't settled: the averages are over the last two windows of time steps
        self.assertIsNone(j["settled"])
        self.assertAlmostEqual(j["average"]["drag"]["from"], 0.2)

    def test_averages_from_when_the_forces_settled(self):
        # a start-up that dies away over the first 100 or so steps, then shedding about a steady mean
        self.write_run(600, 1e-5, 0.8, lambda i: 50 + 30 * math.exp(-i / 25) + 3 * math.sin(i / 7))
        j = self.judge()
        import caseinfo
        drag = caseinfo.series(caseinfo.parse_forces(self.d), caseinfo.describe(self.d), "body", "drag")
        self.assertEqual(j["settled"], abtest.settle(drag))           # the vertical force is steady from the start
        self.assertTrue(0.05 <= j["settled"] <= 0.25, j["settled"])
        self.assertEqual(j["average"]["drag"]["from"], j["settled"])
        self.assertAlmostEqual(j["average"]["drag"]["mean"], 50, delta=0.5)
        # from a time given, as before
        self.assertEqual(abtest.judge(self.d, window=200, avg_from=0.4, logs=caseinfo.solver_logs(
            self.d, ("log.pimple",)))["average"]["drag"]["from"], 0.4)
        import schema
        self.assertEqual(schema.validate(j, "judge"), [])

    def test_settle_finds_where_a_history_stops_drifting(self):
        at = lambda f, n=600: [[i * 1e-3, f(i)] for i in range(1, n + 1)]          # noqa: E731
        # settled from the start; once a start-up dies away; never, while it drifts; too short to tell
        self.assertLessEqual(abtest.settle(at(lambda i: 50 + 3 * math.sin(i / 7))), 0.06)
        t = abtest.settle(at(lambda i: 50 + 30 * math.exp(-i / 25) + 3 * math.sin(i / 7)))
        self.assertTrue(0.05 <= t <= 0.25, t)
        self.assertIsNone(abtest.settle(at(lambda i: 50 + i / 10)))
        self.assertIsNone(abtest.settle(at(lambda i: 50.0, 99)))
        self.assertEqual(abtest.settle(at(lambda i: 50.0, 100)), 1e-3)
        # large forces with small swings: no cancellation
        self.assertLessEqual(abtest.settle(at(lambda i: 1e6 + 1e-3 * math.sin(i / 7))), 0.06)

    def test_step_stats_give_each_time_step(self):
        import caseinfo
        with open(os.path.join(self.d, "log.adjust"), "w") as f:     # an adjustable time step prints it first
            for i, (dt, t) in enumerate(((2e-5, 2e-5), (3e-5, 5e-5), (2.5e-5, 7.5e-5))):
                f.write(f"Courant Number mean: 0.1 max: {0.9 + i / 100}\ndeltaT = {dt:g}\nTime = {t:g}s\n\n"
                        "PIMPLE: Iteration 1\nGAMG:  Solving for p, Initial residual = 0.01, Final residual = 1e-7, "
                        "No Iterations 5\n")
        steps = caseinfo.step_stats([os.path.join(self.d, "log.adjust")])
        self.assertEqual([s["deltaT"] for s in steps], [2e-5, 3e-5, 2.5e-5])
        self.assertEqual([s["coMax"] for s in steps], [0.91, 0.92, None])     # printed after the step it measures
        self.write_run(5, 1e-5, 0.8, lambda i: 50.0)                     # a fixed one: the time since the step before
        steps = caseinfo.step_stats(caseinfo.solver_logs(self.d, ("log.pimple",)))
        self.assertIsNone(steps[0]["deltaT"])
        for s in steps[1:]:
            self.assertAlmostEqual(s["deltaT"], 1e-3)


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


def write_labels(path, labels, binary=False, size=4, arch=True, order="<"):
    """An OpenFOAM labelList file such as cellProcAddressing (gzipped where `path` ends in .gz): ASCII (a short
    list on one line, as OpenFOAM writes 10 or fewer), or binary of 32 or 64 bit labels, with an arch in its header
    or none (OpenFOAM 14 writes none)."""
    import gzip, struct
    head = "FoamFile\n{\n    format      %s;\n" % ("binary" if binary else "ascii")
    if arch:
        head += '    arch        "%s;label=%d;scalar=64";\n' % ("MSB" if order == ">" else "LSB", 8 * size)
    head += ('    class       labelList;\n    location    "constant/polyMesh";\n    object      cellProcAddressing;\n'
             "}\n// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //\n\n\n")
    n = len(labels)
    if binary:     # N, then (its bytes), or nothing for none
        body = f"{n}\n".encode() + (b"(" + struct.pack(f"{order}{n}{'iq'[size == 8]}", *labels) + b")" if n else b"")
    elif n <= 10:
        body = f"{n}({' '.join(map(str, labels))})".encode()
    else:
        body = (f"{n}\n(\n" + "".join(f"{c}\n" for c in labels) + ")").encode()
    data = head.encode() + body + b"\n\n\n// " + b"*" * 73 + b" //\n"
    with (gzip.open(path, "wb") if path.endswith(".gz") else open(path, "wb")) as f:
        f.write(data)


def write_owner(poly, cells):
    """A polyMesh owner file's header, with its cell count in its note, as OpenFOAM writes it (its list isn't read)."""
    os.makedirs(poly, exist_ok=True)
    with open(os.path.join(poly, "owner"), "w") as f:
        f.write('FoamFile\n{\n    format      ascii;\n    class       labelList;\n    note        "nPoints:%d  '
                'nCells:%d  nFaces:%d  nInternalFaces:%d";\n    location    "constant/polyMesh";\n    object      '
                'owner;\n}\n\n0()\n' % (8 * cells, cells, 6 * cells, 3 * cells))


def write_cells(root, cells, gmax, ntop, lo=-4.0, width=0.02):
    """What foamCourantCells writes for one processor, in root/meshDoctor/courant/cells.txt: cells are (rate, (x, y,
    z), volume, aspect ratio, non-orthogonality, speed, wall distance, wall), -1 and "-" where it can't tell; gmax is
    the largest rate of the whole mesh."""
    d = os.path.join(root, "meshDoctor", "courant")
    os.makedirs(d, exist_ok=True)
    hist = {}
    for c in cells:
        if c[0] > 0:
            b = min(max(int(math.floor((math.log10(c[0]) - lo) / width)), 0), 699)
            hist[b] = hist.get(b, 0) + 1
    with open(os.path.join(d, "cells.txt"), "w") as f:
        f.write(f"L {lo} {width}\nN {len(cells)}\nZ {sum(c[0] <= 0 for c in cells)}\n"
                f"W {sum(c[0] > 0 and c[0] >= 0.5 * gmax for c in cells)}\n")
        for b in sorted(hist):
            f.write(f"B {b} {hist[b]}\n")
        for i in sorted(range(len(cells)), key=lambda i: -cells[i][0])[:ntop]:
            r, (x, y, z), v, aspect, ortho, u, dist, wall = cells[i]
            f.write(f"T {i} {r} {x} {y} {z} {v} {aspect} {ortho} {u} {dist} {wall}\n")


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
        self.assertTrue(os.path.islink(os.path.join(into, "processor10", "300", "U")))       # the speed it reports
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

    def test_plan_where_foamCourantCells_isnt_built(self):
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
        seen, real = [], (self.tp.courant_cells, self.tp.post_process)
        self.tp.courant_cells = lambda into, t, nproc, ntop: (127, os.path.join(into, "log.foamCourantCells"))
        self.tp.post_process = self.fake_post_process(rates_of, seen)
        try:
            before = self.listing()
            p = self.tp.plan(self.case, targets=(1.0, 5.0), outer=3, top=5)
        finally:
            self.tp.courant_cells, self.tp.post_process = real
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
        # OpenFOAM's CourantNo, and it says so: no walls, speeds or shapes, and no cells for a cell set
        self.assertEqual((p["tool"], p["decomposed"], "fastestCells" in p, "wall" in g),
                         ("foamPostProcess", True, False, False))
        self.assertIn("foamCourantCells isn't built (./Allwmake in its folder)", p["notes"][-1])

    def fake_courant_cells(self, cells_of, seen):
        """Stand-in for foamCourantCells: writes each shadow processor's cells.txt from cells_of(processor)."""
        def run(into, t, nproc, ntop):
            seen.append((into, nproc, ntop))
            every = [cells_of(p) for p in range(nproc)]
            gmax = max(c[0] for cells in every for c in cells)
            for p, cells in enumerate(every):
                write_cells(os.path.join(into, f"processor{p}"), cells, gmax, ntop)
            log = os.path.join(into, "log.foamCourantCells")
            open(log, "w").close()
            return 0, log
        return run

    def test_plan_from_foamCourantCells(self):
        self.make_case(nproc=2)
        walls = ["body", "floor", "body", "floor", "body"]

        def cells_of(p):       # as the fallback's: 250 cells each, 5 fast ones in a cluster on processor 1, by walls
            cells = [(10.0 + (i % 7), (i * 0.1, p * 50.0, 0.0), 1e-3, 1.5, 20.0, 25.0, 0.5, "floor") for i in range(250)]
            if p == 1:
                for k in range(5):
                    cells[100 + k] = (1000.0 - k, (5.0 + 0.01 * k, 2.0, 1.0), 1e-6, (2, 3, 40, 4, 5)[k],
                                      (30, 70, 40, 50, 60)[k], 30.0 + k, 0.001 * (2 * k + 1), walls[k])
            return cells
        seen, real = [], self.tp.courant_cells
        self.tp.courant_cells = self.fake_courant_cells(cells_of, seen)
        try:
            before = self.listing()
            p = self.tp.plan(self.case, targets=(1.0, 5.0), outer=3, top=5)
        finally:
            self.tp.courant_cells = real
        self.assertEqual(self.listing(), before)                         # the case is only read
        self.assertFalse(os.path.exists(seen[0][0]))                       # the shadow is removed
        self.assertEqual(seen[0][1:], (2, 6))                              # each processor's fastest top + 1
        self.assertEqual((p["tool"], p["decomposed"], p["cells"], p["processors"]), ("foamCourantCells", True, 500, 2))
        d = p["courantPerSecond"]
        # exact at the top; below, from its histogram (bins 4.7 % wide): the median is 13, as the fallback's
        self.assertEqual((d["max"], d["withoutTop"], d["p99"], d["p9999"]), (1000.0, 16.0, 996.0, 1000.0))
        self.assertLess(abs(d["median"] / 13 - 1), 0.047, d["median"])
        self.assertEqual(p["cellsWithin2x"], 5)
        g = p["regions"][0]
        # the wall most of its cells are nearest, their median distance from it (1, 5 and 9 mm), the fastest flow,
        # the largest aspect ratio and the worst non-orthogonality there
        self.assertEqual((g["nCells"], g["wall"], g["speed"], g["aspectRatio"], g["maxNonOrtho"]),
                         (5, "body", 34.0, 40.0, 70.0))
        self.assertAlmostEqual(g["wallDist"], 0.005)
        self.assertAlmostEqual(g["h"], 0.01)
        self.assertEqual(p["fastestCells"], [[1, 100], [1, 101], [1, 102], [1, 103], [1, 104]])
        self.assertAlmostEqual(p["options"][0]["deltaT"], 1e-3)
        self.assertEqual(self.schema.validate(p, "tplan"), [])
        self.assertNotIn("isn't built", " ".join(p["notes"]))
        self.assertIn("0.005 m from body, flow up to 34 m/s", self.tp.summary(p))
        # where the flow has no U written and no wall is on a processor, it says nothing of them
        bare = lambda p: [(r, c, v, a, o, -1, -1, "-") for r, c, v, a, o, *_ in cells_of(p)]     # noqa: E731
        self.tp.courant_cells = self.fake_courant_cells(bare, [])
        try:
            g = self.tp.plan(self.case, top=5)["regions"][0]
        finally:
            self.tp.courant_cells = real
        self.assertEqual((g["wall"], g["wallDist"], g["speed"]), (None, None, None))

    def test_the_cell_set_is_written_whole_in_the_case_layout_and_replaces_only_its_own(self):
        dest = os.path.join(self.d, "plan.sets")
        p = {"case": "steady", "time": "300", "processors": 3, "decomposed": True,
             "fastestCells": [[2, 7], [0, 5], [2, 3]]}
        # a split case with no whole mesh: on its processors only, and it says why
        self.assertEqual(self.tp.write_sets(dest, p, self.case), "the case has no whole mesh (constant/polyMesh)")
        sets = lambda sub: os.path.join(dest, sub, "constant", "polyMesh", "sets", "fastestCells")      # noqa: E731
        with open(sets("processor2")) as f:
            text = f.read()
        self.assertIn("    class       cellSet;\n", text)
        self.assertTrue(text.endswith("}\n\n2\n(\n3\n7\n)\n"), text)
        with open(sets("processor1")) as f:                    # on every processor, empty where it has none
            self.assertTrue(f.read().endswith("}\n\n0\n(\n)\n"))
        self.assertEqual(sorted(os.listdir(dest)), [".meshdoctor-sets", "processor0", "processor1", "processor2"])
        with open(os.path.join(dest, ".meshdoctor-sets")) as f:
            self.assertIn("set its time step, on each of its 3 processors (not on its whole mesh: the case has no "
                          "whole mesh (constant/polyMesh)).", f.read())
        # again: a whole new folder in its place, nothing of the old one left and nothing beside it
        open(os.path.join(dest, "stale"), "w").close()
        self.assertIsNone(self.tp.write_sets(dest, dict(p, processors=1, decomposed=False,
                                                        fastestCells=[[0, 9], [0, 4]]), self.case))
        with open(sets("")) as f:
            self.assertTrue(f.read().endswith("}\n\n2\n(\n4\n9\n)\n"))
        self.assertEqual(sorted(os.listdir(dest)), [".meshdoctor-sets", "constant"])
        self.assertEqual(os.listdir(self.d), ["plan.sets"])
        # a folder it didn't write, or a link, is never replaced
        mine, link = os.path.join(self.d, "mine"), os.path.join(self.d, "link")
        os.makedirs(mine)
        open(os.path.join(mine, "keep"), "w").close()
        os.symlink(dest, link)
        for there in (mine, link):
            with self.assertRaisesRegex(ValueError, "isn't a folder of cell sets this wrote: not replacing it"):
                self.tp.write_sets(there, p, self.case)
        self.assertEqual(os.listdir(mine), ["keep"])
        self.assertEqual(sorted(os.listdir(self.d)), ["link", "mine", "plan.sets"])

    def test_a_split_cases_set_is_on_its_whole_mesh_too_each_cell_found_by_its_processors_cellProcAddressing(self):
        # a whole mesh of 28 cells split on 4 processors, the label in the whole mesh of each of their cells written
        # four ways: ASCII a label a line; binary of 32 bits gzipped, with no arch (as OpenFOAM 14 writes it); binary
        # of 64 bits with its arch; ASCII on one line
        whole_of = [[27, 3, 14, 0, 9, 21, 5, 18, 11, 24, 7, 16], [2, 25, 13, 8, 20, 1, 26], [6, 19, 12, 23, 4, 17],
                    [10, 22, 15]]
        ways = [("", {}), (".gz", {"binary": True, "arch": False}), ("", {"binary": True, "size": 8}), ("", {})]
        poly = lambda n: os.path.join(self.case, f"processor{n}", "constant", "polyMesh")      # noqa: E731
        addr = lambda n: os.path.join(poly(n), "cellProcAddressing" + ways[n][0])            # noqa: E731
        whole = os.path.join(self.case, "constant", "polyMesh")
        write_owner(whole, 28)
        for n, labels in enumerate(whole_of):
            write_owner(poly(n), len(labels))
            write_labels(addr(n), labels, **ways[n][1])
        p = {"case": "steady", "time": "300", "processors": 4, "decomposed": True,
             "fastestCells": [[2, 5], [0, 11], [1, 0], [0, 3], [1, 6], [2, 0]]}
        dest = os.path.join(self.d, "plan.sets")
        sets = lambda sub: os.path.join(dest, sub, "constant", "polyMesh", "sets", "fastestCells")      # noqa: E731
        before = self.listing()

        def cells(sub):
            with open(sets(sub)) as f:
                n, rest = f.read().split("}\n\n")[1].split("\n(\n")
            return int(n), [int(c) for c in rest.split()[:-1]]
        self.assertIsNone(self.tp.write_sets(dest, p, self.case))
        self.assertEqual(self.listing(), before)                         # the case is only read
        # on its whole mesh: 17 is processor2's cell 5, 16 processor0's cell 11, and so on
        self.assertEqual(cells(""), (6, [0, 2, 6, 16, 17, 26]))
        self.assertEqual([cells(f"processor{n}") for n in range(4)], [(2, [3, 11]), (2, [0, 6]), (2, [0, 5]), (0, [])])
        with open(os.path.join(dest, ".meshdoctor-sets")) as f:
            self.assertIn("set its time step, on its whole mesh and on each of its 4 processors.", f.read())
        # 64 bits with no arch: read as where the list ends says
        write_labels(addr(2), whole_of[2], binary=True, size=8, arch=False)
        self.assertIsNone(self.tp.write_sets(dest, p, self.case))
        self.assertEqual(cells(""), (6, [0, 2, 6, 16, 17, 26]))

        def says(path, old, new, opener=open):
            """Change `old` to `new` in the file, as a torn or hand-edited one would be."""
            with opener(path, "rb") as fh:
                s = fh.read()
            with opener(path, "wb") as fh:
                fh.write(s.replace(old, new, 1))
        import gzip
        # where the case hasn't the whole mesh it was split from: on its processors only, and why
        for say, change, undo in [
                ("processor3 has no cellProcAddressing, which says where its cells are in the whole mesh",
                 lambda: os.rename(addr(3), addr(3) + ".x"), lambda: os.rename(addr(3) + ".x", addr(3))),
                # 7 labels said, 6 there
                ("processor1's cellProcAddressing can't be read (cellProcAddressing.gz: not 7 labels of 32 or 64 bits)",
                 lambda: (write_labels(addr(1), whole_of[1][:6], binary=True, arch=False),
                          says(addr(1), b"\n6\n(", b"\n7\n(", gzip.open)),
                 lambda: write_labels(addr(1), whole_of[1], binary=True, arch=False)),
                # its last label, 16, gone
                ("processor0's cellProcAddressing can't be read (cellProcAddressing: 11 labels, not 12)",
                 lambda: says(addr(0), b"\n16\n)", b"\n)"), lambda: write_labels(addr(0), whole_of[0])),
                ("processor0's cellProcAddressing is of 12 cells and its mesh of 13: it was meshed again since it was "
                 "split", lambda: write_owner(poly(0), 13), lambda: write_owner(poly(0), 12)),
                ("its processors' 28 cells aren't the whole mesh's 30: the whole mesh was made again since it was "
                 "split",
                 lambda: write_owner(whole, 30), lambda: write_owner(whole, 28)),
                ("the case has no whole mesh (constant/polyMesh)",
                 lambda: os.remove(os.path.join(whole, "owner")), lambda: write_owner(whole, 28))]:
            change()
            try:
                self.assertEqual(self.tp.write_sets(dest, p, self.case), say)
            finally:
                undo()
            self.assertFalse(os.path.exists(sets("")), say)
            self.assertEqual(cells("processor0"), (2, [3, 11]))
        self.assertIsNone(self.tp.write_sets(dest, p, self.case))             # all as it was
        self.assertEqual(cells(""), (6, [0, 2, 6, 16, 17, 26]))

    def test_read_labels(self):
        f = os.path.join(self.d, "labels")
        for kw in ({}, {"binary": True}, {"binary": True, "size": 8}, {"binary": True, "arch": False},
                   {"binary": True, "size": 8, "arch": False}, {"binary": True, "order": ">"},
                   {"binary": True, "size": 8, "order": ">"}):
            for labels in ([5, 0, 2**31 - 1, 7], list(range(40, 0, -1))):
                write_labels(f, labels, **kw)
                self.assertEqual(self.tp.read_labels(f, [0, 2, len(labels) - 1]),
                                 (len(labels), {0: labels[0], 2: labels[2], len(labels) - 1: labels[-1]}), kw)
                self.assertEqual(self.tp.read_labels(f), (len(labels), {}))             # its length only
        write_labels(f, [8, 2**40], binary=True, size=8)
        self.assertEqual(self.tp.read_labels(f, [1]), (2, {1: 2**40}))
        write_labels(f + ".gz", list(range(12)), binary=True, arch=False)
        self.assertEqual(self.tp.read_labels(f + ".gz", [11]), (12, {11: 11}))
        # a binary list of none has no ( ); a list all the same is N{label}
        write_labels(f, [], binary=True, arch=False)
        self.assertEqual(self.tp.read_labels(f), (0, {}))
        with open(f, "w") as fh:
            fh.write("FoamFile\n{\n    format      ascii;\n    class       labelList;\n}\n// * * //\n\n5{7}\n")
        self.assertEqual(self.tp.read_labels(f, [0, 4]), (5, {0: 7, 4: 7}))
        for text, said in [("FoamFile\n{\n    format      ascii;\n}\n\n3(1 2 3)\n", None),
                           ("3(1 2 3)\n", "not a list of labels"),
                           ("FoamFile\n{\n    format      ascii;\n}\n\nnone\n", "not a list of labels"),
                           ("FoamFile\n{\n    format      ascii;\n}\n\n3(1 2 3\n", "its list isn't closed"),
                           ("FoamFile\n{\n    format      ascii;\n}\n\n3(1 2)\n", "2 labels, not 3"),
                           ("FoamFile\n{\n    format      ascii;\n}\n\n3\n", "not a list of labels")]:
            with open(f, "w") as fh:
                fh.write(text)
            if said is None:
                self.assertEqual(self.tp.read_labels(f, [2]), (3, {2: 3}))
                with self.assertRaisesRegex(ValueError, "has 3 labels, not 4"):
                    self.tp.read_labels(f, [3])
            else:
                with self.assertRaisesRegex(ValueError, said):
                    self.tp.read_labels(f, [0])
        write_labels(f, list(range(12)), binary=True)
        with open(f, "rb") as fh:
            torn = fh.read()[:-120]
        with open(f, "wb") as fh:
            fh.write(torn)
        with self.assertRaisesRegex(ValueError, "not 12 labels of 32 or 64 bits"):
            self.tp.read_labels(f, [0])
        self.assertEqual(self.tp.read_labels(f), (12, {}))         # its length is still at its start

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
        seen, real = [], self.tp.courant_cells

        def failing(into, t, nproc, ntop):
            seen.append(into)
            log = os.path.join(into, "log.foamCourantCells")
            with open(log, "w") as f:
                f.write("--> FOAM FATAL ERROR:\ncannot find phi\n")
            return 1, log
        self.tp.courant_cells = failing
        try:
            with self.assertRaisesRegex(RuntimeError, r"foamCourantCells failed \(exit 1\).*cannot find phi"):
                self.tp.plan(self.case)
        finally:
            self.tp.courant_cells = real
        self.assertFalse(os.path.exists(seen[0]))

    @property
    def schema(self):
        import schema
        return schema


class TransientPlanJobTest(unittest.TestCase):
    """The transient plan as a job (POST /api/v1/jobs, kind "tplan") and its answer (GET /api/v1/tplans/{name}),
    with the job runner and OpenFOAM stood in for."""

    def setUp(self):
        import api_v1, jobs, tplan
        self.api, self.jobs, self.tp = api_v1, jobs, tplan
        self.d = tempfile.mkdtemp(prefix="tplan_job_test_")
        self.addCleanup(shutil.rmtree, self.d, True)
        self.cases, self.ws = os.path.join(self.d, "cases"), os.path.join(self.d, "work")
        os.makedirs(self.cases)
        env = mock.patch.dict(os.environ, {"MESHDOCTOR_CASES": self.cases, "MESHDOCTOR_WORKSPACE": self.ws})
        env.start()
        self.addCleanup(env.stop)
        self.launched, self.ram = [], []
        for obj, attr, value in ((jobs, "_spawn", lambda argv: self.launched.append(argv) or 2 ** 22 + 9),
                                 (jobs, "solver_running", lambda: False),
                                 (jobs.ramguard, "check", lambda case, kind: self.ram.append((case, kind)) or (True, ""))):
            patcher = mock.patch.object(obj, attr, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def solved(self, name, nproc=2):
        """A case solved to iteration 300 on `nproc` processes: its face flux phi written there, as a run's is."""
        case = os.path.join(self.cases, name)
        os.makedirs(os.path.join(case, "system"))
        with open(os.path.join(case, "system", "controlDict"), "w") as f:
            f.write("deltaT          1;\n")
        for p in range(nproc):
            os.makedirs(os.path.join(case, f"processor{p}", "300"))
            open(os.path.join(case, f"processor{p}", "300", "phi"), "w").close()
        return case

    def post(self, params):
        return self.api.handle("POST", "/api/v1/jobs", {}, json.dumps({"kind": "tplan", "params": params}).encode(),
                               "application/json")

    def get(self, name):
        st, doc, _ = self.api.handle("GET", f"/api/v1/tplans/{name}", {})
        return st, doc

    @staticmethod
    def text(path):
        with open(path) as f:
            return f.read()

    def test_a_tplan_job_plans_a_solved_case_from_its_latest_result_and_needs_memory_for_it(self):
        case = self.solved("ahmed")
        st, job, _ = self.post({"name": "ahmed"})
        self.assertEqual(st, 202, job)
        self.assertEqual((job["kind"], job["name"], job["params"]), ("tplan", "ahmed", {"name": "ahmed"}))
        self.assertEqual((job["log"], job["result"]), (".tplans/ahmed.log", ".tplans/ahmed.json"))
        self.assertEqual(job["links"]["tplan"], "/api/v1/tplans/ahmed")
        self.assertEqual(self.ram, [(case, "post")])                  # foamPostProcess's memory, on its mesh
        argv = self.launched[0]
        self.assertEqual(argv[argv.index("--") + 1:], [sys.executable, os.path.join(self.tp.PKG, "tplan.py"), case,
                                                       "-o", os.path.join(self.ws, ".tplans", "ahmed.json"),
                                                       "--sets", os.path.join(self.ws, ".tplans", "ahmed.sets")])
        self.solved("wing")
        st, doc, _ = self.post({"name": "wing"})                          # one big job at a time
        self.assertEqual((st, doc["error"]["code"]), (409, "busy"))
        self.assertEqual(len(self.launched), 1)

    def test_a_case_with_no_result_or_none_there_is_refused_and_nothing_starts(self):
        fresh = os.path.join(self.cases, "fresh")
        for sub in ("system", "0", "processor0/0"):                       # its initial fields only
            os.makedirs(os.path.join(fresh, sub))
        with open(os.path.join(fresh, "system", "controlDict"), "w") as f:
            f.write("deltaT 1;\n")
        for params, code, said in [
                ({"name": "fresh"}, 409, "fresh has no solved result to plan from (a written time with its face "
                                         "flux, phi): solve it first"),
                ({"name": "nope"}, 404, "no case nope in the cases folder"),
                ({"name": "../x"}, 400, None), ({}, 400, None), ({"name": "fresh", "co": [1]}, 400, None)]:
            st, doc, _ = self.post(params)
            self.assertEqual(st, code, (params, doc))
            if said:
                self.assertEqual(doc["error"]["message"], said)
        self.assertEqual(self.launched, [])

    def test_the_command_writes_the_plan_whole_the_route_answers_it_and_a_failed_plan_keeps_it(self):
        case = self.solved("ahmed")
        self.assertEqual(self.get("ahmed"), (404, {"error": {"code": "not-found",
                                                             "message": "no transient plan of ahmed: a tplan job makes one"}}))
        os.makedirs(os.path.join(self.ws, ".tplans"))
        out = self.tp.plan_file("ahmed")

        def courant_cells(into, t, nproc, ntop):     # foamCourantCells' answer: 10 cells a processor, one fast
            for p in range(nproc):
                write_cells(os.path.join(into, f"processor{p}"),
                            [(1.0, (0.5 * i, 0.0, 0.0), 1e-6, 1.0, 0.0, -1, -1, "-") for i in range(9)]
                            + [(50.0 * (p + 1), (4.5, 0.0, 0.0), 1e-6, 1.0, 0.0, -1, -1, "-")], 100.0, ntop)
            log = os.path.join(into, "log.foamCourantCells")
            open(log, "w").close()
            return 0, log

        sets = self.tp.sets_dir("ahmed")
        with mock.patch.object(self.tp, "courant_cells", courant_cells), contextlib.redirect_stderr(io.StringIO()):
            self.tp.main([case, "-o", out, "--sets", sets])
        # nothing half-written left beside them
        self.assertEqual(sorted(os.listdir(os.path.dirname(out))), ["ahmed.json", "ahmed.sets"])
        st, doc = self.get("ahmed")
        self.assertEqual(st, 200, doc)
        import schema
        self.assertEqual(schema.validate(doc, "tplan"), [])
        self.assertEqual((doc["case"], doc["time"], doc["cells"], doc["processors"]), ("ahmed", "300", 20, 2))
        self.assertEqual(doc["courantPerSecond"]["max"], 100.0)
        self.assertEqual([o["maxCo"] for o in doc["options"]], [1.0, 5.0, 20.0])
        self.assertAlmostEqual(doc["options"][0]["deltaT"], 0.01)
        # its 19 fastest cells (all but one of them) as the cell set fastestCells, on each processor only, as the
        # case has no whole mesh, which a note says
        self.assertEqual(doc["cellSet"], {"name": "fastestCells", "cells": 19, "whole": False})
        self.assertEqual(sorted(os.listdir(sets)), [".meshdoctor-sets", "processor0", "processor1"])
        self.assertEqual(doc["notes"][-1], "The cell set fastestCells is on each processor only, not on the whole "
                                           "mesh: the case has no whole mesh (constant/polyMesh).")
        n = 0
        for p in (0, 1):
            with open(os.path.join(sets, f"processor{p}", "constant", "polyMesh", "sets", "fastestCells")) as f:
                n += int(f.read().split("}\n\n")[1].split("\n")[0])
        self.assertEqual(n, 19)
        # with the whole mesh it was split from (processor0 the even cells, processor1 the odd), there too
        write_owner(os.path.join(case, "constant", "polyMesh"), 20)
        for p in (0, 1):
            write_owner(os.path.join(case, f"processor{p}", "constant", "polyMesh"), 10)
            write_labels(os.path.join(case, f"processor{p}", "constant", "polyMesh", "cellProcAddressing"),
                         list(range(p, 20, 2)))
        with mock.patch.object(self.tp, "courant_cells", courant_cells), contextlib.redirect_stderr(io.StringIO()):
            self.tp.main([case, "-o", out, "--sets", sets])
        st, doc = self.get("ahmed")
        self.assertEqual((st, doc["cellSet"]), (200, {"name": "fastestCells", "cells": 19, "whole": True}))
        self.assertNotIn("The cell set", " ".join(doc["notes"]))
        self.assertEqual(sorted(os.listdir(sets)), [".meshdoctor-sets", "constant", "processor0", "processor1"])
        with open(os.path.join(sets, "constant", "polyMesh", "sets", "fastestCells")) as f:
            self.assertTrue(f.read().endswith("}\n\n19\n(\n" + "".join(
                f"{c}\n" for c in sorted(2 * cell + p for p, cell in doc["fastestCells"])) + ")\n"))

        def failing(into, t, nproc, ntop):
            log = os.path.join(into, "log.foamCourantCells")
            with open(log, "w") as f:
                f.write("--> FOAM FATAL ERROR:\ncannot find phi\n")
            return 1, log

        before = self.text(out)
        with mock.patch.object(self.tp, "courant_cells", failing), contextlib.redirect_stderr(io.StringIO()), \
                self.assertRaisesRegex(SystemExit, "foamCourantCells failed"):
            self.tp.main([case, "-o", out, "--sets", sets])
        self.assertEqual((self.text(out), sorted(os.listdir(os.path.dirname(out)))),
                         (before, ["ahmed.json", "ahmed.sets"]))

    def test_the_route_says_plainly_when_there_is_no_plan_a_torn_one_a_newer_one_or_a_bad_name(self):
        os.makedirs(os.path.join(self.ws, ".tplans"))
        with open(self.tp.plan_file("later"), "w") as f:
            json.dump({"schemaVersion": "2.0", "case": "later"}, f)
        with open(self.tp.plan_file("torn"), "w") as f:
            f.write('{"schemaVersion": "1.0", "ca')
        for name, code, said in [("nope", 404, "no transient plan of nope: a tplan job makes one"),
                                 ("torn", 404, "no transient plan of torn: a tplan job makes one"),
                                 ("later", 409, "the transient plan of later: "), (".x", 400, None)]:
            st, doc = self.get(name)
            self.assertEqual(st, code, (name, doc))
            if said:
                self.assertIn(said, doc["error"]["message"])
                self.assertNotIn(self.d, doc["error"]["message"])


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
        self.assertEqual(self.get("/cases")[:2], (200, {"items": ["c1"], "cells": {"c1": None}, "made": {},
                                                        "results": {"c1": None}}))
        with open(os.path.join(self.src, "constant", "polyMesh", "owner"), "w") as f:
            f.write("FoamFile\n{\n    note \"nPoints:1200 nCells:1000 nFaces:3400 nInternalFaces:2600\";\n}\n")
        self.assertEqual(self.get("/cases")[1]["cells"], {"c1": 1000})
        st, doc, _ = self.get("/repairs/r1")
        self.assertEqual((st, doc["source"]), (200, self.src))
        self.assertEqual(self.get("/repairs")[1]["items"][0]["name"], "r1")

    def test_cases_say_each_ones_latest_result(self):
        # A written time with its face flux, the latest, which a transient plan starts from; processor0's when it's split
        self.assertEqual(self.get("/cases")[1]["results"], {"c1": None})
        for t in ("100", "300"):
            os.makedirs(os.path.join(self.src, t))
            open(os.path.join(self.src, t, "phi"), "w").close()
        os.makedirs(os.path.join(self.src, "500"))                      # a time with no flux isn't a result
        self.assertEqual(self.get("/cases")[1]["results"], {"c1": "300"})
        os.makedirs(os.path.join(self.src, "processor0", "400"))
        open(os.path.join(self.src, "processor0", "400", "phi.gz"), "w").close()
        self.assertEqual(self.get("/cases")[1]["results"], {"c1": "400"})
        self.assertNotIn(self.src, json.dumps(self.get("/cases")[1]))     # never this machine's folders
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
        # a window is a number of iterations (or time steps), or auto (API 1.11)
        for bad in ("abc", 5, 100001, 2.5, "Auto", "auto1", ""):
            self.assertError(self.get("/judge", case="c1", window=bad), 400, "bad-request",
                             "window must be a whole number from 10 to 100000 or auto")
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

    def disk_case(self):
        """c1 with a mesh of 6 MB (points 2, faces 3, owner 1: sparse files), and r1's A/B test with a second run at
        iteration 400 on a mesh of 1 MB (for running it longer), whose first run a variant can reuse."""
        import diskguard
        for name, mb in (("points", 2), ("faces", 3), ("owner", 1)):
            sparse(os.path.join(self.src, "constant", "polyMesh", name), mb * diskguard.MB)

    def disk_ab(self):
        import diskguard
        ab = os.path.join(self.d, "work", "r1_ab")
        for t in ("0", "200", "400"):
            os.makedirs(os.path.join(ab, "fixed", "processor0", t))
        sparse(os.path.join(ab, "fixed", "constant", "polyMesh", "points"), diskguard.MB)
        self.schema.write(os.path.join(ab, "ab_result.json"), {"source": self.src, "iters": 200, "init": "0",
                          "base": {"forces": {}}, "fixed": {"forces": {}}, "extensions": [{"from": "200", "to": 400}]},
                          "abtest")

    def test_a_repair_an_ab_test_and_running_it_longer_are_refused_when_they_wont_fit_on_the_disk(self):
        import diskguard
        keep = diskguard.KEEP_MB
        self.disk_case()
        # the copy (6 MB) and its points' backup (2 MB), and the sets and room to collapse faces of its 6 MB mesh
        # (6 x 2.03 = 12.18: 13 MB); the A/B test's two runs: each a copy (6 MB), its split and two written times
        # (6 x 2.65 = 15.9: 16 MB); and running its second run longer from 400 to 600: one time, split, of 1 MB
        repair = {"kind": "repair", "params": {"source": "c1", "name": "r2"}}
        for job, what, mb in ((repair, "the copy of c1 and its repair need", 8 + 13),
                              ({"kind": "abtest", "params": {"name": "r1"}}, "the A/B test r1 needs", 2 * (6 + 16)),
                              ({"kind": "abextend", "params": {"name": "r1", "to": 600}},
                               "running r1's second run longer needs", 1)):
            if job["kind"] == "abextend":
                self.disk_ab()
            with mock.patch.object(diskguard, "free_mb", lambda folder: mb + keep - 1):
                self.assertError(self.post("/jobs", job), 409, "not-enough-disk",
                                 f"{what} about {mb} MB, and the disk has {diskguard.text(mb + keep - 1)} free (the "
                                 "engine keeps 1.0 GB free)")
        self.assertEqual(self.launched, [])
        self.assertFalse(os.path.exists(os.path.join(self.d, "work", "r2")))
        with mock.patch.object(diskguard, "free_mb", lambda folder: 21 + keep):
            st, doc, _ = self.post("/jobs", repair)
        self.assertEqual(st, 202, doc)

    def test_the_disk_routes_say_what_a_repair_an_ab_test_and_running_it_longer_write(self):
        import diskguard
        self.disk_case()
        with mock.patch.object(diskguard, "free_mb", lambda folder: 5000):
            self.assertEqual(self.get("/disk/repair", source="c1")[:2],
                             (200, {"needMb": 21, "freeMb": 5000, "keepMb": 1024, "folder": "workspace"}))
            st, doc, _ = self.get("/disk/abtest", name="r1")
            self.assertEqual((st, doc), (200, {"needMb": 44, "freeMb": 5000, "keepMb": 1024, "folder": "workspace"}))
            self.assertEqual(self.get("/disk/abtest", name="r1", variant="simplec")[1]["needMb"], 44)
            self.disk_ab()                                    # an earlier test whose first run the variant reuses
            self.assertEqual(self.get("/disk/abtest", name="r1", variant="simplec")[1]["needMb"], 22)
            self.assertEqual(self.get("/disk/abtest", name="r1", iters=400, variant="simplec")[1]["needMb"], 44)
            self.assertEqual(self.get("/disk/abextend", name="r1", to=600)[:2],
                             (200, {"needMb": 1, "freeMb": 5000, "keepMb": 1024, "folder": "workspace"}))
            self.assertEqual(self.get("/disk/abextend", name="r1", to=5000)[1]["needMb"], 2)   # at 2500 and 5000
        for path, q, status, code, text in (
                ("/disk/repair", {"source": "c9"}, 404, "not-found", "unknown source case"),
                ("/disk/repair", {"source": "../x"}, 400, "bad-request", "source"),
                ("/disk/repair", {}, 400, "bad-request", "missing query parameter source"),
                ("/disk/abtest", {"name": "nope"}, 409, "not-ready", "repair run not finished"),
                ("/disk/abtest", {"name": "r1", "init": "0.cold"}, 400, "bad-request", "no 0.cold directory"),
                ("/disk/abtest", {"name": "r1", "iters": "many"}, 400, "bad-request", "iters"),
                ("/disk/abtest", {"name": "r1", "variant": "nope"}, 400, "bad-request", "unknown variant"),
                ("/disk/abextend", {"name": "r1"}, 400, "bad-request", "missing query parameter to"),
                ("/disk/abextend", {"name": "r1", "to": 400}, 400, "bad-request", "between 401 and 5000"),
                ("/disk/abextend", {"name": "c1", "to": 600}, 409, "not-ready", "A/B not finished")):
            self.assertError(self.get(path, **q), status, code, text)
        self.assertEqual(self.launched, [])
        doc = self.get("/openapi.json")[1]                    # each query parameter as its job takes it
        query = lambda path: {p["name"]: p for p in doc["paths"][path]["get"]["parameters"]}
        self.assertEqual(query("/disk/abtest")["iters"]["schema"],
                         self.api.JOBS["abtest"]["params"]["properties"]["iters"])
        for path, required in (("/disk/repair", ["source"]), ("/disk/abtest", ["name"]),
                               ("/disk/abextend", ["name", "to"]), ("/disk/case", ["template"])):
            self.assertEqual([n for n, p in query(path).items() if p["required"]], required, path)

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

    # As the real one: blockMesh writes the background mesh, which snappyHexMesh then turns into the case's mesh.
    ALLMESH = """#!/bin/sh
cd "${0%/*}" || exit 1
: > log.surfaceFeatures
: > log.blockMesh
mkdir -p constant/polyMesh
printf 'FoamFile\\n{\\n    note "nPoints:90 nCells:48 nFaces:200 nInternalFaces:150";\\n}\\n' > constant/polyMesh/owner
printf 'Refinement phase\\n' > log.snappyHexMesh
[ -n "$MD_TEST_FAIL" ] && exit 1
printf 'Morphing phase\\nShrinking and layer addition phase\\n' >> log.snappyHexMesh
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

    def test_the_disk_guard_checks_the_mesh_the_job_will_make_and_its_sets(self):
        import diskguard
        keep, coarse = diskguard.KEEP_MB, {"template": "ahmed-body", "size": "coarse"}
        with mock.patch.object(diskguard, "free_mb", lambda folder: 68 + keep - 1):        # 65.6 MB of mesh, and 3 %
            self.assertRefused(self.post(dict(coarse, name="a")), 409, "not-enough-disk", "a's mesh needs about 68 MB")
            st, doc, _ = self.api.handle("GET", "/api/v1/disk/case", coarse)
        self.assertEqual((st, doc), (200, {"needMb": 68, "freeMb": 68 + keep - 1, "keepMb": keep, "folder": "cases"}))
        st, doc, _ = self.api.handle("GET", "/api/v1/disk/case", {"template": "ahmed-body"})      # medium, the default
        self.assertEqual((st, doc["needMb"]),
                         (200, diskguard.made_mb(self.t.TEMPLATES["ahmed-body"]["sizes"]["medium"]["cells"])))
        for q, status, code, text in (({"template": "nope"}, 404, "not-found", "no template nope"),
                                      ({"template": "wheel-wing", "size": "coarse"}, 400, "bad-request",
                                       "has no coarse mesh"),
                                      ({"template": "../x"}, 400, "bad-request", "template"),
                                      ({}, 400, "bad-request", "missing query parameter template")):
            self.assertRefused(self.api.handle("GET", "/api/v1/disk/case", q), status, code, text)
        self.assertEqual(self.launched, [])
        with mock.patch.object(diskguard, "free_mb", lambda folder: 68 + keep):
            self.assertEqual(self.post(dict(coarse, name="a"))[0], 202)
        # the command checks it too, once the memory is checked
        with mock.patch.object(self.t.ramguard, "check_cells", lambda cells, step: (True, "")), \
                mock.patch.object(diskguard, "free_mb", lambda folder: 68 + keep - 1), \
                self.assertRaises(SystemExit) as e:
            self.t.main(["ahmed-body", "a2", "--size", "coarse"])
        self.assertTrue(str(e.exception).startswith("not enough disk space: a2's mesh needs about 68 MB"), e.exception)
        self.assertFalse(os.path.exists(os.path.join(self.cases, "a2")))

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
        self.assertEqual((rc, lines[-1]),
                         (1, "the mesh failed at snappyHexMesh: see log.snappyHexMesh in the case's folder"))
        with open(os.path.join(self.cases, "a2", self.t.MARKER)) as f:
            self.assertEqual(json.load(f)["state"], "failed")
        # blockMesh's background mesh is there, but it isn't a case: not on Cases, and no repair takes it.
        self.assertTrue(os.path.isfile(os.path.join(self.cases, "a2", "constant", "polyMesh", "owner")))
        self.assertNotIn("a2", self.api.handle("GET", "/api/v1/cases", {})[1]["items"])
        st, doc, _ = self.api.handle("POST", "/api/v1/jobs", {}, json.dumps(
            {"kind": "repair", "params": {"source": "a2", "name": "a2-fix"}}).encode(), "application/json")
        self.assertEqual((st, doc["error"]["code"]), (404, "not-found"), doc)
        rc, lines = self.make("ahmed-body", "a2", "medium")
        self.assertEqual(rc, 1)
        self.assertIn("replace it", lines[-1])
        rc, lines = self.make("ahmed-body", "a2", "medium", replace=True)
        self.assertEqual((rc, lines[0]), (0, "replacing a2, which a template made here before"))
        with open(os.path.join(self.cases, "a2", "system", "blockMeshDict")) as f:
            self.assertIn("(130 15 15)", f.read())                                       # medium: the template's own
        self.assertIn("a2", self.api.handle("GET", "/api/v1/cases", {})[1]["items"])    # made now

    def test_a_new_case_is_listed_once_it_is_made_and_a_case_you_made_always(self):
        import md_api
        for name, marker in (("yours", None), ("making", '{"state": "running"}'), ("failed", '{"state": "failed"}'),
                             ("stopped", '{"state": "cancelled"}'), ("garbled", "{"), ("made", '{"state": "done"}')):
            mesh = os.path.join(self.cases, name, "constant", "polyMesh")
            os.makedirs(mesh)
            open(os.path.join(mesh, "owner"), "w").close()
            if marker is not None:
                with open(os.path.join(self.cases, name, self.t.MARKER), "w") as f:
                    f.write(marker)
        self.assertEqual(md_api.sources(), ["made", "yours"])

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
        status = self.t.Status(case, template="ahmed-body", size="medium")
        status.step("snappyHexMesh: snapping")
        job = {"kind": "case", "name": "p", "created": "2000-01-01T00:00:00Z"}
        self.assertEqual(self.jobs.progress(job, os.path.join(self.d, "work"))["fraction"], 0.25)

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


class SolveTest(unittest.TestCase):
    """solve.py: a solve job's checks, and solving, continuing and stopping with stand-in OpenFOAM programs, so
    neither OpenFOAM nor a mesh is needed."""

    PROGRAMS = {
        "decomposePar": """#!/bin/sh
# As OpenFOAM reads it: the keyword, then a space, then the value.
n=$(sed -n 's/^numberOfSubdomains[ \\t][ \\t]*\\([0-9]*\\);.*/\\1/p' system/decomposeParDict)
[ -n "$n" ] || { echo "keyword numberOfSubdomains is undefined"; exit 1; }
i=0; while [ "$i" -lt "$n" ]; do mkdir -p "processor$i/0"; i=$((i+1)); done
""",
        "mpirun": """#!/bin/sh
while [ "$1" = "--oversubscribe" ] || [ "$1" = "-np" ]; do [ "$1" = "-np" ] && shift; shift; done
exec "$@"
""",
        "potentialFoam": "#!/bin/sh\necho potentialFoam\n",
        "reconstructPar": "#!/bin/sh\necho reconstructPar\n",
        # From the latest written time to endTime; a Stop (stopAt writeNow) ends it after the iteration it is at.
        "foamRun": """#!/bin/sh
end=$(sed -n 's/^endTime[ \\t]*\\([0-9]*\\);.*/\\1/p' system/controlDict)
where=.; [ -d processor0 ] && where=processor0
i=$(ls "$where" | grep -E '^[0-9]+$' | sort -n | tail -1)
while [ "$i" -lt "$end" ]; do
    i=$((i+1)); echo "Time = $i"; echo
    [ -n "$MD_TEST_SLOW" ] && sleep 0.05
    [ "$i" = "$MD_TEST_STOP_AT" ] && sed -i 's/^stopAt .*/stopAt writeNow;/' system/controlDict
    grep -q '^stopAt[ \\t]*writeNow' system/controlDict && break
done
for d in processor*; do [ -d "$d" ] && mkdir -p "$d/$i"; done
[ -d processor0 ] || mkdir -p "$i"
[ -n "$MD_TEST_FAIL" ] && { echo "--> FOAM FATAL ERROR: stand-in"; exit 1; }
echo End
""",
    }
    CONTROL = ("application     foamRun;\nstartFrom       startTime;\nstopAt          endTime;\nendTime         2000;\n"
               "writeControl    timeStep;\nwriteInterval   500;\npurgeWrite      2;\nfunctions\n{\n    writeInterval 1;\n}\n")

    def setUp(self):
        import api_v1, jobs, solve
        self.api, self.jobs, self.s = api_v1, jobs, solve
        self.d = tempfile.mkdtemp(prefix="solve_test_")
        self.addCleanup(shutil.rmtree, self.d, True)
        self.cases = os.path.join(self.d, "cases")
        os.makedirs(self.cases)
        bin_ = os.path.join(self.d, "bin")
        os.makedirs(bin_)
        for name, text in self.PROGRAMS.items():
            with open(os.path.join(bin_, name), "w") as f:
                f.write(text)
            os.chmod(os.path.join(bin_, name), 0o755)
        bashrc = os.path.join(self.d, "bashrc")
        with open(bashrc, "w") as f:
            f.write(f"export WM_PROJECT_DIR=/nowhere\nexport PATH={bin_}:$PATH\n")
        env = mock.patch.dict(os.environ, {"MESHDOCTOR_CASES": self.cases, "MD_TEST_FAIL": "", "MD_TEST_STOP_AT": "",
                                           "MESHDOCTOR_WORKSPACE": os.path.join(self.d, "work"),
                                           "MESHDOCTOR_FOAM_BASHRC": bashrc})
        env.start()
        self.addCleanup(env.stop)
        self.launched = []
        for obj, attr, value in ((jobs, "_spawn", lambda argv: self.launched.append(argv) or 2 ** 22 + 7),
                                 (jobs, "solver_running", lambda: False), (solve, "POLL_S", 0.05)):
            patcher = mock.patch.object(obj, attr, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.case("made", {"state": "done", "template": "ahmed-body"})
        self.case("mine", None)
        self.case("half", {"state": "failed"})

    def case(self, name, marker):
        c = os.path.join(self.cases, name)
        for sub in ("system", "0", "constant/polyMesh"):
            os.makedirs(os.path.join(c, sub))
        with open(os.path.join(c, "system", "controlDict"), "w") as f:
            f.write(self.CONTROL)
        with open(os.path.join(c, "system", "decomposeParDict"), "w") as f:
            f.write("numberOfSubdomains 4;\ndecomposer      hierarchical;\n")
        with open(os.path.join(c, "constant", "polyMesh", "owner"), "w") as f:
            f.write('FoamFile\n{\n    note "nPoints:900 nCells:480 nFaces:2000 nInternalFaces:1500";\n}\n')
        if marker is not None:
            with open(os.path.join(c, self.jobs.CASE_MARKER), "w") as f:
                json.dump(marker, f)

    def post(self, params):
        return self.api.handle("POST", "/api/v1/jobs", {}, json.dumps({"kind": "solve", "params": params}).encode(),
                               "application/json")

    def yours(self, name="yours", **changes):
        """A case you made and solved by hand: beside its mesh and settings, its results, its split, its logs and what
        its function objects wrote, none of which a copy takes.  A change of None removes that file or folder."""
        self.case(name, None)
        c = os.path.join(self.cases, name)
        files = {"system/controlDict": self.CONTROL + "solver          incompressibleFluid;\n",
                 "system/fvSchemes": "ddtSchemes\n{\n    default         steadyState; // SIMPLE\n}\n",
                 "0/U": "internalField uniform (40 0 0);\n", "constant/momentumTransport": "simulationType RAS;\n",
                 "Allrun": "#!/bin/sh\n", "100/U": "a result\n", "processor0/100/U": "a split result\n",
                 "postProcessing/forces/0/forces.dat": "100 40 -170\n", "log.foamRun": "Time = 100\n", **changes}
        for rel, text in files.items():
            path = os.path.join(c, rel)
            if text is None:
                if os.path.isdir(path):
                    shutil.rmtree(path)
                else:
                    os.remove(path)
                continue
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                f.write(text)
        return c

    @staticmethod
    def tree(root):
        """Every file under root, by its path there, with its text."""
        out = {}
        for d, _, names in os.walk(root):
            for n in names:
                with open(os.path.join(d, n)) as f:
                    out[os.path.relpath(os.path.join(d, n), root).replace(os.sep, "/")] = f.read()
        return out

    def assertRefused(self, answer, status, code, text):
        got, doc, _ = answer
        self.assertEqual((got, doc["error"]["code"]), (status, code), doc)
        self.assertIn(text, doc["error"]["message"])
        self.assertNotIn(self.d, doc["error"]["message"])                   # never this machine's folders

    def solve(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = self.s.run(*args)
        return rc, out.getvalue().strip().splitlines()

    def status(self):
        with open(os.path.join(self.cases, "made", self.jobs.SOLVE_STATUS)) as f:
            return json.load(f)

    def control(self):
        with open(os.path.join(self.cases, "made", "system", "controlDict")) as f:
            return f.read()

    def test_a_solve_job_takes_only_a_case_mesh_doctor_made_and_starts_its_solve(self):
        self.assertRefused(self.post({"name": "mine"}), 422, "unsupported", "never changes")
        self.assertRefused(self.post({"name": "half"}), 409, "not-ready", "no mesh yet")
        self.assertRefused(self.post({"name": "nope"}), 404, "not-found", "no case nope")
        self.assertRefused(self.post({"name": "../x"}), 400, "bad-request", "name")
        with mock.patch.object(self.s.os, "cpu_count", lambda: 8):
            self.assertRefused(self.post({"name": "made", "np": 9}), 400, "bad-request", "8 processors")
        st, doc, _ = self.post({"name": "made", "to": 40, "np": 2})
        self.assertEqual(st, 202, doc)
        self.assertEqual((doc["kind"], doc["params"], doc["log"]), ("solve", {"name": "made", "to": 40, "np": 2},
                                                                    ".runs/made_to_40.log"))
        self.assertEqual(doc["links"]["run"], "/api/v1/runs/made")
        argv = self.launched[0]
        cmd = argv[argv.index("--") + 1:]
        self.assertTrue(cmd[1].endswith("solve.py"), cmd)
        self.assertEqual(cmd[2:], ["run", "made", "--to", "40", "--np", "2"])
        self.assertTrue(os.path.isdir(os.path.join(self.d, "work", ".runs")))    # where its log goes

    def test_the_first_solve_splits_the_case_and_a_later_one_continues_on_its_split(self):
        rc, lines = self.solve("made", 40, 2)
        self.assertEqual(rc, 0, lines)
        self.assertEqual(lines[-1], "made: solved to iteration 40")
        st = self.status()
        self.assertEqual((st["state"], st["iteration"], st["nProcs"], st["stretches"], st["fraction"]),
                         ("done", 40, 2, [{"from": 0, "to": 40}], 1.0))
        text = self.control()
        for line in ("endTime         40;", "writeInterval   10;", "startFrom       latestTime;", "stopAt          endTime;"):
            self.assertIn(line, text)
        self.assertIn("    writeInterval 1;", text)                        # a function object's own is left alone
        self.assertEqual(sorted(n for n in os.listdir(os.path.join(self.cases, "made")) if n.startswith("processor")),
                         ["processor0", "processor1"])
        doc = self.api.handle("GET", "/api/v1/runs/made", {})[1]
        self.assertEqual((doc["state"], doc["written"], doc["links"]["judge"]), ("done", 40, "/api/v1/judge?case=made"))
        self.assertRefused(self.post({"name": "made", "to": 40}), 400, "bad-request", "solved to iteration 40 already")
        rc, lines = self.solve("made", 60, 8)                                  # continues on the run's own 2
        self.assertEqual(rc, 0, lines)
        self.assertEqual(lines[0], "made: continuing from iteration 40 to 60 on 2 processes")
        st = self.status()
        self.assertEqual((st["start"], st["iteration"], st["nProcs"], st["stretches"]),
                         (40, 60, 2, [{"from": 0, "to": 40}, {"from": 40, "to": 60}]))
        self.assertTrue(os.path.isfile(os.path.join(self.cases, "made", "log.foamRun_to_60")))
        items = self.api.handle("GET", "/api/v1/runs", {})[1]["items"]
        self.assertEqual([(r["name"], r["state"], r["iteration"]) for r in items], [("made", "done", 60)])

    def test_stop_ends_the_run_at_a_written_iteration_and_it_continues_from_there(self):
        st, doc, _ = self.api.handle("POST", "/api/v1/runs/made/stop", {})
        self.assertEqual((st, doc["error"]["code"]), (404, "not-found"))       # no run yet
        self.assertEqual(self.solve("made", 30, 1)[0], 0)                      # 1 process: not split
        st, doc, _ = self.api.handle("POST", "/api/v1/runs/made/stop", {})
        self.assertEqual((st, doc["error"]["code"]), (409, "not-ready"))       # not solving now
        path = os.path.join(self.cases, "made", "system", "controlDict")
        read = os.stat(path).st_mtime
        with mock.patch.object(self.s, "solving", lambda name: True):
            st, doc, _ = self.api.handle("POST", "/api/v1/runs/made/stop", {})
        self.assertEqual((st, doc["name"]), (200, "made"))
        self.assertRegex(self.control(), r"(?m)^stopAt\s+writeNow;")
        # OpenFOAM re-reads it only once its time is past the one it read by its fileModificationSkew (10 s), so a
        # Stop moments after a stretch starts moves its time on, past that
        self.assertGreaterEqual(os.stat(path).st_mtime, read + self.s.SKEW_S)
        with mock.patch.dict(os.environ, {"MD_TEST_STOP_AT": "45"}):          # a Stop while it solves
            rc, lines = self.solve("made", 100, 1)
        self.assertEqual((rc, lines[-1]), (0, "made: solved to iteration 45, stopped before 100"))
        st = self.status()
        self.assertEqual((st["state"], st["iteration"], st["stretches"][-1]), ("stopped", 45, {"from": 30, "to": 45}))
        self.assertRegex(self.control(), r"(?m)^stopAt\s+endTime;")             # the next solve runs to its end
        self.assertEqual(self.s.latest(os.path.join(self.cases, "made")), 45)
        self.assertEqual(self.solve("made", 50, 1)[1][0], "made: continuing from iteration 45 to 50")

    def test_a_failed_solve_says_where_and_a_run_whose_job_is_gone_says_interrupted(self):
        with mock.patch.dict(os.environ, {"MD_TEST_FAIL": "1"}):
            rc, lines = self.solve("made", 20, 2)
        self.assertEqual((rc, lines[-1]), (1, "the solve failed at foamRun: see log.foamRun in the case's folder"))
        run = self.api.handle("GET", "/api/v1/runs/made", {})[1]
        self.assertEqual((run["state"], run["error"]), ("failed", lines[-1]))
        self.assertEqual((run["iteration"], run["written"], run["stretches"]), (20, 20, [{"from": 0, "to": 20}]))
        doc = self.status()
        doc["state"] = "running"
        with open(os.path.join(self.cases, "made", self.jobs.SOLVE_STATUS), "w") as f:
            json.dump(doc, f)
        self.assertEqual(self.s.describe("made")["state"], "interrupted")
        job = {"kind": "solve", "name": "made", "created": "2000-01-01T00:00:00Z"}
        doc.update(step="solving", fraction=0.42)
        with open(os.path.join(self.cases, "made", self.jobs.SOLVE_STATUS), "w") as f:
            json.dump(doc, f)
        self.assertEqual(self.jobs.progress(job, os.path.join(self.d, "work"))["fraction"], 0.42)
        self.assertIsNone(self.jobs.progress(dict(job, state="queued"), os.path.join(self.d, "work")))

    def test_a_cancelled_solve_says_so_and_continues_later(self):
        import signal
        env = dict(os.environ, MD_TEST_SLOW="1")                # as a job's cancel: SIGTERM to the whole group
        p = subprocess.Popen([sys.executable, os.path.join(self.s.PKG, "solve.py"), "run", "made", "--to", "1000",
                              "--np", "2"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True)
        try:
            log = os.path.join(self.cases, "made", "log.foamRun")
            for _ in range(400):
                if os.path.isfile(log) and os.path.getsize(log) > 20:
                    break
                time.sleep(0.05)
            os.killpg(p.pid, signal.SIGTERM)
            self.assertEqual(p.wait(timeout=20), 128 + signal.SIGTERM)
        finally:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            p.wait()
        st = self.status()
        self.assertEqual((st["state"], st["stretches"], st["nProcs"]), ("cancelled", [], 2))
        self.assertEqual(self.s.describe("made")["state"], "cancelled")
        case = os.path.join(self.cases, "made")
        self.assertEqual(self.s.split(case), 2)                 # split, but nothing written past iteration 0
        rc, lines = self.solve("made", 10, 1)                   # so it starts again, on the one process asked for
        self.assertEqual((rc, lines[0]), (0, "made: solving from iteration 0 to 10"))
        self.assertEqual((self.s.split(case), self.s.latest(case), self.status()["nProcs"]), (0, 10, 1))
        self.assertTrue(os.path.isfile(os.path.join(case, "log.potentialFoam")))

    def test_a_solve_run_in_a_terminal_says_running_and_keeps_jobs_out_all_through_it(self):
        # It has no job: its status file names its process, which must still be a solve of the case.  Here a stand-in
        # whose command line names one, as meshdoctor solve made's does.
        p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)", "solve", "made"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            case = os.path.join(self.cases, "made")

            def status(**changes):
                doc = {"madeBy": "Mesh Doctor", "state": "running", "step": "solving", "iteration": 0, "start": 0,
                       "end": 100, "nProcs": 2, "started": "2026-11-24T08:00:00Z", "time": "2026-11-24T08:00:00Z",
                       "finished": None, "error": None, "fraction": 0.0, "stretches": [], "pid": p.pid,
                       "pidStart": self.jobs.started(p.pid), **changes}
                with open(os.path.join(case, self.jobs.SOLVE_STATUS), "w") as f:
                    json.dump(doc, f)
            self.assertIsInstance(self.jobs.started(p.pid), int)
            for step in ("decomposing", "potentialFoam", "solving"):    # while it splits the case and starts the flow
                status(step=step)
                self.assertEqual(self.s.describe("made")["state"], "running")
                self.assertEqual(self.jobs.busy(), "made is solving in a terminal; one big job at a time (RAM)")
                st, doc, _ = self.post({"name": "made", "to": 200})
                self.assertEqual((st, doc["error"]["code"]), (409, "busy"))
            st, doc, _ = self.api.handle("POST", "/api/v1/runs/made/stop", {})    # Stop works on it, as on a job's
            self.assertEqual((st, doc["name"], doc["state"]), (200, "made", "running"))
            self.assertRegex(self.control(), r"(?m)^stopAt\s+writeNow;")
            status(step="copying")
            st, doc, _ = self.api.handle("POST", "/api/v1/runs/made/stop", {})
            self.assertEqual((st, doc["error"]["code"]), (409, "not-ready"))
            self.assertTrue(doc["error"]["message"].endswith("(Ctrl+C in its terminal ends it now)"))
            status()
            with self.assertRaises(SystemExit) as e:                    # nor does a second solve of it start
                self.s.main(["made", "--to", "300"])
            self.assertEqual(str(e.exception), "made is solving now: wait for it to end, or stop it")
            # A pid used again, by a process that started later or isn't a solve of the case, isn't taken for it.
            for changes in ({"pidStart": self.jobs.started(p.pid) + 1},
                            {"pid": os.getpid(), "pidStart": self.jobs.started(os.getpid())}, {"pid": None}):
                status(**changes)
                self.assertEqual(self.s.describe("made")["state"], "interrupted")
                self.assertIsNone(self.jobs.busy())
            status()
        finally:
            p.kill()
            p.wait()
        self.assertEqual(self.s.describe("made")["state"], "interrupted")      # its terminal was closed, say
        self.assertIsNone(self.jobs.busy())

    def test_stop_ends_a_solve_run_in_a_terminal_at_the_iteration_it_has_reached(self):
        import signal
        env = dict(os.environ, MD_TEST_SLOW="1")
        p = subprocess.Popen([sys.executable, "-m", "meshdoctor", "solve", "made", "--to", "1000", "--np", "2"],
                             cwd=os.path.dirname(self.s.PKG), env=env, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)
        try:
            log = os.path.join(self.cases, "made", "log.foamRun")
            for _ in range(400):
                if os.path.isfile(log) and os.path.getsize(log) > 20:
                    break
                time.sleep(0.05)
            run = self.s.describe("made")
            self.assertEqual((run["state"], run["step"]), ("running", "solving"))   # no job, yet not interrupted
            self.assertEqual(self.status()["pid"], p.pid)
            self.assertEqual(self.jobs.busy(), "made is solving in a terminal; one big job at a time (RAM)")
            st, doc, _ = self.api.handle("POST", "/api/v1/runs/made/stop", {})
            self.assertEqual(st, 200)
            self.assertEqual(p.wait(timeout=20), 0)
        finally:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            p.wait()
        st = self.status()
        self.assertEqual((st["state"], st["stretches"][-1]["from"]), ("stopped", 0))
        self.assertLess(st["iteration"], 1000)
        self.assertEqual(self.s.latest(os.path.join(self.cases, "made")), st["iteration"])     # and written
        self.assertEqual(self.s.describe("made")["state"], "stopped")
        self.assertIsNone(self.jobs.busy())

    def test_the_cases_say_which_ones_mesh_doctor_made(self):
        self.case("copied", {"state": "done", "copyOf": "mine", "cells": 480})
        doc = self.api.handle("GET", "/api/v1/cases", {})[1]
        self.assertEqual((sorted(doc["items"]), doc["made"]), (
            ["copied", "made", "mine"], {"copied": {"copyOf": "mine"}, "made": {"template": "ahmed-body"}}))

    def test_a_copy_has_the_mesh_and_settings_of_a_case_you_made_and_none_of_its_results(self):
        import templates
        src = self.yours()
        before = self.tree(src)
        dst = os.path.join(self.cases, "copy")
        os.mkdir(dst)
        self.assertEqual(templates.copy(src, dst), 480)
        got = self.tree(dst)
        self.assertEqual(sorted(got), ["0/U", "Allrun", "constant/momentumTransport", "constant/polyMesh/owner",
                                       "system/controlDict", "system/decomposeParDict", "system/fvSchemes"])
        self.assertEqual(got, {k: before[k] for k in got})                  # each file as it is in yours
        self.assertEqual(self.tree(src), before)                            # and yours as it was
        orig = self.yours("orig")                                           # its fields in 0.orig, for its Allrun
        os.rename(os.path.join(orig, "0"), os.path.join(orig, "0.orig"))
        dst = os.path.join(self.cases, "copy2")
        os.mkdir(dst)
        templates.copy(orig, dst)
        self.assertEqual(self.tree(os.path.join(dst, "0")), self.tree(os.path.join(orig, "0.orig")))
        self.assertTrue(os.path.isdir(os.path.join(dst, "0.orig")))
        dst = os.path.join(self.cases, "copy3")                             # a case made here: not its marker
        os.mkdir(dst)
        templates.copy(os.path.join(self.cases, "made"), dst)
        self.assertNotIn(self.jobs.CASE_MARKER, os.listdir(dst))

    def test_a_copy_follows_the_links_in_a_case_you_made_but_none_that_go_round(self):
        import templates
        src = self.yours("linked")
        out = os.path.join(self.d, "outside")
        for rel, text in (("geometry/body.stl", "solid body\n"), ("x/fx", "x\n"), ("y/fy", "y\n")):
            os.makedirs(os.path.dirname(os.path.join(out, rel)), exist_ok=True)
            with open(os.path.join(out, rel), "w") as f:
                f.write(text)
        os.symlink(os.path.join(out, "y"), os.path.join(out, "x", "b"))      # two folders linked to each other
        os.symlink(os.path.join(out, "x"), os.path.join(out, "y", "c"))
        for link, to in (("again", "."), ("constant/up", ".."), ("system/all", self.cases), ("top", self.d),
                         ("ahead", "../copy"), ("constant/geometry", os.path.join(out, "geometry")),
                         ("x", os.path.join(out, "x"))):
            os.symlink(to, os.path.join(src, link))
        dst = os.path.join(self.cases, "copy")
        os.mkdir(dst)
        before = self.tree(src)
        self.assertEqual(templates.copy(src, dst), 480)
        got = self.tree(dst)
        self.assertEqual(sorted(got), ["0/U", "Allrun", "constant/geometry/body.stl", "constant/momentumTransport",
                                       "constant/polyMesh/owner", "system/controlDict", "system/decomposeParDict",
                                       "system/fvSchemes", "x/b/fy", "x/fx"])
        self.assertEqual(got["constant/geometry/body.stl"], "solid body\n")
        self.assertEqual([os.path.join(d, n) for d, ds, fs in os.walk(dst) for n in ds + fs
                          if os.path.islink(os.path.join(d, n))], [])      # files of its own, no links
        self.assertEqual(self.tree(src), before)

    def test_a_case_you_made_is_solved_through_a_copy_of_its_mesh_and_settings(self):
        src = self.yours()
        before = self.tree(src)
        self.assertRefused(self.post({"name": "yours"}), 422, "unsupported", "solve a copy of it")
        self.assertRefused(self.post({"name": "copy", "source": "nope"}), 404, "not-found", "no case nope")
        self.assertRefused(self.post({"name": "copy", "source": "../x"}), 400, "bad-request", "source")
        self.assertRefused(self.post({"name": "made", "source": "yours"}), 409, "exists", "exists already")
        self.assertRefused(self.post({"name": "yours", "source": "yours"}), 409, "exists", "never changed")
        st, doc, _ = self.post({"name": "copy", "source": "yours", "to": 40, "np": 2})
        self.assertEqual(st, 202, doc)
        self.assertEqual((doc["params"], doc["links"]["run"]),
                         ({"name": "copy", "to": 40, "np": 2, "source": "yours"}, "/api/v1/runs/copy"))
        argv = self.launched[0]
        self.assertEqual(argv[argv.index("--") + 1:][2:], ["run", "yours", "copy", "--to", "40", "--np", "2"])

        rc, lines = self.solve("copy", 40, 2, "yours")                     # the job's command
        self.assertEqual((rc, lines[:2]), (0, ["copying yours: its mesh and settings, not its results",
                                               "copied yours: 480 cells"]), lines)
        copy = os.path.join(self.cases, "copy")
        with open(os.path.join(copy, self.jobs.CASE_MARKER)) as f:
            marker = json.load(f)
        self.assertEqual((marker["copyOf"], marker["state"], marker["cells"], "template" in marker),
                         ("yours", "done", 480, False))
        run = self.s.describe("copy")
        self.assertEqual((run["state"], run["written"], run["nProcs"], run["stretches"]),
                         ("done", 40, 2, [{"from": 0, "to": 40}]))
        self.assertFalse(any(os.path.exists(os.path.join(copy, n)) for n in ("100", "postProcessing")))
        control = self.tree(copy)["system/controlDict"]
        self.assertRegex(control, r"(?m)^deltaT\s+1;")                     # its iterations are its times
        self.assertRegex(control, r"(?m)^endTime\s+40;")
        self.assertIn("solver          incompressibleFluid;", control)
        self.assertEqual(self.tree(src), before)                            # yours, as it was
        doc = self.api.handle("GET", "/api/v1/cases", {})[1]
        self.assertEqual((doc["made"]["copy"], doc["cells"]["copy"]), ({"copyOf": "yours"}, 480))
        self.assertIsNone(self.s.refusal("copy", 60))                       # then continued as any case made here
        self.assertIn("solved to iteration 40 already", self.s.refusal("copy", 40)[1])

    def test_a_copy_of_a_case_with_no_split_dictionary_gets_one_openfoam_reads(self):
        self.yours(**{"system/decomposeParDict": None})
        rc, lines = self.solve("copy", 20, 2, "yours")
        self.assertEqual(rc, 0, lines)
        text = self.tree(os.path.join(self.cases, "copy"))["system/decomposeParDict"]
        self.assertTrue(text.startswith("FoamFile\n{"), text)
        for entry in (r"numberOfSubdomains[ \t]+2;", r"decomposer[ \t]+scotch;", r"method[ \t]+scotch;"):
            self.assertRegex(text, r"(?m)^" + entry + "$")
        self.assertEqual((self.s.describe("copy")["state"], self.s.describe("copy")["nProcs"]), ("done", 2))
        self.assertTrue(os.path.isdir(os.path.join(self.cases, "copy", "processor1")))
        self.assertFalse(os.path.exists(os.path.join(self.cases, "yours", "system", "decomposeParDict")))

    def test_a_copy_needs_a_joined_mesh_initial_fields_and_a_steady_foamrun_setup(self):
        self.yours()
        self.yours("nomesh", **{"constant/polyMesh/owner": None})
        self.yours("split", **{"constant/polyMesh/owner": None, "processor0/constant/polyMesh/owner": "x\n"})
        self.yours("nozero", **{"0": None})
        self.yours("nosolver", **{"system/controlDict": self.CONTROL + "// solver incompressibleFluid;\n"})
        self.yours("transient", **{"system/fvSchemes": "ddtSchemes\n{\n    default         Euler;\n}\n"})
        for source, status, code, text in (
                ("nomesh", 409, "not-ready", "has no mesh (constant/polyMesh)"),
                ("split", 409, "not-ready", "join it first (reconstructParMesh)"),
                ("nozero", 422, "unsupported", "no initial fields"),
                ("nosolver", 422, "unsupported", "names no solver"),
                ("transient", 422, "unsupported", "transient case"),
                ("half", 409, "not-ready", "no mesh yet")):
            self.assertRefused(self.post({"name": "copy", "source": source}), status, code, text)
        with mock.patch.object(self.s.os, "cpu_count", lambda: 8):
            self.assertRefused(self.post({"name": "copy", "source": "yours", "np": 9}), 400, "bad-request",
                               "8 processors")
        self.assertEqual(self.launched, [])

    def test_a_copy_cut_short_leaves_no_case_and_waits_to_be_stopped_until_it_solves(self):
        import templates
        self.yours()
        copy = os.path.join(self.cases, "copy")
        err = self.s.shutil.Error([("from", "to", "[Errno 13] Permission denied: 'to'")])
        for fails, said in ((OSError(28, "No space left on device"), "No space left on device"),
                            (err, "Permission denied")):
            with mock.patch.object(templates, "copy", side_effect=fails):
                rc, lines = self.solve("copy", 40, 2, "yours")
            self.assertEqual((rc, lines[-1]), (1, f"the copy of yours failed: {said}"))
            self.assertFalse(os.path.lexists(copy))                         # so the name is free again
        with mock.patch.object(templates, "copy", side_effect=KeyboardInterrupt):
            rc, lines = self.solve("copy", 40, 2, "yours")
        self.assertEqual((rc, lines[-1], os.path.lexists(copy)), (130, "stopped", False))
        seen = {}

        def copying(src, case):                                             # what its run says while it copies
            with mock.patch.object(self.s, "solving", lambda n: True):
                seen["run"], seen["stop"] = self.s.describe("copy"), self.s.stop("copy")
            raise OSError(28, "No space left on device")
        with mock.patch.object(templates, "copy", copying):
            self.solve("copy", 40, 2, "yours")
        self.assertEqual((seen["run"]["state"], seen["run"]["step"], seen["run"]["written"]), ("running", "copying", 0))
        self.assertEqual(seen["stop"][1][0], "not-ready")
        self.assertIn("is being copied", seen["stop"][1][1])

    def test_the_command_solves_a_copy_of_a_case_you_made(self):
        self.yours()
        with self.assertRaises(SystemExit) as e:
            self.s.main(["yours", "made", "--to", "10"])
        self.assertIn("exists already", str(e.exception))
        asked, out = [], io.StringIO()
        with mock.patch.object(self.s.ramguard, "check", lambda case, step: asked.append((case, step)) or (True, "")), \
                contextlib.redirect_stdout(out):
            rc = self.s.main(["yours", "copy", "--to", "10", "--np", "1"])
        self.assertEqual(rc, 0, out.getvalue())
        self.assertEqual(asked, [(os.path.join(self.cases, "yours"), "solve")])     # the memory of yours' mesh
        self.assertEqual((self.s.describe("copy")["written"], self.s.split(os.path.join(self.cases, "copy"))), (10, 0))

    def test_a_runs_live_page_data_follows_its_stretches(self):
        saved = dict(self.api._live)                                            # before server.py adds its own
        import schema, server
        self.api.provide(run_live=server.solve_live)
        self.addCleanup(lambda: (self.api._live.clear(), self.api._live.update(saved)))
        self.addCleanup(server._solve_cache.clear)

        def live():
            server._solve_cache.clear()
            return self.api.handle("GET", "/api/v1/runs/made/live", {})
        st, doc, _ = live()
        self.assertEqual((st, doc["error"]["code"]), (404, "not-found"))       # not solved yet
        self.assertEqual(self.solve("made", 30, 1)[0], 0)
        case = os.path.join(self.cases, "made")
        write_steady_run(case, 30, lambda t: 1e-3 / t, lambda t: 50.0)        # a solver log and forces as foamRun's
        with open(os.path.join(case, "log.foamRun"), "a") as f:
            f.write("End\n")
        st, doc, _ = live()
        self.assertEqual(st, 200, doc)
        self.assertEqual(schema.check(doc, self.api.RUN_LIVE), [])
        self.assertEqual((doc["run"]["state"], doc["stages"], doc["current"]["to"]),
                         ("done", [{"name": "First solve", "from": 0, "to": 30}], 30))
        self.assertEqual((doc["solver"]["state"], doc["solver"]["iteration"], doc["solver"]["end"]), ("done", 30.0, 30))
        self.assertEqual((doc["residuals"]["cols"], len(doc["residuals"]["rows"])), (["Time", "p"], 30))
        self.assertIsInstance(doc["forces"], dict)
        self.assertIn("verdict", doc["judge"])
        # A continuation solving now: its stretch comes last, read from its own log.
        status = self.status()
        status.update(state="running", start=30, end=60, iteration=45)
        with open(os.path.join(case, self.jobs.SOLVE_STATUS), "w") as f:
            json.dump(status, f)
        with open(os.path.join(case, "log.foamRun_to_60"), "w") as f:
            f.write("".join(f"Time = {t}\n\n" for t in range(31, 46)))
        with mock.patch.object(self.s, "solving", lambda name: True):
            st, doc, _ = live()
        self.assertEqual(schema.check(doc, self.api.RUN_LIVE), [])
        self.assertEqual([s["name"] for s in doc["stages"]], ["First solve", "Continued"])
        self.assertEqual((doc["current"], doc["solver"]["state"], doc["solver"]["iteration"], doc["solver"]["log"]),
                         ({"name": "Continued", "from": 30, "to": 60}, "running", 45.0, "log.foamRun_to_60"))
        st, doc, _ = live()                                                     # its job is gone
        self.assertEqual((doc["run"]["state"], doc["solver"]["state"]), ("interrupted", "stopped"))
        self.assertEqual(self.api.handle("GET", "/api/v1/runs/nope/live", {})[0], 404)

    def test_the_pace_of_iterations_quicker_than_the_logs_whole_second_clock(self):
        import server
        lp = os.path.join(self.cases, "log.pace")

        def solver(clock_of, n):
            with open(lp, "w") as f:
                f.write("".join(f"Time = {i}\n\nExecutionTime = {0.2 * i:.2f} s  ClockTime = {clock_of(i)} s\n\n"
                                for i in range(1, n + 1)))
            return server._solver_of(lp)
        self.assertEqual(solver(lambda i: 2 * i, 50)["wall_per_it"], 2.0)          # the median of the last 40
        self.assertAlmostEqual(solver(lambda i: i // 4, 41)["wall_per_it"], 10 / 39)  # four a second: their mean
        self.assertNotIn("wall_per_it", solver(lambda i: 7, 5))                       # all in one second

    def test_the_command_refuses_a_case_you_made_and_continues_one_solved_by_hand(self):
        with self.assertRaises(SystemExit) as e:
            self.s.main(["mine", "--to", "10"])
        self.assertIn("never changes", str(e.exception))
        case = os.path.join(self.cases, "made")                 # ./Allrun 2 30 by hand: split, written to 30
        for n in ("processor0/0", "processor0/30", "processor1/0", "processor1/30"):
            os.makedirs(os.path.join(case, n))
        self.assertRefused(self.post({"name": "made", "to": 30}), 400, "bad-request", "solved to iteration 30 already")
        rc, lines = self.solve("made", 40, 4)
        self.assertEqual((rc, lines[0]), (0, "made: continuing from iteration 30 to 40 on 2 processes"))
        self.assertEqual(self.status()["stretches"], [{"from": 30, "to": 40}])
        self.assertEqual(self.s.write_interval(0, 2000), 500)
        self.assertEqual(self.s.write_interval(2000, 2300), 50)       # 2300's largest divisor <= 75

    def template(self):
        """A stand-in Ahmed body template: TemplatesTest's Allmesh, which here also makes 0/ from initial/ as the real
        one does, and the settings a solve needs."""
        import templates
        src = os.path.join(self.d, "examples", "ahmed-body")
        files = {"Allmesh": TemplatesTest.ALLMESH + "rm -rf 0 && cp -r initial 0\n",
                 "system/blockMeshDict": "blocks ( hex (0 1 2 3 4 5 6 7) (130 15 15) simpleGrading (1 1 1) );\n",
                 "system/controlDict": self.CONTROL, "system/decomposeParDict": "numberOfSubdomains 4;\n",
                 "initial/U": "internalField uniform (40 0 0);\n"}
        for rel, text in files.items():
            os.makedirs(os.path.dirname(os.path.join(src, rel)), exist_ok=True)
            with open(os.path.join(src, rel), "w") as f:
                f.write(text)
        patcher = mock.patch.object(templates, "EXAMPLES", os.path.dirname(src))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_solve_job_with_a_template_checks_it_as_a_case_job_does_and_its_mesh_for_memory(self):
        for params, status, code, text in (
                ({"name": "fresh", "template": "ahmed-body", "source": "mine"}, 400, "bad-request", "not both"),
                ({"name": "fresh", "size": "coarse"}, 400, "bad-request", "goes with a template"),
                ({"name": "fresh", "template": "nope"}, 404, "not-found", "no template nope"),
                ({"name": "fresh", "template": "wheel-wing", "size": "fine"}, 400, "bad-request", "has no fine mesh"),
                ({"name": "fresh", "template": "../x"}, 400, "bad-request", "template"),
                ({"name": "fresh", "template": "ahmed-body", "size": "huge"}, 400, "bad-request", "size"),
                ({"name": "made", "template": "ahmed-body"}, 409, "exists", "exists already"),
                ({"name": "mine", "template": "ahmed-body"}, 409, "exists", "never changed")):
            self.assertRefused(self.post(params), status, code, text)
        with mock.patch.object(self.s.os, "cpu_count", lambda: 8):
            self.assertRefused(self.post({"name": "fresh", "template": "ahmed-body", "np": 9}), 400, "bad-request",
                               "8 processors")
        need = int(480_000 * 2.2 / 1024) + 512                  # the coarse mesh's, more than its solve's
        with mock.patch.object(self.s.ramguard, "available_mb", lambda: need - 1):
            self.assertRefused(self.post({"name": "fresh", "template": "ahmed-body", "size": "coarse"}), 409,
                               "not-enough-memory", "mesh of 480,000 cells")
        self.assertEqual(self.launched, [])
        st, doc, _ = self.post({"name": "fresh", "template": "ahmed-body", "size": "coarse", "to": 40, "np": 2})
        self.assertEqual(st, 202, doc)
        self.assertEqual((doc["params"], doc["log"], doc["links"]["run"]), (
            {"name": "fresh", "to": 40, "np": 2, "template": "ahmed-body", "size": "coarse"}, ".runs/fresh_to_40.log",
            "/api/v1/runs/fresh"))
        argv = self.launched[0]
        self.assertEqual(argv[argv.index("--") + 1:][2:], ["run", "fresh", "--template", "ahmed-body", "--size",
                                                            "coarse", "--to", "40", "--np", "2"])

    def test_a_solve_job_with_no_size_makes_the_templates_own(self):
        st, doc, _ = self.post({"name": "fresh", "template": "ahmed-body"})
        self.assertEqual((st, doc["params"]["size"]), (202, "medium"))
        argv = self.launched[0]
        self.assertEqual(argv[argv.index("--") + 1:][2:6], ["run", "fresh", "--template", "ahmed-body"])
        self.assertEqual(argv[-6:-4], ["--size", "medium"])

    def test_a_template_is_meshed_then_solved_in_the_one_job(self):
        self.template()
        rc, lines = self.solve("fresh", 40, 2, None, "ahmed-body", "coarse")
        self.assertEqual(rc, 0, lines)
        self.assertIn("fresh: 480 cells, ready in the cases folder", lines)
        self.assertEqual(lines[-1], "fresh: solved to iteration 40")
        case = os.path.join(self.cases, "fresh")
        with open(os.path.join(case, self.jobs.CASE_MARKER)) as f:
            mark = json.load(f)
        self.assertEqual((mark["template"], mark["size"], mark["state"], mark["cells"]),
                         ("ahmed-body", "coarse", "done", 480))
        with open(os.path.join(case, "system", "blockMeshDict")) as f:
            self.assertIn("(104 12 12)", f.read())                          # the coarse mesh's blocks
        run = self.s.describe("fresh")
        self.assertEqual((run["state"], run["step"], run["written"], run["nProcs"], run["stretches"]),
                         ("done", "done", 40, 2, [{"from": 0, "to": 40}]))
        doc = self.api.handle("GET", "/api/v1/cases", {})[1]
        self.assertEqual((doc["made"]["fresh"], doc["cells"]["fresh"]), ({"template": "ahmed-body"}, 480))
        self.assertIn("solved to iteration 40 already", self.s.refusal("fresh", 40)[1])
        rc, lines = self.solve("fresh", 60, 2)                             # then continued as any case made here
        self.assertEqual((rc, lines[0]), (0, "fresh: continuing from iteration 40 to 60 on 2 processes"))

    def test_a_template_whose_mesh_fails_says_where_and_leaves_no_case_to_solve(self):
        self.template()
        with mock.patch.dict(os.environ, {"MD_TEST_FAIL": "1"}):
            rc, lines = self.solve("fresh", 40, 2, None, "ahmed-body", "coarse")
        said = "the mesh failed at snappyHexMesh: see log.snappyHexMesh in the case's folder"
        self.assertEqual((rc, lines[-1]), (1, said))
        run = self.api.handle("GET", "/api/v1/runs/fresh", {})[1]
        self.assertEqual((run["state"], run["step"], run["error"], run["written"]),
                         ("failed", "meshing: snappyHexMesh: refining", said, 0))
        with open(os.path.join(self.cases, "fresh", self.jobs.CASE_MARKER)) as f:
            self.assertEqual(json.load(f)["state"], "failed")
        self.assertNotIn("fresh", self.api.handle("GET", "/api/v1/cases", {})[1]["items"])
        self.assertRefused(self.post({"name": "fresh"}), 409, "not-ready", "no mesh yet")

    def test_while_a_template_is_meshed_its_run_says_so_and_a_cancel_keeps_its_folder(self):
        import templates
        self.template()
        seen = {}

        def meshing(case, name, t, s, status):                             # what its run says while it is meshed
            for step in ("copying", "geometry", "snappyHexMesh: refining"):
                status.step(step)
            with mock.patch.object(self.s, "solving", lambda n: True):
                seen["run"], seen["stop"] = self.s.describe("fresh"), self.s.stop("fresh")
            seen["progress"] = self.jobs.progress({"kind": "solve", "name": "fresh",
                                                   "created": "2000-01-01T00:00:00Z"}, os.path.join(self.d, "work"))
            raise KeyboardInterrupt
        with mock.patch.object(templates, "build", meshing):
            rc, lines = self.solve("fresh", 40, 2, None, "ahmed-body", "coarse")
        self.assertEqual((rc, lines[-1]), (130, "stopped"))
        self.assertEqual((seen["run"]["state"], seen["run"]["step"], seen["run"]["written"]),
                         ("running", "meshing: snappyHexMesh: refining", 0))
        self.assertEqual(seen["stop"][1][0], "not-ready")
        self.assertIn("fresh is being meshed: Stop works once it solves", seen["stop"][1][1])
        self.assertEqual((seen["progress"]["step"], seen["progress"]["fraction"]),
                         ("meshing: snappyHexMesh: refining", 0.0))
        case = os.path.join(self.cases, "fresh")
        with open(os.path.join(case, self.jobs.CASE_MARKER)) as f:
            self.assertEqual(json.load(f)["state"], "cancelled")
        self.assertEqual(self.s.describe("fresh")["state"], "cancelled")
        self.assertTrue(os.path.isdir(case))                                # kept, as a case job's is

    def test_the_command_makes_a_case_from_a_template_then_solves_it(self):
        self.template()
        for argv, said in ((["fresh", "--template"], "--template takes a name"),
                           (["mine", "fresh", "--template", "ahmed-body"], "not both"),
                           (["fresh", "--size", "coarse"], "goes with a template")):
            with self.assertRaises(SystemExit) as e:
                self.s.main(argv)
            self.assertIn(said, str(e.exception))
        asked, out = [], io.StringIO()
        with mock.patch.object(self.s.ramguard, "check_cells",
                               lambda cells, step: asked.append((cells, step)) or (True, "")), \
                contextlib.redirect_stdout(out):
            rc = self.s.main(["fresh", "--template", "ahmed-body", "--size", "coarse", "--to", "10", "--np", "1"])
        self.assertEqual(rc, 0, out.getvalue())
        self.assertEqual(asked, [(480_000, "mesh")])                       # the memory of the mesh it makes
        self.assertEqual((self.s.describe("fresh")["written"], self.s.split(os.path.join(self.cases, "fresh"))), (10, 0))

    def test_a_solve_is_refused_when_its_new_case_and_what_it_writes_wont_fit_on_the_disk(self):
        import diskguard
        self.yours()
        keep = diskguard.KEEP_MB
        for params, what, mb in (
                ({"name": "copy1", "source": "yours", "np": 2}, "the copy of yours and its solve need", 1 + 4),
                ({"name": "made", "to": 100, "np": 2}, "the solve of made needs", 4),     # its split and 2 times
                ({"name": "fresh", "template": "ahmed-body", "size": "coarse", "np": 2},
                 "fresh's mesh and its solve need", 68 + 215)):   # its mesh with its sets, then its solve
            need = self.s.disk_need(params["name"], 2, params.get("source"), params.get("template"), params.get("size"))
            self.assertEqual(need, (mb, what))
            with mock.patch.object(diskguard, "free_mb", lambda folder: mb + keep - 1):
                self.assertRefused(self.post(params), 409, "not-enough-disk",
                                   f"{what} about {mb} MB, and the disk has {diskguard.text(mb + keep - 1)} free (the engine keeps "
                                   "1.0 GB free)")
        self.assertEqual(self.launched, [])
        self.assertFalse(os.path.exists(os.path.join(self.cases, "copy1")))
        with mock.patch.object(diskguard, "free_mb", lambda folder: 4 + keep - 1), self.assertRaises(SystemExit) as e:
            self.s.main(["yours", "copy2", "--to", "10", "--np", "2"])      # the command checks it too
        self.assertTrue(str(e.exception).startswith("not enough disk space: the copy of yours and its solve need"))
        self.assertFalse(os.path.exists(os.path.join(self.cases, "copy2")))
        with mock.patch.object(diskguard, "free_mb", lambda folder: 5 + keep):
            st, doc, _ = self.post({"name": "copy1", "source": "yours", "np": 2})
        self.assertEqual(st, 202, doc)

    def test_the_disk_route_says_the_free_space_and_what_solving_a_case_takes(self):
        import diskguard
        self.yours()
        with mock.patch.object(diskguard, "free_mb", lambda folder: 5000):
            self.assertEqual(self.api.handle("GET", "/api/v1/disk")[:2],
                             (200, {"freeMb": 5000, "keepMb": 1024, "case": None, "template": None}))
            st, doc, _ = self.api.handle("GET", "/api/v1/disk", {"case": "yours"})
        self.assertEqual((st, doc["case"]), (200, {"name": "yours", "copyMb": 1, "transientMb": 1,
                                                   "solveMb": {"several": 4, "one": 2},
                                                   "continueMb": {"several": 1, "one": 0},
                                                   "transientSolveMb": {"several": 10, "one": 6}}))
        # a transient run keeps every time it writes: 4 a stretch unless it asks (API 1.10), on 2 processes
        # 1.05 + 16 x 0.8 x 2.1 + 0.6 x 2.1 = 29.19 MB of a 1 MB mesh, and 16 x 0.6 x 2.1 = 20.16 on one
        with mock.patch.object(diskguard, "free_mb", lambda folder: 5000):
            st, doc, _ = self.api.handle("GET", "/api/v1/disk", {"case": "yours", "writes": "16"})
        self.assertEqual((st, doc["case"]["transientSolveMb"], doc["case"]["solveMb"], doc["case"]["continueMb"]),
                         (200, {"several": 30, "one": 21}, {"several": 4, "one": 2}, {"several": 1, "one": 0}))
        for bad in ("0", "201", "4.5", "many"):
            st, doc, _ = self.api.handle("GET", "/api/v1/disk", {"case": "yours", "writes": bad})
            self.assertEqual((st, doc["error"]["code"]), (400, "bad-request"), bad)
        st, doc, _ = self.api.handle("GET", "/api/v1/disk", {"case": "nope"})
        self.assertEqual((st, doc["error"]["code"]), (404, "not-found"))
        st, doc, _ = self.api.handle("GET", "/api/v1/disk", {"case": "../x"})
        self.assertEqual((st, doc["error"]["code"]), (400, "bad-request"))

    def test_the_disk_route_says_what_a_solve_that_makes_a_case_of_a_template_takes(self):
        import diskguard
        with mock.patch.object(diskguard, "free_mb", lambda folder: 5000):
            st, doc, _ = self.api.handle("GET", "/api/v1/disk", {"template": "ahmed-body", "size": "coarse"})
        # the coarse Ahmed body's 480,000 cells: its mesh of 66 MB with its sets, 68 MB, then its solve keeping two
        # written times (purgeWrite 2): 66 x (1.05 + 2 x 0.8 + 0.6) = 214.5 MB on several processes, 66 x 2 x 0.6 on one
        self.assertEqual((st, doc["freeMb"], doc["case"], doc["template"]),
                         (200, 5000, None, {"name": "ahmed-body", "size": "coarse", "madeMb": 68,
                                            "solveMb": {"several": 215, "one": 80}}))
        for nproc, solved in ((4, 215), (2, 215), (1, 80)):            # as the solve job's disk guard counts it
            self.assertEqual(self.s.disk_need("fresh", nproc, template="ahmed-body", size="coarse"),
                             (68 + solved, "fresh's mesh and its solve need"), nproc)
        own = self.s.own_size("ahmed-body")                             # no size: the template's own, as a solve's
        st, doc, _ = self.api.handle("GET", "/api/v1/disk", {"template": "ahmed-body"})
        self.assertEqual((st, doc["template"]), (200, self.s.template_disk("ahmed-body", own)))
        self.assertEqual((doc["template"]["size"], self.s.disk_need("fresh", 2, template="ahmed-body")[0]),
                         (own, doc["template"]["madeMb"] + doc["template"]["solveMb"]["several"]))
        for q, status, text in (({"template": "nope"}, 404, "no template nope"),
                                ({"template": "../x"}, 400, "template"),
                                ({"template": "ahmed-body", "size": "huge"}, 400, "size"),
                                ({"size": "coarse"}, 400, "a mesh size goes with a template")):
            st, doc, _ = self.api.handle("GET", "/api/v1/disk", q)
            self.assertEqual((st, doc["error"]["code"]), (status, "not-found" if status == 404 else "bad-request"), q)
            self.assertIn(text, doc["error"]["message"], q)
        body = self.s.templates.TEMPLATES["ahmed-body"]
        with mock.patch.dict(body, {"sizes": {k: v for k, v in body["sizes"].items() if k != "fine"}}):
            st, doc, _ = self.api.handle("GET", "/api/v1/disk", {"template": "ahmed-body", "size": "fine"})
        self.assertEqual((st, doc["error"]["code"]), (400, "bad-request"))   # a size the template hasn't
        self.assertIn("has no fine mesh", doc["error"]["message"])
        st, doc, _ = self.api.handle("GET", "/api/v1/disk", {"case": "nope", "template": "ahmed-body"})
        self.assertEqual((st, doc["error"]["code"]), (404, "not-found"))   # each asked for is checked
        spec = self.api.handle("GET", "/api/v1/openapi.json")[1]["paths"]["/disk"]["get"]["parameters"]
        query = {p["name"]: p for p in spec}
        self.assertEqual(query["size"]["schema"], self.api.JOBS["solve"]["params"]["properties"]["size"])
        self.assertEqual([n for n, p in query.items() if p["required"]], [])


TRANSIENT_FOAMRUN = '''#!/usr/bin/env python3
# foamRun in time, as OpenFOAM 14 runs one with adjustTimeStep: from startTime (by name) to endTime, five time steps
# a write, writing at beginTime + k writeInterval, and at a Stop (stopAt writeNow) after the step it is at.
import os, re


def control():
    with open("system/controlDict") as f:
        return f.read()


def entry(text, key):
    m = re.search(r"(?m)^" + key + r"[ \\t]+([^;\\n]*);", text)
    return m.group(1).strip() if m else None


text = control()
start, end, w = float(entry(text, "startTime")), float(entry(text, "endTime")), float(entry(text, "writeInterval"))
begin = float(entry(text, "beginTime") or start)
step, stop_at = w / 5, int(os.environ.get("MD_TEST_STOP_AT") or 0)
where = sorted(n for n in os.listdir(".") if re.fullmatch(r"processor[0-9]+", n)) or ["."]
n, k, t = 0, round((start - begin) / w), start
while t < end - step / 2:
    n += 1
    t = start + n * step
    print(f"deltaT = {step:.6g}\\nTime = {t:.6g}s\\n\\nExecutionTime = {n / 2:.2f} s  ClockTime = {n} s\\n", flush=True)
    if n == stop_at:
        with open("system/controlDict", "w") as f:
            f.write(re.sub(r"(?m)^stopAt[ \\t].*$", "stopAt          writeNow;", text))
    stopping = re.search(r"(?m)^stopAt[ \\t]+writeNow", control()) is not None
    if stopping or abs(t - (begin + (k + 1) * w)) < step / 2:
        k += 1
        for d in where:
            os.makedirs(os.path.join(d, f"{t:.6g}"), exist_ok=True)
    if stopping:
        break
if os.environ.get("MD_TEST_FAIL"):
    print("--> FOAM FATAL ERROR: stand-in")
    raise SystemExit(1)
print("End")
'''


class TransientSolveTest(unittest.TestCase):
    """solve.py and transient.py: a transient run of a solved steady run, made from the Ahmed body template's own
    settings and solved, continued and stopped by time with SolveTest's stand-in OpenFOAM programs (its foamRun in
    time), so neither OpenFOAM nor a mesh is needed."""

    PROGRAMS = dict(SolveTest.PROGRAMS, foamRun=TRANSIENT_FOAMRUN)
    CONTROL = SolveTest.CONTROL
    setUp, case, post, assertRefused, solve = (SolveTest.setUp, SolveTest.case, SolveTest.post,
                                               SolveTest.assertRefused, SolveTest.solve)

    def steady(self, name="steady", files=None, marker=None):
        """A steady run solved to iteration 40 on 2 processes, as solve.py leaves one: the template's settings, its
        initial fields, its result (joined, and on its processors) with the flux and a field a function object wrote,
        its log and its forces.  A file's text of None removes that file or folder."""
        import templates
        ex = os.path.join(templates.EXAMPLES, "ahmed-body")
        self.case(name, marker or {"state": "done", "template": "ahmed-body", "cells": 480})
        c = os.path.join(self.cases, name)
        for rel in ("system/controlDict", "system/fvSchemes", "system/fvSolution", "constant/momentumTransport"):
            shutil.copyfile(os.path.join(ex, rel), os.path.join(c, rel))
        own = {"0/U": "internalField uniform (40 0 0);\n", "0/p": "p at the start\n", "0/k": "k at the start\n",
               "0/omega": "omega at the start\n", "0/nut": "nut at the start\n", "0/conditions": "speed 40;\n",
               "40/U": "solved U\n", "40/p": "solved p\n", "40/k": "solved k\n", "40/omega": "solved omega\n",
               "40/nut": "solved nut\n", "40/phi": "solved phi\n", "40/yPlus": "a function object's field\n",
               "40/uniform/time": "value 40;\n", "processor0/40/U": "split U\n", "processor1/40/U": "split U\n",
               "log.foamRun": "Time = 40\n", "postProcessing/forceCoeffs/0/forceCoeffs.dat": "40 0.3 0.1\n",
               **(files or {})}
        for rel, text in own.items():
            path = os.path.join(c, rel)
            if text is None:
                shutil.rmtree(path) if os.path.isdir(path) else os.remove(path)
                continue
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                f.write(text)
        with open(os.path.join(c, self.jobs.SOLVE_STATUS), "w") as f:
            json.dump({"madeBy": "Mesh Doctor", "state": "done", "step": "done", "iteration": 40, "start": 0,
                       "end": 40, "nProcs": 2, "stretches": [{"from": 0, "to": 40}], "started": "2026-11-23T20:00:00Z",
                       "time": "2026-11-23T20:05:00Z", "finished": "2026-11-23T20:05:00Z", "error": None,
                       "fraction": 1.0}, f)
        return c

    def text(self, name, rel):
        with open(os.path.join(self.cases, name, rel)) as f:
            return f.read()

    def times(self, name, where="processor0"):
        """The written times in the run's processor0 (or its own folder: "."), by their names, in time order."""
        names = os.listdir(os.path.join(self.cases, name, where))
        return sorted((n for n in names if re.fullmatch(r"[0-9.e+-]+", n)), key=float)

    def status(self, name="ahmedT"):
        with open(os.path.join(self.cases, name, self.jobs.SOLVE_STATUS)) as f:
            return json.load(f)

    def test_a_transient_run_is_measured_as_it_is_made_and_refused_when_it_wont_fit(self):
        import diskguard, transient
        src = self.steady()
        new = os.path.join(self.cases, "ahmedT")
        need = transient.make_size(src, new)
        os.mkdir(new)
        transient.make(src, new, 1, "DDES", 0.2088)

        def sizes(root):
            return {os.path.relpath(os.path.join(d, n), root): os.path.getsize(os.path.join(d, n))
                    for d, _, names in os.walk(root) for n in names}
        before, after = sizes(src), sizes(new)
        # its fields as made, and its settings as copied, before they are made transient (its function objects then
        # go in a file of their own, a few hundred bytes, as small as those changes)
        self.assertEqual(need, sum(after[r] if r.startswith("0" + os.sep) else before[r] for r in after
                                   if r != os.path.join("system", "functions")))
        self.assertIsNone(transient.make_size(os.path.join(self.cases, "made")))     # no result to start from
        mb, what = self.s.disk_need("ahmedT2", 2, steady="steady")
        self.assertEqual(what, "the transient run of steady and its solve need")
        with mock.patch.object(diskguard, "free_mb", lambda folder: mb + diskguard.KEEP_MB - 1):
            self.assertRefused(self.post({"name": "ahmedT2", "steady": "steady", "np": 2}), 409, "not-enough-disk",
                               f"{what} about {mb} MB")
        self.assertEqual(self.launched, [])

    def test_a_transient_run_has_the_steady_runs_mesh_settings_and_flow_made_transient(self):
        import transient
        src = self.steady()
        before = SolveTest.tree(src)
        new = os.path.join(self.cases, "ahmedT")
        os.mkdir(new)
        self.assertEqual(transient.make(src, new, 1, "DDES", 0.2088), 480)
        self.assertEqual(SolveTest.tree(src), before)                       # the steady run is only read
        got = SolveTest.tree(new)
        self.assertEqual({k: got[k] for k in ("0/U", "0/phi", "0/nut", "0/conditions")},
                         {"0/U": "solved U\n", "0/phi": "solved phi\n", "0/nut": "solved nut\n",
                          "0/conditions": "speed 40;\n"})                  # its flow is the start; its files stay
        self.assertEqual([k for k in got if k.startswith(("40/", "processor", "log.", "postProcessing", "0/yPlus"))],
                         [])
        control = got["system/controlDict"]
        for line in (r"startFrom\s+startTime;", r"startTime\s+0;", r"beginTime\s+0;", r"endTime\s+0\.2088;",
                     r"deltaT\s+1\.044e-05;", r"adjustTimeStep\s+yes;", r"maxCo\s+1;",
                     r"writeControl\s+adjustableRunTime;", r"writeInterval\s+0\.0522;", r"purgeWrite\s+0;"):
            self.assertRegex(control, "(?m)^" + line)                       # 4 times, each kept (the template's 2)
        self.assertNotIn("maxDeltaT", control)                              # the Courant number alone sets it
        # its function objects are in system/functions, which OpenFOAM reads again as it solves, with its averaging off
        self.assertNotRegex(control, r"(?m)^functions\b")
        self.assertIn(transient.MOVED, control)
        funcs = got["system/functions"]
        self.assertTrue(funcs.startswith(transient.FUNCTIONS), funcs[:200])
        for line in ("#includeFunc residuals(p, U, k, omega)", "forcesTotal         // whole body",
                     "    writeInterval 1;", "    lRef        1.044;", transient.AVERAGE_ENTRY):
            self.assertIn(line, funcs)                                      # a function object's own is left alone
        self.assertNotIn("#remove", funcs)
        self.assertEqual(transient.average_state(new), "off")
        schemes = got["system/fvSchemes"]
        for line in ("ddtSchemes      { default backward; }", "div(phi,U)      Gauss LUST grad(U);",
                     "div(phi,k)      Gauss limitedLinear 1;"):
            self.assertIn(line, schemes)
        self.assertNotIn("bounded", schemes)
        solution = got["system/fvSolution"]
        for line in ("PIMPLE\n{\n    nOuterCorrectors 3;\n    nCorrectors      2;\n    nNonOrthogonalCorrectors 0;\n}",
                     "pFinal          { $p; relTol 0; }", '"(U|k|omega|epsilon|nuTilda)Final" { $U; relTol 0; }',
                     'relaxationFactors\n{\n    equations { ".*" 1; }\n}', "potentialFlow { nNonOrthogonalCorrectors"):
            self.assertIn(line, solution)
        self.assertNotRegex(solution, r"\bSIMPLE\b|consistent|U 0\.9")
        mt = got["constant/momentumTransport"]
        self.assertRegex(mt, r"(?m)^simulationType\s+LES;")
        for line in ("model           kOmegaSSTDES;", "kOmegaSSTDESCoeffs { FSST 2; }", "delta           maxDeltaxyz;"):
            self.assertIn(line, mt)
        self.assertNotRegex(mt, r"(?m)^RAS\b|kOmegaSST;")
        # URANS keeps the steady run's RAS model, in time, and relaxes its outer correctors above a Courant number of 1
        new = os.path.join(self.cases, "ahmedU")
        os.mkdir(new)
        transient.make(src, new, 5, "URANS", 0.1)
        got = SolveTest.tree(new)
        self.assertEqual(got["constant/momentumTransport"], before["constant/momentumTransport"])
        self.assertIn("div(phi,U)      Gauss linearUpwindV grad(U);", got["system/fvSchemes"])
        self.assertIn('fields { p 0.3; pFinal 1; }\n    equations { "(U|k|omega|epsilon|nuTilda)" 0.7; ".*Final" 1; }',
                      got["system/fvSolution"])
        for line in (r"maxCo\s+5;", r"deltaT\s+5e-06;", r"writeInterval\s+0\.025;"):
            self.assertRegex(got["system/controlDict"], "(?m)^" + line)

    def test_its_first_time_step_and_flow_time_come_from_the_plan_and_the_body(self):
        import transient
        src = self.steady()
        self.assertEqual(transient.flow_time(src), 0.2088)                 # 8 L/U: lRef 1.044 m at 40 m/s
        plan = ({"time": "40", "courantPerSecond": {"max": 2e5}}, None)
        with mock.patch.object(transient.tplan, "of", lambda name: plan):
            self.assertEqual(transient.start_dt("steady", "40", 1, 0.2), 5e-06)      # Co 1 at its fastest cell
            self.assertEqual(transient.start_dt("steady", "30", 1, 0.2), 1e-05)      # a plan of another result
        self.assertEqual(transient.start_dt("steady", "40", 1, 0.2), 1e-05)          # no plan: OpenFOAM cuts it
        text = "solvers\n{\n}\nSIMPLE // the { steady } solver\n{\n    // one { brace\n    nNonOrthogonalCorrectors 1;\n}\n"
        a, b = transient.block(text, "SIMPLE")
        self.assertEqual(text[a:b], text[text.index("SIMPLE"):text.rindex("}") + 1])   # comments don't count
        self.assertIsNone(transient.block(text, "PIMPLE"))
        self.assertIsNone(transient.result(os.path.join(self.cases, "made")))          # no result

    def functions_of(self, control, own=None):
        """A case with this controlDict (and system/functions, `own`), its function objects put in system/functions
        (transient.functions): (what it said, its controlDict, its system/functions or None)."""
        import transient
        case = tempfile.mkdtemp(prefix="functions_", dir=self.cases)
        os.makedirs(os.path.join(case, "system"))
        for rel, text in (("system/controlDict", control), ("system/functions", own)):
            if text is not None:
                with open(os.path.join(case, rel), "w") as f:
                    f.write(text)
        said = transient.functions(case)
        out = []
        for rel in ("system/controlDict", "system/functions"):
            path = os.path.join(case, rel)
            out.append(transient.read(path) if os.path.isfile(path) else None)
        return (said, *out)

    def test_a_transient_runs_function_objects_go_in_system_functions_with_its_averaging_off(self):
        import transient
        head = "solver          incompressibleFluid;\nendTime         1;\n"
        # The entries they name ($forceDefaults, $speed) go with them, removed once read; an environment variable
        # ($FOAM_CASE) stays as it is
        control = (head + "// forces in N\nforceDefaults\n{\n    type        forces;\n    rhoInf      1.205;\n}\n"
                   "speed           15;   // m/s\n\nfunctions\n{\n    #includeFunc residuals(p, U)\n\n"
                   "    forcesTotal { $forceDefaults; patches (modelGroup); }\n"
                   "    forcesWing  { $forceDefaults; patches (model_wing); magUInf $speed; }\n"
                   "    paths       { type sets; file \"$FOAM_CASE/x\"; }    // {\n}\n\n// end\n")
        said, cd, funcs = self.functions_of(control)
        self.assertTrue(said)
        self.assertEqual(cd, control[:control.index("functions\n{")] + transient.MOVED + "\n\n// end\n")
        self.assertEqual(funcs, transient.FUNCTIONS + (
            "\n// The run's function objects, from its controlDict, and its averaging (Mesh Doctor)\n"
            "\nforceDefaults\n{\n    type        forces;\n    rhoInf      1.205;\n}\n\nspeed           15;\n"
            "\n#includeFunc residuals(p, U)\n\nforcesTotal { $forceDefaults; patches (modelGroup); }\n"
            "forcesWing  { $forceDefaults; patches (model_wing); magUInf $speed; }\n"
            "paths       { type sets; file \"$FOAM_CASE/x\"; }    // {\n"
            "\n" + transient.AVERAGE_ENTRY + "\n\n#remove forceDefaults\n#remove speed\n"))
        # The wheel and wing template's own, as OpenFOAM 14 read it (checked for real: its forces from the moved
        # macro, and the averaging switched on as it solved, on one process and on two)
        import templates
        with open(os.path.join(templates.EXAMPLES, "wheel-wing", "system", "controlDict")) as f:
            said, cd, funcs = self.functions_of(f.read())
        self.assertTrue(said)
        self.assertIn("forceDefaults\n{\n    type        forces;", cd)              # the controlDict keeps its own
        self.assertIn("forcesWing  { $forceDefaults; patches (model_wing); }", funcs)
        self.assertTrue(funcs.endswith(transient.AVERAGE_ENTRY + "\n\n#remove forceDefaults\n"), funcs[-300:])
        # A case with functions of its own in system/functions (OpenFOAM leaves the controlDict's out then): the
        # averaging goes after them
        said, cd, funcs = self.functions_of(control, transient.FUNCTIONS + "\n#includeFunc yPlus\n")
        self.assertEqual((said, cd, funcs), (True, control, transient.FUNCTIONS + "\n#includeFunc yPlus\n\n"
                                             + transient.AVERAGE_ENTRY + "\n"))
        # One with no function objects gets just its averaging
        said, cd, funcs = self.functions_of(head)
        self.assertEqual((said, cd, funcs), (True, head, transient.FUNCTIONS + "\n// The run's function objects, "
                                             "from its controlDict, and its averaging (Mesh Doctor)\n\n"
                                             + transient.AVERAGE_ENTRY + "\n"))
        # None for one with a fieldAverage of its own (both would write UMean), or that names an entry another way
        for text in (head + "functions\n{\n    avg { type  fieldAverage; fields (U); }\n}\n",
                     head + "functions\n{\n    forcesTotal { $:forceDefaults; patches (a); }\n}\n",
                     head + "functions\n{\n    forcesTotal { $../forceDefaults; patches (a); }\n}\n"):
            self.assertEqual(self.functions_of(text), (False, text, None), text)
        own = transient.FUNCTIONS + "\navg { type fieldAverage; fields (U); }\n"
        self.assertEqual(self.functions_of(head, own), (False, head, own))

    def test_its_averaging_is_switched_on_once_its_forces_settle_and_says_from_when(self):
        import transient
        case = os.path.join(self.cases, "avg")
        os.makedirs(os.path.join(case, "system"))
        other = "    other { type probes; enabled false; }\n"
        funcs = transient.FUNCTIONS + "\n" + other + "\n" + transient.AVERAGE_ENTRY + "\n"
        path = os.path.join(case, "system", "functions")
        with open(path, "w") as f:
            f.write(funcs)
        self.assertEqual((transient.average_state(case), transient.averaging(case)),
                         ("off", {"from": None, "settled": None, "written": None}))
        os.utime(path, (1000, 1000))
        before = time.time()
        self.assertTrue(transient.switch_on(case, 60))
        with open(path) as f:
            self.assertEqual(f.read(), funcs.replace("    enabled         false;", "    enabled         true;"))
        self.assertGreaterEqual(os.stat(path).st_mtime, before)            # past OpenFOAM's skew: it reads it again
        os.utime(path, (time.time() - 5, time.time() - 5))
        stamp = os.stat(path).st_mtime
        self.assertTrue(transient.switch_on(case, 60))                      # on already: left as it is
        self.assertEqual((os.stat(path).st_mtime, transient.average_state(case)), (stamp, "on"))
        self.assertIn(other, transient.read(path))                         # another function object's own stays
        with open(path, "w") as f:
            f.write(funcs)
        later = time.time() + 100                                           # a time moved on before: 60 s past it
        os.utime(path, (later, later))
        self.assertTrue(transient.switch_on(case, 60))
        self.assertAlmostEqual(os.stat(path).st_mtime, later + 60, delta=1)
        # From when: the latest time written with it, less its totalTime (in the run's own folder or its processor0)
        doc = {"averaging": {"from": 0.0841, "settled": 0.042}}
        self.assertEqual(transient.averaging(case, doc), {"from": 0.0841, "settled": 0.042, "written": None})
        for rel, total in (("0.1/uniform/meanFlowProperties", "0.0159"),
                           ("processor0/0.105/uniform/meanFlowProperties", "0.0209")):
            os.makedirs(os.path.dirname(os.path.join(case, rel)), exist_ok=True)
            with open(os.path.join(case, rel), "w") as f:
                f.write("FoamFile { object meanFlowProperties; }\n// the p one first\np\n{\n    totalIter 9;\n"
                        f"    totalTime 1;\n}}\nU\n{{\n    totalIter 10;\n    totalTime {total};\n}}\n")
        self.assertEqual(transient.averaging(case, doc), {"from": 0.0841, "settled": 0.042, "written": 0.105})
        self.assertEqual(transient._averaged(case), (0.0841, 0.105))
        # None without one: a run made before, or a steady case
        os.remove(path)
        self.assertEqual((transient.average_state(case), transient.averaging(case, doc), transient.switch_on(case, 60)),
                         (None, None, False))
        # Its forces settled: as the transient judge finds it, the later of drag and vertical force; not while they
        # still drift, nor with no forces
        settled = os.path.join(self.cases, "settled")
        os.makedirs(os.path.join(settled, "0"))
        with open(os.path.join(settled, "0", "U"), "w") as f:
            f.write("internalField uniform (20 0 0);\n")
        self.assertIsNone(transient.forces_settled(settled))
        write_transient_run(settled, 200, 1e-5, 0.8, lambda i: 50 + 40 * math.exp(-i / 8) + math.sin(i / 3))
        at = transient.forces_settled(settled)
        self.assertTrue(0.01 < at < 0.1, at)                               # once its start has died away
        write_transient_run(settled, 200, 1e-5, 0.8, lambda i: 50 + i)      # still drifting
        self.assertIsNone(transient.forces_settled(settled))

    def test_a_transient_run_needs_a_solved_steady_run_whose_settings_it_can_make_transient(self):
        self.steady()
        for params, status, code, text in (
                ({"name": "t", "steady": "nope"}, 404, "not-found", "no run nope"),
                ({"name": "t", "steady": "made"}, 404, "not-found", "no run made"),     # a case, but no run
                ({"name": "t", "steady": "../x"}, 400, "bad-request", "params.steady"),
                ({"name": "t", "steady": "steady", "model": "LES"}, 400, "bad-request", "params.model"),
                ({"name": "t", "steady": "steady", "maxCo": 3}, 400, "bad-request", "DDES resolves"),
                ({"name": "t", "steady": "steady", "maxCo": 0}, 400, "bad-request", "more than 0"),
                ({"name": "t", "steady": "steady", "maxCo": 25, "model": "URANS"}, 400, "bad-request", "params.maxCo"),
                ({"name": "t", "maxCo": 1}, 400, "bad-request", "go with a steady run"),
                ({"name": "t", "model": "URANS"}, 400, "bad-request", "go with a steady run"),
                ({"name": "t", "steady": "steady", "template": "ahmed-body"}, 400, "bad-request", "alone"),
                ({"name": "t", "steady": "steady", "source": "mine"}, 400, "bad-request", "alone"),
                ({"name": "made", "steady": "steady"}, 409, "exists", "exists already"),
                ({"name": "made", "to": 40.5}, 400, "bad-request", "made is a steady run"),
                ({"name": "t", "template": "ahmed-body", "to": 40.5}, 400, "bad-request", "whole iterations"),
                ({"name": "t", "source": "mine", "to": 0.5}, 400, "bad-request", "whole iterations")):
            self.assertRefused(self.post(params), status, code, text)
        for body in (b'{"kind": "solve", "params": {"name": "t", "steady": "steady", "to": NaN}}',
                     b'{"kind": "solve", "params": {"name": "t", "steady": "steady", "to": 1e999}}',
                     b'{"kind": "solve", "params": {"name": "t", "steady": "steady", "maxCo": -Infinity}}'):
            self.assertRefused(self.api.handle("POST", "/api/v1/jobs", {}, body, "application/json"), 400,
                               "bad-request", "not valid JSON")
        with mock.patch.object(self.s, "solving", lambda name: True):
            self.assertRefused(self.post({"name": "t", "steady": "steady"}), 409, "not-ready", "steady is solving")
        self.steady("fresh", {"40": None, "processor0": None, "processor1": None})
        self.assertRefused(self.post({"name": "t", "steady": "fresh"}), 409, "not-ready", "no solved result yet")
        self.steady("cut", {"processor0/60/U": "split\n", "processor1/60/U": "split\n"})    # ended unjoined
        self.assertRefused(self.post({"name": "t", "steady": "cut"}), 409, "not-ready", "still split")
        self.steady("euler", {"system/fvSchemes": "ddtSchemes { default Euler; }\n"})
        self.assertRefused(self.post({"name": "t", "steady": "euler"}), 422, "unsupported",
                           "euler: its fvSchemes has no steadyState time scheme")
        self.steady("piso", {"system/fvSolution": "PISO\n{\n    nCorrectors 2;\n}\n"})
        self.assertRefused(self.post({"name": "t", "steady": "piso"}), 422, "unsupported", "no SIMPLE dictionary")
        self.steady("ke", {"constant/momentumTransport": "simulationType RAS;\nRAS\n{\n    model realizableKE;\n}\n"})
        self.assertRefused(self.post({"name": "t", "steady": "ke"}), 422, "unsupported", "as URANS")
        self.steady("laminar", {"constant/momentumTransport": "simulationType laminar;\n"})
        self.assertRefused(self.post({"name": "t", "steady": "laminar"}), 422, "unsupported", "starts from a RAS run")
        self.steady("again", marker={"state": "done", "transientOf": "steady", "at": "40", "maxCo": 1, "model": "DDES"})
        self.assertRefused(self.post({"name": "t", "steady": "again"}), 422, "unsupported", "a transient run already")
        no_length = re.sub(r"\n *lRef[^\n]*", "", self.text("steady", "system/controlDict"))
        self.steady("nolength", {"system/controlDict": no_length})
        self.assertRefused(self.post({"name": "t", "steady": "nolength"}), 400, "bad-request", "give the time in s")
        st, doc, _ = self.post({"name": "t", "steady": "ke", "model": "URANS", "to": 0.1})      # URANS: any RAS model
        self.assertEqual(st, 202, doc)

    def test_a_transient_job_starts_with_its_steady_runs_courant_number_model_and_flow_time(self):
        self.steady()
        asked = []
        real = self.s.md_api._submit
        with mock.patch.object(self.s.md_api, "_submit", lambda *a, **k: asked.append(k["ram"]) or real(*a, **k)):
            st, doc, _ = self.post({"name": "ahmedT", "steady": "steady", "np": 2})
        self.assertEqual(st, 202, doc)
        self.assertEqual((doc["params"], doc["log"]), ({"name": "ahmedT", "to": 0.2088, "np": 2, "steady": "steady",
                                                        "maxCo": 1, "model": "DDES"}, ".runs/ahmedT_to_0.2088.log"))
        self.assertEqual(asked, [(os.path.join(self.cases, "steady"), "solve")])      # its steady run's mesh
        argv = self.launched[0]
        cmd = argv[argv.index("--") + 1:]
        self.assertEqual(cmd[2:], ["run", "ahmedT", "--steady", "steady", "--co", "1", "--model", "DDES", "--to",
                                   "0.2088", "--np", "2"])
        with mock.patch.object(self.jobs, "busy", lambda ws=None: None):     # one big job at a time: the first's
            st, doc, _ = self.post({"name": "ahmedU", "steady": "steady", "maxCo": 4.5, "model": "URANS", "to": 0.05})
        self.assertEqual(st, 202, doc)
        self.assertEqual(doc["params"], {"name": "ahmedU", "to": 0.05, "np": 4, "steady": "steady", "maxCo": 4.5,
                                         "model": "URANS"})
        self.assertEqual(self.launched[-1][-10:], ["--steady", "steady", "--co", "4.5", "--model", "URANS", "--to",
                                                   "0.05", "--np", "4"])

    def test_a_transient_run_solves_in_seconds_from_the_steady_flow_and_continues_and_stops_by_time(self):
        src = self.steady()
        before = SolveTest.tree(src)
        rc, lines = self.solve("ahmedT", 0.0004, 2, None, None, None, "steady", 1, "DDES")
        self.assertEqual(rc, 0, lines)
        self.assertEqual(lines[0], "making a transient run of steady (DDES, largest Courant number 1, to 0.0004 s): "
                                   "its mesh, settings and latest result")
        self.assertIn("made the transient run of steady: 480 cells", lines)
        self.assertIn("ahmedT: solving from 0 s to 0.0004 s on 2 processes", lines)
        self.assertEqual(lines[-1], "ahmedT: solved to 0.0004 s")
        case = os.path.join(self.cases, "ahmedT")
        self.assertFalse(os.path.exists(os.path.join(case, "log.potentialFoam")))     # it starts from the steady flow
        self.assertEqual(self.times("ahmedT"), ["0", "0.0001", "0.0002", "0.0003", "0.0004"])
        st = self.status()
        self.assertEqual((st["state"], st["iteration"], st["start"], st["end"], st["nProcs"], st["stretches"]),
                         ("done", 0.0004, 0, 0.0004, 2, [{"from": 0, "to": 0.0004}]))
        control = self.text("ahmedT", "system/controlDict")
        for line in (r"startTime\s+0;", r"beginTime\s+0;", r"endTime\s+0\.0004;", r"writeInterval\s+0\.0001;",
                     r"stopAt\s+endTime;"):
            self.assertRegex(control, "(?m)^" + line)
        self.assertEqual(SolveTest.tree(src), before)                       # the steady run is only read
        import schema
        st, run, _ = self.api.handle("GET", "/api/v1/runs/ahmedT", {})
        self.assertEqual(schema.check(run, self.api.RUN_ONE), [])
        self.assertEqual((run["written"], run["iteration"], run["transient"]),
                         (0.0004, 0.0004, {"steady": "steady", "at": "40", "maxCo": 1, "model": "DDES", "writes": 4}))
        # each time it wrote is kept, on its processors (the stand-in reconstructPar joins none)
        self.assertEqual((run["times"], run["joined"]), ([0.0001, 0.0002, 0.0003, 0.0004], []))
        self.assertRegex(control, r"(?m)^purgeWrite\s+0;")
        self.assertIsNone(self.s.describe("steady")["transient"])
        self.assertEqual(self.api.handle("GET", "/api/v1/cases", {})[1]["made"]["ahmedT"], {"transientOf": "steady"})
        # Continued by time: from its latest written time, which the next stretch's writes line up from
        self.assertRefused(self.post({"name": "ahmedT"}), 400, "bad-request", "give the time in s to continue it to")
        self.assertRefused(self.post({"name": "ahmedT", "to": 0.0004}), 400, "bad-request",
                           "solved to 0.0004 s already")
        # Not averaging yet: its forces haven't settled (it wrote none)
        self.assertEqual((run["averaging"], self.status().get("averaging")),
                         ({"from": None, "settled": None, "written": None}, None))
        self.assertIsNone(self.s.describe("steady")["averaging"])
        # They had settled by the end of that stretch, so the next one averages from its start
        forces = os.path.join(case, "postProcessing", "forcesTotal", "0")
        os.makedirs(forces)
        with open(os.path.join(forces, "forces.dat"), "w") as f:
            for i in range(1, 201):
                f.write(f"{i * 2e-6:g} (({50 + 40 * math.exp(-i / 8) + math.sin(i / 3)} 0 -30) (0 0 0))\n")
        import transient
        settled = transient.forces_settled(case)
        self.assertTrue(0 < settled < 0.0002, settled)
        rc, lines = self.solve("ahmedT", 0.001, 4)
        self.assertEqual((rc, lines[0], lines[-1]), (0, "ahmedT: continuing from 0.0004 s to 0.001 s on 2 processes",
                                                     "ahmedT: solved to 0.001 s"))
        self.assertIn(f"ahmedT: its forces settled at {settled:g} s: averaging its flow from 0.0004 s", lines)
        self.assertEqual((transient.average_state(case), self.status()["averaging"]),
                         ("on", {"from": 0.0004, "settled": settled}))
        st, run, _ = self.api.handle("GET", "/api/v1/runs/ahmedT", {})
        self.assertEqual(schema.check(run, self.api.RUN_ONE), [])
        self.assertEqual(run["averaging"], {"from": 0.0004, "settled": settled, "written": None})
        uniform = os.path.join(case, "processor0", "0.001", "uniform")         # as OpenFOAM writes it with the time
        os.makedirs(uniform, exist_ok=True)
        with open(os.path.join(uniform, "meanFlowProperties"), "w") as f:
            f.write("U\n{\n    totalIter 4;\n    totalTime 0.0006;\n}\n")
        self.assertEqual(self.api.handle("GET", "/api/v1/runs/ahmedT", {})[1]["averaging"],
                         {"from": 0.0004, "settled": settled, "written": 0.001})
        control = self.text("ahmedT", "system/controlDict")
        for line in (r"startFrom\s+startTime;", r"startTime\s+0\.0004;", r"beginTime\s+0\.0004;",
                     r"writeInterval\s+0\.00015;"):
            self.assertRegex(control, "(?m)^" + line)
        self.assertEqual(self.times("ahmedT")[-4:], ["0.00055", "0.0007", "0.00085", "0.001"])
        self.assertEqual(self.status()["stretches"], [{"from": 0, "to": 0.0004}, {"from": 0.0004, "to": 0.001}])
        self.assertTrue(os.path.isfile(os.path.join(case, "log.foamRun_to_0.001")))
        # A Stop ends it at the time it is at, written
        with mock.patch.dict(os.environ, {"MD_TEST_STOP_AT": "7"}):
            rc, lines = self.solve("ahmedT", 0.002, 2)
        self.assertEqual((rc, lines[-1]), (0, "ahmedT: solved to 0.00135 s, stopped before 0.002 s"))
        st = self.status()
        self.assertEqual((st["state"], st["iteration"], st["stretches"][-1]),
                         ("stopped", 0.00135, {"from": 0.001, "to": 0.00135}))
        self.assertRegex(self.text("ahmedT", "system/controlDict"), r"(?m)^stopAt\s+endTime;")
        self.assertEqual(self.s.latest(case), 0.00135)
        self.assertRefused(self.post({"name": "steady", "to": 60.5}), 400, "bad-request", "whole number")

    def test_a_transient_run_made_before_its_flow_was_averaged_gets_the_averaging_when_it_is_solved_again(self):
        import transient
        self.steady()
        rc, lines = self.solve("ahmedT", 0.0004, 2, None, None, None, "steady", 1, "DDES")
        self.assertEqual(rc, 0, lines)
        case = os.path.join(self.cases, "ahmedT")
        # As an engine before API 1.9 made it: its function objects in its controlDict, and no system/functions
        control = os.path.join(case, "system", "controlDict")
        steady = transient.read(os.path.join(self.cases, "steady", "system", "controlDict"))
        span = transient.block(steady, "functions")
        made = transient.read(control)
        self.assertTrue(span and transient.MOVED in made)
        with open(control, "w") as f:
            f.write(made.replace(transient.MOVED, steady[span[0]:span[1]]))
        os.remove(os.path.join(case, "system", "functions"))
        run = self.api.handle("GET", "/api/v1/runs/ahmedT", {})[1]
        self.assertEqual((transient.average_state(case), run["averaging"]), (None, None))
        # Its forces had settled by the end of that stretch: solved again, it averages from there, as a new run would
        forces = os.path.join(case, "postProcessing", "forcesTotal", "0")
        os.makedirs(forces)
        with open(os.path.join(forces, "forces.dat"), "w") as f:
            for i in range(1, 201):
                f.write(f"{i * 2e-6:g} (({50 + 40 * math.exp(-i / 8) + math.sin(i / 3)} 0 -30) (0 0 0))\n")
        settled = transient.forces_settled(case)
        rc, lines = self.solve("ahmedT", 0.001, 4)
        self.assertEqual((rc, lines[-1]), (0, "ahmedT: solved to 0.001 s"), lines)
        self.assertIn("ahmedT: its function objects moved to system/functions, with the averaging of its flow, as a "
                      "new transient run has them", lines)
        self.assertIn(f"ahmedT: its forces settled at {settled:g} s: averaging its flow from 0.0004 s", lines)
        moved = transient.read(control)
        self.assertEqual((transient.block(moved, "functions"), transient.MOVED in moved), (None, True))
        functions = os.path.join(case, "system", "functions")
        self.assertIn("forcesTotal", transient.read(functions))              # its own function objects, moved
        self.assertEqual((transient.average_state(case), self.status()["averaging"]),
                         ("on", {"from": 0.0004, "settled": settled}))
        self.assertEqual(self.api.handle("GET", "/api/v1/runs/ahmedT", {})[1]["averaging"],
                         {"from": 0.0004, "settled": settled, "written": None})
        # Once: a later stretch leaves them where they are
        before = transient.read(functions)
        rc, lines = self.solve("ahmedT", 0.0012, 2)
        self.assertEqual(rc, 0, lines)
        self.assertFalse([line for line in lines if "system/functions" in line], lines)
        self.assertEqual(transient.read(functions), before)

    def test_a_transient_run_writes_the_times_asked_for_each_stretch_and_keeps_every_one(self):
        import diskguard, schema
        self.steady()
        # 8 times a stretch, evenly to its end, each kept (API 1.10)
        rc, lines = self.solve("ahmedW", 0.0004, 2, None, None, None, "steady", 1, "DDES", 8)
        self.assertEqual(rc, 0, lines)
        case = os.path.join(self.cases, "ahmedW")
        control = self.text("ahmedW", "system/controlDict")
        for line in (r"writeInterval\s+5e-05;", r"purgeWrite\s+0;"):
            self.assertRegex(control, "(?m)^" + line)
        eight = [f"{i * 5e-5:.6g}" for i in range(1, 9)]
        self.assertEqual(self.times("ahmedW"), ["0", *eight])
        st, run, _ = self.api.handle("GET", "/api/v1/runs/ahmedW", {})
        self.assertEqual(schema.check(run, self.api.RUN_ONE), [])
        self.assertEqual((run["transient"]["writes"], run["times"], run["joined"]),
                         (8, [float(t) for t in eight], []))
        os.makedirs(os.path.join(case, "0.0004"))                           # as reconstructPar joins the latest
        run = self.s.describe("ahmedW")
        self.assertEqual((run["times"], run["joined"]), ([float(t) for t in eight], [0.0004]))
        # Continued with 2 a stretch, which it writes from then on
        rc, lines = self.solve("ahmedW", 0.001, 4, None, None, None, None, None, None, 2)
        self.assertEqual((rc, lines[-1]), (0, "ahmedW: solved to 0.001 s"), lines)
        self.assertRegex(self.text("ahmedW", "system/controlDict"), r"(?m)^writeInterval\s+0\.0003;")
        self.assertEqual(self.times("ahmedW")[-3:], ["0.0004", "0.0007", "0.001"])
        self.assertEqual(self.s.transient_of(case)["writes"], 2)
        rc, lines = self.solve("ahmedW", 0.0016, 4)
        self.assertEqual(rc, 0, lines)
        self.assertRegex(self.text("ahmedW", "system/controlDict"), r"(?m)^writeInterval\s+0\.0003;")
        self.assertEqual(len(self.s.describe("ahmedW")["times"]), 12)
        # What a continuation writes: its own 2 a stretch, or the 16 asked for, each kept, with its averages
        mesh = self.s._mesh_mb(case)
        self.assertEqual(self.s.disk_need("ahmedW", 4), (diskguard.solve_mb(mesh, 0, 2, False, True, 2),
                                                         "the continuation of ahmedW needs"))
        self.assertEqual(self.s.disk_need("ahmedW", 4, writes=16)[0], diskguard.solve_mb(mesh, 0, 2, False, True, 16))
        self.assertEqual(self.s.disk("ahmedW", 16)["continueMb"],
                         {"several": diskguard.solve_mb(mesh, 0, 2, False, True, 16),
                          "one": diskguard.solve_mb(mesh, 0, 1, False, True, 16)})
        # A job asks for it as a param, and its command says it
        with mock.patch.object(self.jobs, "busy", lambda ws=None: None):
            st, doc, _ = self.post({"name": "ahmedW", "to": 0.004, "writes": 16})
            self.assertEqual((st, doc["params"]), (202, {"name": "ahmedW", "to": 0.004, "np": 4, "writes": 16}))
            self.assertEqual(self.launched[-1][-6:], ["--to", "0.004", "--writes", "16", "--np", "4"])
            st, doc, _ = self.post({"name": "ahmedX", "steady": "steady", "writes": 40, "np": 2})
            self.assertEqual((st, doc["params"]), (202, {"name": "ahmedX", "to": 0.2088, "np": 2, "steady": "steady",
                                                        "maxCo": 1, "model": "DDES", "writes": 40}))
            self.assertEqual(self.launched[-1][-6:], ["--to", "0.2088", "--writes", "40", "--np", "2"])
            for params, text in (({"name": "t", "steady": "steady", "writes": 0}, "params.writes"),
                                 ({"name": "t", "steady": "steady", "writes": 201}, "params.writes"),
                                 ({"name": "t", "steady": "steady", "writes": 2.5}, "params.writes"),
                                 ({"name": "t", "source": "mine", "writes": 8}, "go with a transient run"),
                                 ({"name": "t", "template": "ahmed-body", "writes": 8}, "go with a transient run"),
                                 ({"name": "steady", "to": 60, "writes": 8}, "steady is a steady run: the times")):
                self.assertRefused(self.post(params), 400, "bad-request", text)
        for argv, said in ((["ahmedW", "--to", "0.005", "--writes", "many"], "--writes takes a whole number"),
                           (["ahmedW", "--to", "0.005", "--writes", "0"], "a whole number from 1 to 200")):
            with self.assertRaises(SystemExit) as e:
                self.s.main(argv)
            self.assertIn(said, str(e.exception))
        # A run made before it could ask wrote 4 a stretch and kept the template's 2: continued, it keeps every one
        marker = os.path.join(case, self.jobs.CASE_MARKER)
        with open(marker) as f:
            doc = json.load(f)
        del doc["writes"]
        with open(marker, "w") as f:
            json.dump(doc, f)
        path = os.path.join(case, "system", "controlDict")
        with open(path) as f:
            text = re.sub(r"(?m)^purgeWrite\s+0;", "purgeWrite      2;", f.read())
        with open(path, "w") as f:
            f.write(text)
        self.assertEqual((self.s.transient_of(case)["writes"], self.s.describe("ahmedW")["transient"]["writes"]),
                         (4, 4))
        rc, lines = self.solve("ahmedW", 0.002, 4)
        self.assertEqual(rc, 0, lines)
        control = self.text("ahmedW", "system/controlDict")
        for line in (r"writeInterval\s+0\.0001;", r"purgeWrite\s+0;"):
            self.assertRegex(control, "(?m)^" + line)
        # Unsplit, each time it writes is its own, joined
        rc, lines = self.solve("ahmedS", 0.0004, 1, None, None, None, "steady", 1, "DDES")
        self.assertEqual(rc, 0, lines)
        run = self.s.describe("ahmedS")
        self.assertEqual((run["nProcs"], run["times"], run["joined"]),
                         (1, [0.0001, 0.0002, 0.0003, 0.0004], [0.0001, 0.0002, 0.0003, 0.0004]))

    def test_a_transient_runs_time_left_counts_its_time_steps(self):
        saved = dict(self.api._live)
        import schema, server
        self.api.provide(run_live=server.solve_live)
        self.addCleanup(lambda: (self.api._live.clear(), self.api._live.update(saved)))
        self.addCleanup(server._solve_cache.clear)
        self.steady()
        self.assertEqual(self.solve("ahmedT", 0.0004, 2, None, None, None, "steady", 1, "DDES")[0], 0)
        case = os.path.join(self.cases, "ahmedT")
        status = self.status()
        status.update(state="running", start=0.0004, end=0.001, iteration=0.0005)
        with open(os.path.join(case, self.jobs.SOLVE_STATUS), "w") as f:
            json.dump(status, f)
        with open(os.path.join(case, "log.foamRun_to_0.001"), "w") as f:
            f.write("".join(f"deltaT = 2e-05\nTime = {0.0004 + i * 2e-05:.6g}s\n\n"
                            f"ExecutionTime = {i:.2f} s  ClockTime = {3 * i} s\n\n" for i in range(1, 6)))
        server._solve_cache.clear()
        with mock.patch.object(self.s, "solving", lambda name: True):
            st, doc, _ = self.api.handle("GET", "/api/v1/runs/ahmedT/live", {})
        self.assertEqual(st, 200, doc)
        self.assertEqual(schema.check(doc, self.api.RUN_LIVE), [])
        s = doc["solver"]
        self.assertEqual((s["state"], s["iteration"], s["deltaT"], s["wall_per_it"], s["end"], s["log"]),
                         ("running", 0.0005, 2e-05, 3.0, 0.001, "log.foamRun_to_0.001"))
        self.assertAlmostEqual(s["eta"], 75.0)                               # 25 time steps of 20 us, 3 s each
        self.assertEqual(doc["current"], {"name": "Continued", "from": 0.0004, "to": 0.001})

    def test_a_transient_runs_page_judges_it_in_time_steps_as_the_judge_route_does(self):
        saved = dict(self.api._live)
        import schema, server
        self.api.provide(run_live=server.solve_live)
        self.addCleanup(lambda: (self.api._live.clear(), self.api._live.update(saved)))
        self.addCleanup(server._solve_cache.clear)
        self.addCleanup(server._tjudged.clear)
        self.steady()
        self.assertEqual(self.solve("ahmedT", 0.0004, 2, None, None, None, "steady", 1, "DDES")[0], 0)
        case = os.path.join(self.cases, "ahmedT")
        # 60 time steps of PIMPLE, each converged by its last outer corrector, the forces swinging about a steady mean
        write_transient_run(case, 60, 5e-4, 0.8, lambda i: 40 + math.sin(i / 3), log="log.foamRun")
        server._solve_cache.clear()
        st, doc, _ = self.api.handle("GET", "/api/v1/runs/ahmedT/live", {})
        self.assertEqual(st, 200, doc)
        self.assertEqual(schema.check(doc, self.api.RUN_LIVE), [])
        j = doc["judge"]
        self.assertEqual((j["transient"], j["window"], j["steps"]["n"], j["steps"]["outerIterations"]),
                         (True, 30, 30, 2))                                  # the last half of its time steps
        self.assertEqual(j["verdict"], "converged (statistically stationary, every time step converged)")
        st, whole, _ = self.api.handle("GET", "/api/v1/judge", {"case": "ahmedT", "window": "30"})
        self.assertEqual((st, whole["verdict"], whole["steps"]), (200, j["verdict"], j["steps"]))
        # as its run's judge link asks for it, over the last half of its time steps (API 1.11), where the route's
        # 200 by default finds its 60 too short
        st, run, _ = self.api.handle("GET", "/api/v1/runs/ahmedT", {})
        self.assertEqual(run["links"]["judge"], "/api/v1/judge?case=ahmedT&window=auto")
        st, auto, _ = self.api.handle("GET", "/api/v1/judge", {"case": "ahmedT", "window": "auto"})
        self.assertEqual((st, auto["window"], auto["verdict"], auto["steps"]), (200, 30, j["verdict"], j["steps"]))
        st, short, _ = self.api.handle("GET", "/api/v1/judge", {"case": "ahmedT"})
        self.assertEqual((st, short["window"], short["verdict"]), (200, 200, "too short"))
        op = self.api.openapi()["paths"]["/judge"]["get"]
        window = next(p for p in op["parameters"] if p["name"] == "window")
        self.assertEqual(window["schema"]["anyOf"][1], {"enum": ["auto"]})
        # It reads the run's whole logs: while it solves, it is judged again at most every JUDGE_S; once it has
        # ended, as soon as they change
        write_transient_run(case, 40, 5e-4, 1.5, lambda i: 40.0, log="log.foamRun")
        self.assertIs(server._transient_judge("ahmedT", case, True), server._tjudged["ahmedT"][2])
        self.assertEqual(server._transient_judge("ahmedT", case, True)["window"], 30)
        later = server._transient_judge("ahmedT", case, False)
        self.assertEqual((later["window"], later["steps"]["maxCourant"]), (20, 1.5))
        self.assertIn("max Courant 1.5", later["verdict"])
        # its time steps: the time step and the Courant number, mean and largest, at each
        server._solve_cache.clear()
        steps = server.solve_live("ahmedT")["steps"]
        self.assertEqual((steps["cols"], len(steps["rows"])), (["Time", "deltaT", "coMean", "coMax"], 40))
        self.assertEqual(steps["rows"][1][2:], [0.05, 1.5])
        self.assertAlmostEqual(steps["rows"][1][1], 1e-3)
        # past 1500 rows, each row a run of steps: their mean time step and Courant number, the largest of their largest
        many = [{"t": i * 1e-3, "deltaT": 1e-3, "coMean": 0.05, "coMax": 3.0 if i == 2001 else 0.8} for i in range(4000)]
        rows = server._step_rows(many)["rows"]
        self.assertLessEqual(len(rows), 1500)
        self.assertEqual(rows[-1][0], 3.999)
        self.assertEqual(max(r[3] for r in rows), 3.0)
        self.assertAlmostEqual(rows[0][1], 1e-3)
        # a steady run's page keeps the live judge of its iterations, and has no time steps
        self.assertNotIn("transient", server.solve_live("steady")["judge"])
        self.assertNotIn("steps", server.solve_live("steady"))

    def test_the_command_starts_a_transient_run_of_a_steady_one_and_continues_it_by_time(self):
        self.steady()
        for argv, text in ((["t", "--steady", "steady", "--co", "x"], "--co takes a number"),
                           (["t", "--steady", "steady", "--model"], "--model takes a name"),
                           (["t", "--steady", "steady", "--to", "-1"], "--to is 1 to"),
                           (["t", "--steady", "steady", "--model", "LES"], "the model is DDES or URANS"),
                           (["t", "--co", "1"], "go with a steady run")):
            with self.assertRaises(SystemExit) as e:
                self.s.main(argv)
            self.assertIn(text, str(e.exception))
        asked, out = [], io.StringIO()
        with mock.patch.object(self.s.ramguard, "check", lambda case, step: asked.append((case, step)) or (True, "")), \
                contextlib.redirect_stdout(out):
            rc = self.s.main(["t", "--steady", "steady", "--to", "0.0004", "--np", "1"])
        self.assertEqual(rc, 0, out.getvalue())
        self.assertEqual(asked, [(os.path.join(self.cases, "steady"), "solve")])        # its steady run's mesh
        run = self.s.describe("t")
        self.assertEqual((run["written"], run["transient"]["maxCo"], run["transient"]["model"]), (0.0004, 1, "DDES"))
        self.assertEqual((self.s.split(os.path.join(self.cases, "t")), self.times("t", ".")[-1]), (0, "0.0004"))
        with self.assertRaises(SystemExit) as e:
            self.s.main(["t"])                                                 # a transient run says its time
        self.assertIn("give the time in s to continue it to", str(e.exception))


def sparse(path, nbytes):
    """A file of `nbytes` that takes next to no room (a sparse file)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.truncate(nbytes)


class DiskGuardTest(unittest.TestCase):
    """diskguard.py: what a copy writes, measured as the copy walks it; what a solve writes, from its mesh; the free
    space, at most the Windows drive's inside WSL; and the refusal, with its numbers."""

    def setUp(self):
        import diskguard, templates
        self.g, self.t = diskguard, templates
        self.d = tempfile.mkdtemp(prefix="disk_test_")
        self.addCleanup(shutil.rmtree, self.d, True)

    @staticmethod
    def write(root, files):
        for rel, text in files.items():
            path = os.path.join(root, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                f.write(text)

    @staticmethod
    def bytes_in(root):
        return sum(os.path.getsize(os.path.join(d, n)) for d, _, names in os.walk(root) for n in names)

    def test_a_join_takes_three_quarters_of_its_split_fields_and_shares_a_disk_with_its_neighbours(self):
        self.assertEqual(self.g.join_mb(8 * self.g.MB), 8)              # as much as split (measured: 0.96 of it)
        self.assertEqual(self.g.join_mb(1), 1)                          # a byte or more is 1 MB
        self.assertTrue(self.g.same_disk(self.d, os.path.join(self.d, "not", "made", "yet")))   # the nearest above
        self.assertFalse(self.g.same_disk(self.d, ""))                  # one that can't be read

    def test_a_copy_is_measured_file_by_file_as_the_copy_walks_it(self):
        src, outside = os.path.join(self.d, "cases", "yours"), os.path.join(self.d, "surfaces")
        self.write(outside, {"body.stl": "solid body\n" * 50})
        self.write(src, {"system/controlDict": "application foamRun;\n", "constant/polyMesh/owner": "o" * 4000,
                         "constant/polyMesh/faces": "f" * 9000, "0.orig/U": "internalField uniform (40 0 0);\n",
                         "100/U": "a result\n" * 99, "processor0/constant/polyMesh/owner": "split\n" * 99,
                         "postProcessing/forces/0/forces.dat": "100 40\n" * 99, "log.foamRun": "Time = 100\n",
                         ".meshdoctor-solve.json": "{}"})
        os.symlink(outside, os.path.join(src, "constant", "triSurface"))     # followed, as the copy follows it
        os.symlink(os.path.join(self.d, "gone"), os.path.join(src, "constant", "old"))     # dangling: left out
        os.symlink(src, os.path.join(src, "constant", "again"))            # round to the case itself: left out
        new = os.path.join(self.d, "cases", "copy")
        os.mkdir(new)
        need = self.t.copy_size(src, new)
        self.t.copy(src, new)
        self.assertEqual(sorted(os.listdir(new)), ["0", "0.orig", "constant", "system"])
        self.assertEqual(need, self.bytes_in(new))                          # 0.orig twice: it is the copy's 0 too
        self.assertEqual(self.t.copy_size(src), need)                       # and for a copy not named yet
        self.assertEqual(self.g.mb(need), 1)
        self.assertEqual((self.g.mb(0), self.g.mb(self.g.MB), self.g.mb(self.g.MB + 1)), (0, 1, 2))
        loop = os.path.join(self.d, "loop")
        self.write(loop, {"f": "0123456789"})
        os.symlink(loop, os.path.join(loop, "me"))                          # round and round: it still ends
        self.assertGreaterEqual(self.g.size(loop), 10)

    def test_a_solve_writes_its_split_and_the_times_it_keeps_from_the_size_of_its_mesh(self):
        # (mesh MB, purgeWrite, processes[, from the start]): the measured 3.25 and 1.2 times the mesh, keeping 2
        for args, mb in (((100, 2, 6), 325), ((100, 2, 1), 120), ((100, 2, 6, False), 60), ((100, 2, 1, False), 0),
                         ((100, 0, 6), 485), ((100, 0, 1), 240), ((100, 0, 6, False), 380), ((100, 0, 1, False), 240),
                         ((100, 1, 2), 245), ((100, 9, 2), 485), ((1, 2, 2), 4),
                         # a transient run's written times hold its averages too: 2.1 times as much
                         ((100, 2, 6, True, True), 567), ((100, 2, 1, True, True), 252),
                         ((100, 2, 6, False, True), 126), ((100, 0, 1, False, True), 504),
                         # and as many written times as a transient run's stretch asks for, each kept
                         ((100, 0, 6, True, True, 4), 903), ((100, 0, 6, True, True, 16), 2919),
                         ((100, 0, 1, True, True, 16), 2016), ((100, 0, 6, False, True, 16), 2814),
                         ((100, 2, 2, True, False, 1), 245)):
            self.assertEqual(self.g.solve_mb(*args), mb, args)
        self.assertEqual(self.g.mesh_mb(480_000), 66)                        # the coarse Ahmed body's: 65.6 MB

    def test_a_new_case_a_repair_an_ab_test_and_running_it_longer_from_the_sizes_they_start_from(self):
        mib = self.g.MB
        self.assertEqual(self.g.made_mb(480_000), 68)                       # its mesh, and 3 % of sets beside it
        # a repair: its copy and its points' backup, then of its mesh: 3 % of sets, and 2 times to collapse faces
        self.assertEqual(self.g.repair_mb(10 * mib, 2 * mib, 100), 12 + 203)
        self.assertEqual(self.g.repair_mb(0, 0, 0), 0)
        # an A/B test: two runs (one when it reuses an earlier test's first run), each a copy of the case, its split
        # onto its processes (1.05) and two written times, split (2 x 0.8)
        self.assertEqual(self.g.ab_mb(101 * mib, 100), 2 * (101 + 265))
        self.assertEqual(self.g.ab_mb(101 * mib, 100, runs=1), 101 + 265)
        self.assertEqual((self.g.extend_mb(100, 2), self.g.extend_mb(100, 1), self.g.extend_mb(1, 1)), (160, 80, 1))

    def test_a_link_a_copy_keeps_as_a_link_takes_no_room(self):
        case, outside = os.path.join(self.d, "case"), os.path.join(self.d, "surfaces")
        self.write(outside, {"body.stl": "solid body\n" * 50})
        self.write(case, {"constant/polyMesh/owner": "o" * 4000})
        os.symlink(outside, os.path.join(case, "constant", "triSurface"))
        os.symlink(os.path.join(outside, "body.stl"), os.path.join(case, "constant", "body.stl"))
        self.assertEqual(self.g.size(os.path.join(case, "constant"), links=False), 4000)
        self.assertEqual(self.g.size(os.path.join(case, "constant")), 4000 + 2 * 550)      # followed: both

    def test_a_repair_measures_the_copy_it_makes_and_the_mesh_it_repairs(self):
        import repair
        mib, owner = self.g.MB, 'FoamFile\n{\n    note "nPoints:900 nCells:%d nFaces:2000 nInternalFaces:1500";\n}\n'
        src, outside, work = (os.path.join(self.d, n) for n in ("case", "surfaces", "work"))
        self.write(outside, {"body.stl": "solid body\n" * 50})
        self.write(src, {"system/controlDict": "application foamRun;\n", "constant/polyMesh/owner": owner % 480,
                         "0/U": "u" * 99, "100/U": "a result\n" * 99, "log.foamRun": "Time = 100\n"})
        sparse(os.path.join(src, "constant", "polyMesh", "points"), 2 * mib)
        os.symlink(outside, os.path.join(src, "constant", "triSurface"))     # copied as a link: no room

        def copied():
            with mock.patch.object(repair, "ROOT", work):
                need, dst = repair.copy_size(src), repair.copy_case(src, "case-fix")
            files = [os.path.join(d, n) for d, _, names in os.walk(dst) for n in names if n != ".meshDoctorCopy"]
            self.assertEqual(need, sum(os.path.getsize(p) for p in files if not os.path.islink(p)))
            self.assertTrue(os.path.islink(os.path.join(dst, "constant", "triSurface")))
            return need
        need = copied()
        # in serial, the case's own mesh is repaired (2 MB and its owner: 3 MB): its sets and room to collapse faces
        self.assertEqual(repair.disk_need(src), self.g.repair_mb(need, 2 * mib, 3))
        # its processors' meshes when the case's own isn't the whole of them: each copied, each one's points backed up
        self.write(src, {"processor0/constant/polyMesh/owner": owner % 400, "processor0/100/U": "x" * 99})
        sparse(os.path.join(src, "processor0", "constant", "polyMesh", "points"), mib)
        need = copied()
        self.assertEqual(repair.disk_need(src), self.g.repair_mb(need, 3 * mib, 2))

    def test_an_ab_test_measures_the_copy_each_of_its_runs_makes(self):
        import abtest
        src, outside = os.path.join(self.d, "case"), os.path.join(self.d, "surfaces")
        self.write(outside, {"body.stl": "solid body\n" * 50})
        self.write(src, {"system/controlDict": "application foamRun;\n",
                         "system/decomposeParDict": "numberOfSubdomains 2;", "0.warm/U": "w" * 300, "0/U": "u" * 99,
                         "100/U": "a result\n" * 99, "log.foamRun": "Time = 100\n"})
        sparse(os.path.join(src, "constant", "polyMesh", "points"), self.g.MB)
        os.symlink(outside, os.path.join(src, "constant", "triSurface"))     # followed, as the copy follows it
        need, dst = abtest.copy_size(src, "0.warm"), os.path.join(self.d, "work", "case_ab", "base")
        abtest.make_case(src, dst, "0.warm")
        self.assertEqual(need, self.bytes_in(dst) - os.path.getsize(os.path.join(dst, ".meshDoctorCopy")))
        self.assertEqual(abtest.disk_need(src, "0.warm"), self.g.ab_mb(need, 1))           # its mesh: 1 MB
        self.assertEqual(abtest.disk_need(src, "0.warm", runs=1), self.g.ab_mb(need, 1, 1))

    def test_running_an_ab_tests_second_run_longer_counts_each_time_it_writes(self):
        import abtest
        for (start, end), n in (((200, 1000), 2), ((200, 300), 1), ((400, 401), 1), ((1000, 5000), 2),
                                ((400, 600), 1)):
            self.assertEqual(abtest.extend_writes(start, end), n, (start, end))
        for start in range(20, 420, 20):           # as the solver writes: each iteration that is a multiple of it
            for end in range(start + 1, start + 300, 7):
                every = abtest.end_write_interval(start, end)
                written = [i for i in range(start + 1, end + 1) if i % every == 0]
                self.assertEqual(abtest.extend_writes(start, end), len(written), (start, end))
                self.assertEqual(written[-1], end)                          # its last is where it ends
        fixed = os.path.join(self.d, "fixed")
        sparse(os.path.join(fixed, "constant", "polyMesh", "points"), self.g.MB)
        self.assertEqual(abtest.extend_need(fixed, 200, 1000), self.g.extend_mb(1, 2))      # at 500 and 1000

    def test_inside_wsl_the_free_space_is_at_most_the_windows_drives_that_holds_linuxs_disk(self):
        from collections import namedtuple
        usage, gb = namedtuple("usage", "total used free"), 1024 * self.g.MB

        def disk_usage(path):
            return usage(0, 0, 3 * gb if path == self.g.WINDOWS_DRIVE else 50 * gb)
        with mock.patch.object(self.g.shutil, "disk_usage", disk_usage), \
                mock.patch.object(self.g.os.path, "ismount", lambda p: p == self.g.WINDOWS_DRIVE):
            with mock.patch.object(self.g, "_wsl", lambda: True):
                self.assertEqual(self.g.free_mb(os.path.join(self.d, "cases", "new")), 3 * 1024)   # the drive's
                self.assertIsNone(self.g._windows_free("/mnt/d/cases"))     # a case on a Windows drive: its own
            with mock.patch.object(self.g, "_wsl", lambda: False):
                self.assertEqual(self.g.free_mb(os.path.join(self.d, "cases", "new")), 50 * 1024)
        self.assertIsInstance(self.g._wsl(), bool)
        self.assertIsInstance(self.g.free_mb(self.d), int)

    def test_a_job_that_wont_fit_with_the_space_kept_free_is_refused_with_its_numbers(self):
        what = "the copy of yours and its solve need"
        with mock.patch.object(self.g, "free_mb", lambda folder: 3000):
            self.assertEqual(self.g.check(3000 - self.g.KEEP_MB, self.d, what),
                             (True, "the copy of yours and its solve need about 1.9 GB, and the disk has 2.9 GB free"))
            self.assertEqual(self.g.check(3000 - self.g.KEEP_MB + 1, self.d, what), (False, (
                "not enough disk space: the copy of yours and its solve need about 1.9 GB, and the disk has 2.9 GB "
                "free (the engine keeps 1.0 GB free). Delete runs or results you no longer need, then try again.")))
        with mock.patch.object(self.g, "free_mb", lambda folder: None):
            self.assertTrue(self.g.check(10 ** 9, self.d, what)[0])          # unknown free space: let through
        self.assertTrue(self.g.check(None, self.d, what)[0])                 # and an unknown need
        for mb, text in ((0, "1 MB"), (70, "70 MB"), (1023, "1,023 MB"), (2458, "2.4 GB"), (421_888, "412 GB")):
            self.assertEqual(self.g.text(mb), text)


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
    def checking(self, foam, cases=True, free=8192, pv=("/opt/x/bin/pvbatch", "5.10.0-RC1")):
        """selfcheck with a temporary cases folder (or none), workspace and bashrc, the given OpenFOAM environment,
        free memory and ParaView (selfcheck.paraview's answer); yields (selfcheck, the temporary folder)."""
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
                mock.patch.object(selfcheck, "paraview", return_value=pv), \
                mock.patch.dict(os.environ, {"MESHDOCTOR_PROG": "meshdoctor"}):
            yield selfcheck, tmp

    def run_check(self, foam, **kw):
        out = io.StringIO()
        with self.checking(foam, **kw) as (selfcheck, _), contextlib.redirect_stdout(out):
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

    def test_paraview_is_only_a_warning_as_only_pictures_of_the_flow_need_it(self):
        import api_v1
        said = {("/opt/x/bin/pvbatch", "5.10.0-RC1"): ("ok", "5.10.0-RC1", None, None),
                ("/opt/x/bin/pvbatch", None): ("warn", "pvbatch found, but it doesn't start",
                                               "pictures of the flow need it: install ParaView again",
                                               "sudo apt install --reinstall paraview python3-paraview"),
                (None, None): ("warn", "pvbatch not found", "only pictures of the flow need it (about 600 MB)",
                               "sudo apt install paraview python3-paraview")}
        for pv, (state, found, fix, command) in said.items():
            with self.subTest(pv=pv), self.checking(self.foam(), pv=pv) as (selfcheck, _):
                doc = selfcheck.report()
                self.assertEqual(self.schema_problems(doc, api_v1.READINESS), [])
                self.assertEqual({c["id"]: c for c in doc["checks"]}["pvbatch"],
                                 {"id": "pvbatch", "label": "ParaView", "group": "pictures", "state": state,
                                  "found": found, "fix": fix, "command": command})
                self.assertTrue(doc["ready"])                   # a warning: a repair, an A/B test and a solve still run
                self.assertEqual([c["group"] for c in doc["checks"]][-2:], ["pictures", "memory"])
                self.assertNotIn("/opt/x", json.dumps(doc))
        # The command says where it is, and a missing one is a warning there too: still ready
        code, out = self.run_check(self.foam())
        self.assertRegex(out, r"ok    ParaView +5\.10\.0-RC1, /opt/x/bin/pvbatch\n")
        code, out = self.run_check(self.foam(), pv=(None, None))
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r"warn  ParaView +pvbatch not found; only pictures of the flow need it \(about 600 MB\): "
                              r"sudo apt install paraview python3-paraview\n")
        self.assertIn("\nready\n", out)

    def test_paraview_asks_pvbatch_its_version_with_its_python_modules(self):
        import selfcheck
        tmp = tempfile.mkdtemp(prefix="md_pv_")
        self.addCleanup(shutil.rmtree, tmp, True)
        pv, said = os.path.join(tmp, "pvbatch"), os.path.join(tmp, "pythonpath")

        def stand_in(code, text):
            with open(pv, "w") as f:
                f.write(f"#!/bin/sh\necho \"$PYTHONPATH\" > '{said}'\necho '{text}'\nexit {code}\n")
            os.chmod(pv, 0o755)
        with mock.patch.dict(os.environ, {"PATH": tmp + os.pathsep + "/usr/bin:/bin"}):
            stand_in(0, "paraview version 5.10.0-RC1")
            self.assertEqual(selfcheck.paraview(), (pv, "5.10.0-RC1"))
            with open(said) as f:
                self.assertEqual(f.read().strip(), "/usr/lib/python3/dist-packages")
            stand_in(1, "pvbatch: error while loading shared libraries")         # found, but it doesn't start
            self.assertEqual(selfcheck.paraview(), (pv, None))
            stand_in(0, "no version here")
            self.assertEqual(selfcheck.paraview(), (pv, None))
        with mock.patch.dict(os.environ, {"PATH": os.path.join(tmp, "none")}):
            self.assertEqual(selfcheck.paraview(), (None, None))

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


class PicturesTest(unittest.TestCase):
    """meshdoctor pictures and the `pictures` job (app item 250a): ParaView reads the case through a folder of links
    in the workspace, and the pictures and their list go there too; a stand-in pvbatch writes what each script
    would."""

    STAND_IN = """#!/usr/bin/env python3
import os, sys
a = sys.argv[1:]
if a == ["--version"]:
    print("paraview version 5.10.0")
    sys.exit(0)
if a[2:3] == ["--selftest"]:
    import json
    with open(os.path.join(os.path.dirname(a[3]), "selftests"), "a") as f:
        f.write(a[3] + "\\n")
    how = os.environ.get("MD_TEST_SELFTEST", "pass")
    if how == "crash":
        sys.exit(9)
    with open(os.path.join(a[3], "selftest.json"), "w") as f:
        json.dump({"passed": how == "pass", "reason": "the test vortex came out red" if how == "pass" else
                   "the picture of the test vortex is blank: ParaView drew nothing offscreen"}, f)
    sys.exit(0 if how == "pass" else 3)
script, foam = os.path.basename(a[1]), a[2]
view = os.path.dirname(foam)
procs = sorted(n for n in os.listdir(view) if n.startswith("processor"))
with open(os.path.join(os.path.dirname(view), "seen"), "a") as f:
    f.write(script + " " + os.environ.get("PYTHONPATH", "") + " " + " ".join(sorted(os.listdir(view)))
            + "".join(" %s:%s" % (p, ",".join(sorted(os.listdir(os.path.join(view, p))))) for p in procs)
            + (" split" if "decomposed" in a or "--decomposed" in a else "")
            + (" --mean" if "--mean" in a else "") + (" --over-time" if "--over-time" in a else "") + "\\n")
out = a[3] if script == "vortex_views.py" else a[4]
if os.environ.get("MD_TEST_PV_FAILS") == script:
    sys.exit(2)
if script == "pressure_spots.py" and os.environ.get("MD_TEST_NO_SPOTS"):
    print("ahmed: 17510 faces, 0.763 m2, pressure force (-12.80, 66.43, 21.85) N, Cp -2.0 .. 1.00")
    sys.exit(0)
names = {"cut_views.py": ["c1_side_centre_U", "c1_side_centre_Cpt"], "vortex_views.py": ["Q210000_rear34",
         "Q21000_rear34", "Q21000_top"], "pressure_spots.py": ["spots_Cp_spot_closeup", "spots_Cp_spot_normal",
         "spots_Cp_spot_side"]}.get(script, [])
if script == "fastest_cells.py":                                # the cells that set the time step: views, places
    import json
    with open(a[a.index("--places") + 1]) as f:
        places = json.load(f)["places"]
    with open(os.path.join(os.path.dirname(view), "seen"), "a") as f:
        f.write("cells: " + " ".join(sorted(os.listdir(a[5]))) + "\\n")
    names = ["fastest_side", "fastest_top", "fastest_front34"]
    names += ["fastest_place%d" % (i + 1) for i in range(len(places))]
if script == "cut_views.py" and a[5] == "auto":
    import json
    with open(os.path.join(out, "cuts.json"), "w") as f:
        json.dump({"cuts": [{"name": "a1_side_centre", "title": "Side cut on the model's centre plane"}]}, f)
    names = ["a1_side_centre_U"]
here = os.path.join(view, procs[0]) if procs else view
written = sorted((d for d in os.listdir(here) if d[:1].isdigit()), key=float)
if script == "cut_views.py" and "--over-time" in a:             # the first cut's speed at each time it has
    names = ["%s_U_at_%s" % (names[0][:-2], t) for t in written]
elif script == "cut_views.py" and "--mean" in a and os.path.exists(os.path.join(here, written[-1], "UPrime2Mean")):
    names = names + [names[0][:-2] + "_Urms"]                   # how much the mean flow's speed swings
for n in names:
    open(os.path.join(out, n + ".png"), "wb").close()
"""
    FRAME = {"total": "forcesTotal", "flowAxis": 0, "flowSign": -1, "upAxis": 2, "Uinf": 40.0, "rho": 1.205}

    def setUp(self):
        import pictures
        self.p = pictures
        self.tmp = tempfile.mkdtemp(prefix="md_pictures_")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        bin_ = os.path.join(self.tmp, "bin")
        os.mkdir(bin_)
        with open(os.path.join(bin_, "pvbatch"), "w") as f:
            f.write(self.STAND_IN)
        os.chmod(os.path.join(bin_, "pvbatch"), 0o755)
        self.path = bin_ + os.pathsep + "/usr/bin:/bin"
        self.frame = dict(self.FRAME)
        for patch in (mock.patch.dict(os.environ, {"PATH": self.path}),
                      mock.patch("sys.stdout", new_callable=io.StringIO),     # make() says each kind, for a job's log
                      mock.patch.object(pictures.caseinfo, "describe", side_effect=lambda case: dict(self.frame))):
            patch.start()
            self.addCleanup(patch.stop)

    def case(self, cuts=True, times=("200",), mean=None):
        """The case ahmedP in the cases folder; `mean`: {a time with a mean flow: how long it was averaged, in s}."""
        case = os.path.join(self.tmp, "cases", "ahmedP")
        for d in ("system", os.path.join("constant", "polyMesh")) + tuple(times):
            os.makedirs(os.path.join(case, d))
        with open(os.path.join(case, "system", "controlDict"), "w") as f:
            f.write("application foamRun;\nfunctions\n{\n    forcesTotal   // the whole body\n    {\n"
                    "        type forces;\n        patches (ahmedGroup);\n    }\n}\n")
        with open(os.path.join(case, "constant", "polyMesh", "boundary"), "w") as f:
            f.write("FoamFile\n{\n    class polyBoundaryMesh;\n}\n3\n(\n    inlet\n    {\n        type patch;\n    }\n"
                    "    ahmed\n    {\n        type wall;\n        inGroups List<word> 2(ahmedGroup wall);\n    }\n"
                    "    ground\n    {\n        type wall;\n        inGroups 1(wall);\n    }\n)\n")
        for t in times:
            for field in ("U", "p") + (self.p.MEAN if t in (mean or {}) else ()):
                open(os.path.join(case, t, field), "w").close()
            if t in (mean or {}):                                       # the averaging's own record of how long
                os.makedirs(os.path.join(case, t, "uniform"))
                with open(os.path.join(case, t, "uniform", "meanFlowProperties"), "w") as f:
                    f.write("FoamFile\n{\n    object meanFlowProperties;\n}\nU\n{\n    totalIter 6;\n    totalTime "
                            + mean[t] + ";\n}\np\n{\n    totalIter 6;\n    totalTime " + mean[t] + ";\n}\n")
        if cuts:
            shutil.copy(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "examples", "ahmed-body",
                                     "cuts.json"), case)
        return case

    @staticmethod
    def files(folder):
        return sorted(os.path.relpath(os.path.join(d, f), folder) for d, _, fs in os.walk(folder) for f in fs)

    @staticmethod
    def split(case, times, procs=2, sizes=None):
        """`case` split onto `procs` processes, with the flow (U and p) at these times in each processor folder;
        `sizes`: {field: its bytes in each one}."""
        for n in range(procs):
            os.makedirs(os.path.join(case, f"processor{n}", "constant", "polyMesh"), exist_ok=True)
            for t in times:
                os.makedirs(os.path.join(case, f"processor{n}", t))
                for field in ("U", "p"):
                    with open(os.path.join(case, f"processor{n}", t, field), "wb") as f:
                        f.write(b"x" * (sizes or {}).get(field, 0))

    def ours(self, case):
        """`case` made by Mesh Doctor (its marker says done), and OpenFOAM's environment a stand-in reconstructPar's,
        which joins a time into the case's own folder (or, with MD_TEST_JOIN=fail, writes U only and stops) and lists
        each join it makes in <case>/joins."""
        import jobs
        with open(os.path.join(case, jobs.CASE_MARKER), "w") as f:
            json.dump({"state": "done", "template": "ahmed-body"}, f)
        foam = os.path.join(self.tmp, "foam")
        os.makedirs(foam)
        with open(os.path.join(foam, "reconstructPar"), "w") as f:
            f.write("#!/usr/bin/env python3\nimport os, sys\nt = sys.argv[sys.argv.index('-time') + 1]\n"
                    "open('joins', 'a').write(' '.join(sys.argv[1:]) + '\\n')\n"
                    "os.makedirs(t, exist_ok=True)\nopen(os.path.join(t, 'U'), 'w').close()\n"
                    "if os.environ.get('MD_TEST_JOIN') == 'fail':\n    sys.exit(1)\n"
                    "for f in ('p', 'k'):\n    open(os.path.join(t, f), 'w').close()\n")
        os.chmod(os.path.join(foam, "reconstructPar"), 0o755)
        bashrc = os.path.join(self.tmp, "bashrc")
        with open(bashrc, "w") as f:
            f.write(f"export WM_PROJECT_DIR=/nowhere\nexport PATH={foam}:$PATH\n")
        patch = mock.patch.dict(os.environ, {"MESHDOCTOR_FOAM_BASHRC": bashrc})
        patch.start()
        self.addCleanup(patch.stop)

    def test_a_time_split_onto_the_processes_is_one_to_picture(self):
        import jobs, solve
        case = self.case(times=("100",))
        self.split(case, ("100", "150", "200"))
        self.assertEqual(self.p.kept(case), {"100": "joined", "150": "split", "200": "split"})
        self.assertEqual((self.p.times(case), self.p.latest(case), self.p.processors(case)),
                         (["100"], "200", ["processor0", "processor1"]))
        self.assertIsNone(self.p.why_not(case, "150"))
        self.assertEqual(self.p.why_not(case, "175"),
                         ("bad-request", "ahmedP has no written time 175 with its flow (U and p); its latest are 100, "
                                         "150, 200"))
        os.remove(os.path.join(case, "processor1", "200", "p"))          # in every processor folder, or not at all
        self.assertEqual(list(self.p.kept(case)), ["100", "150"])
        self.assertEqual([self.p.how(case, t) for t in ("100", "150")], ["joined", "split"])    # a case you made
        self.ours(case)
        self.assertEqual(self.p.how(case, "150"), "join")                 # a run Mesh Doctor made
        link = os.path.join(self.tmp, "cases", "linked")
        os.symlink(case, link)
        self.assertEqual(self.p.how(link, "150"), "split")                # reached through a link: only read
        os.makedirs(os.path.join(case, "150"))                            # a join cut short: not joined
        for f in ("U", "p", jobs.JOINING):
            open(os.path.join(case, "150", f), "w").close()
        self.assertEqual((self.p.kept(case)["150"], self.p.times(case)), ("split", ["100"]))
        self.assertEqual(solve.times(case), ([100, 150, 200], [100]))
        os.remove(os.path.join(case, "150", jobs.JOINING))
        self.assertEqual((self.p.times(case), solve.times(case)[1]), (["100", "150"], [100, 150]))

    def test_a_case_you_made_is_read_split_through_links_of_its_own(self):
        case = self.case(times=("100",))
        self.split(case, ("100", "150"), procs=3)
        before = self.files(case)
        out = os.path.join(self.tmp, "set")
        cmds, _ = self.p.plan(case, "/view", out, self.p.KINDS, "pvbatch", split=True)
        self.assertEqual((cmds["cuts"][4], cmds["spots"][4], cmds["vortices"][-1]),
                         ("decomposed", "decomposed", "--decomposed"))    # each script's Decomposed Case
        doc = self.p.make(case, out, "150", self.p.KINDS, join=True)      # a case you made is never joined
        procs = " ".join(f"processor{n}:150,constant" for n in range(3))  # its constant and only that time
        with open(os.path.join(out, "seen")) as f:
            self.assertEqual(f.read().splitlines(), [
                f"{s} /usr/lib/python3/dist-packages case.foam constant processor0 processor1 processor2 system "
                f"{procs} split" for s in ("cut_views.py", "vortex_views.py", "pressure_spots.py")])
        self.assertEqual(doc["notes"], ["written time 150 is split onto its 3 processes, so ParaView read it as it "
                                        "is, split: a case you made is only read"])
        self.assertEqual(len(doc["pictures"]), 8)
        self.assertEqual(self.files(case), before)                        # nothing written in the case
        with self.assertRaisesRegex(RuntimeError, r"^ahmedP has no written time 175 with its flow"):
            self.p.make(case, os.path.join(self.tmp, "none"), "175", self.p.KINDS)
        ws, launched, ram, post = self.jobs_here(case)
        st, job, _ = post({"name": "ahmedP"})                             # its latest, split: read as it is
        self.assertEqual((st, job["params"]["time"], ram), (202, "150", [(case, "pictures-split")]))

    def test_a_run_mesh_doctor_made_has_its_time_joined_first(self):
        import jobs, solve
        case = self.case(times=("100",))
        self.split(case, ("100", "150", "200"))
        self.ours(case)
        out = os.path.join(self.tmp, "set")
        doc = self.p.make(case, out, "150", ("spots",), join=True)
        self.assertEqual(sorted(os.listdir(os.path.join(case, "150"))), ["U", "k", "p"])     # whole, and no mark
        with open(os.path.join(case, "joins")) as f:
            self.assertEqual(f.read().splitlines(), ["-time 150"])
        with open(os.path.join(out, "seen")) as f:                        # then read whole, as a joined one is
            self.assertEqual(f.read(), "pressure_spots.py /usr/lib/python3/dist-packages 150 case.foam constant "
                                       "system\n")
        self.assertEqual(doc["notes"], ["written time 150 was split onto its 2 processes, so it was joined first, in "
                                        "the run's own folder"])
        self.assertIn("pictures: joining written time 150 from its 2 processes, into its folder (reconstructPar)\n",
                      sys.stdout.getvalue())                              # in the job's log
        self.assertEqual(solve.times(case)[1], [100, 150])                # GET /runs lists it as joined now
        with mock.patch.dict(os.environ, {"MD_TEST_JOIN": "fail"}), \
                self.assertRaisesRegex(RuntimeError, r"^reconstructPar didn't join ahmedP's written time 200 \(exit "
                                                     r"1\): the job's log says why$"):
            self.p.make(case, os.path.join(self.tmp, "other"), "200", ("spots",), join=True)
        self.assertFalse(os.path.exists(os.path.join(case, "200")) or os.path.exists(os.path.join(self.tmp, "other")))
        os.makedirs(os.path.join(case, "200"))                            # its folder there before: only the mark goes
        with mock.patch.dict(os.environ, {"MD_TEST_JOIN": "fail"}), self.assertRaises(RuntimeError):
            self.p.join_time(case, "200")
        self.assertEqual(os.listdir(os.path.join(case, "200")), ["U"])
        self.p.join_time(case, "200")                                     # a join cut short is joined again
        self.assertEqual(sorted(os.listdir(os.path.join(case, "200"))), ["U", "k", "p"])
        self.assertNotIn(jobs.JOINING, os.listdir(os.path.join(case, "200")))
        os.remove(os.path.join(case, jobs.CASE_MARKER))
        with self.assertRaisesRegex(RuntimeError, r"^ahmedP is a case you made, which Mesh Doctor only reads"):
            self.p.join_time(case, "150")

    def test_a_picture_job_counts_the_time_it_joins_on_the_disk(self):
        import api_v1, diskguard, schema
        case = self.case(times=("100",))
        self.split(case, ("100", "150"), sizes={"U": 3 * diskguard.MB, "p": diskguard.MB})   # 8 MB split
        ws, launched, _, post = self.jobs_here(case)
        get = lambda **q: api_v1.handle("GET", "/api/v1/disk/pictures", {k: str(v) for k, v in q.items()})
        st, doc, _ = get(name="ahmedP", time="150")
        self.assertEqual((st, doc["needMb"], doc["join"]), (200, 7, None))    # a case you made is read as it is
        self.ours(case)
        st, doc, _ = get(name="ahmedP")                                      # its latest: split
        self.assertEqual(st, 200, doc)
        self.assertEqual({k: v for k, v in doc["join"].items() if k != "freeMb"},
                         {"time": "150", "processes": 2, "needMb": 8, "sameDisk": True})     # its 8 MB split
        self.assertIsInstance(doc["join"]["freeMb"], int)
        self.assertEqual(schema.check(doc, api_v1.DISK_PICTURES), [])
        self.assertIsNone(get(name="ahmedP", time="100")[1]["join"])        # joined already
        with mock.patch.object(diskguard, "free_mb", lambda path: diskguard.KEEP_MB + 12):
            st, err, _ = post({"name": "ahmedP"})                            # 7 + 8 MB on one disk: counted together
        self.assertEqual((st, err["error"]["code"], launched), (409, "not-enough-disk", []))
        self.assertIn("the set of about 19 pictures of ahmedP and joining its written time 150 from its 2 processes "
                      "into its folder need about 15 MB, and the disk has 1.0 GB free", err["error"]["message"])
        with mock.patch.object(diskguard, "free_mb", lambda path: diskguard.KEEP_MB + 14), \
                mock.patch.object(diskguard, "same_disk", lambda a, b: False):
            st, job, _ = post({"name": "ahmedP"})                            # on two disks: each fits its own
        self.assertEqual((st, job["params"]["time"]), (202, "150"), job)
        argv = launched[0]
        self.assertEqual(argv[argv.index("--time") + 1], "150")

    def test_the_vortex_levels_go_as_the_speed_squared(self):
        self.assertEqual(self.p.q_levels(15), [3000, 10000, 30000])
        self.assertEqual(self.p.q_levels(40), [21000, 71000, 210000])    # the Ahmed README's 20,000, 70,000, 200,000

    def test_the_walls_are_the_total_force_groups_patches(self):
        case = self.case()
        self.assertEqual(self.p.walls(case, "forcesTotal"), ["ahmed"])   # its group, not the ground beside it
        self.frame.update(total=None)                                    # no force history (postProcessing):
        self.assertEqual(self.p.walls(case), ["ahmed"])                  # every force function object's patches
        self.frame.update(total="forcesTotal")
        cmds, notes = self.p.plan(case, "/view", "/set", self.p.KINDS, "pvbatch")
        self.assertEqual(notes, [])
        self.assertEqual(cmds["cuts"][6:8], [os.path.join(case, "cuts.json"), "ahmedP, written time {it}"])
        v = cmds["vortices"]
        self.assertEqual((v[0], v[1], v[2].endswith("vortex_views.py"), v[3:6]),
                         ("pvbatch", "--force-offscreen-rendering", True,
                          ["/view/case.foam", "/set/vortices", "21000,71000,210000"]))
        self.assertEqual(v[v.index("--walls") + 1], "ahmed")
        self.assertEqual(cmds["cuts"][cmds["cuts"].index("--uinf") + 1], "40")

    def test_a_set_is_made_in_the_workspace_and_the_case_only_read(self):
        case = self.case()
        before = self.files(case)
        out = os.path.join(self.tmp, "work", ".pictures", "ahmedP", "200")
        os.makedirs(os.path.dirname(out))
        doc = self.p.make(case, out, "200", self.p.KINDS)
        self.assertEqual([p["file"] for p in doc["pictures"]],
                         ["cuts/c1_side_centre_Cpt.png", "cuts/c1_side_centre_U.png", "vortices/Q21000_rear34.png",
                          "vortices/Q21000_top.png", "vortices/Q210000_rear34.png",      # by Q, not as text
                          "spots/spots_Cp_spot_closeup.png", "spots/spots_Cp_spot_normal.png",
                          "spots/spots_Cp_spot_side.png"])
        self.assertEqual([p["title"] for p in doc["pictures"]][1:3],
                         ["Side cut on the centreline, seen from the side (+y), nose to the left: speed",
                          "Vortices, Q = 21,000 1/s², from behind"])
        self.assertEqual(doc["pictures"][5]["title"],
                         "The worst spot of unphysical pressure (Cp below -5), close up, with the surface mesh")
        self.assertEqual((doc["case"], doc["time"], doc["notes"]), ("ahmedP", "200", []))
        with open(os.path.join(out, "pictures.json")) as f:
            self.assertEqual(json.load(f), doc)
        with open(os.path.join(out, "seen")) as f:
            seen = f.read().splitlines()
        self.assertEqual(seen, [f"{s} /usr/lib/python3/dist-packages 200 case.foam constant system"
                                for s in ("cut_views.py", "vortex_views.py", "pressure_spots.py")])
        self.assertFalse(os.path.exists(os.path.join(out, "view")) or os.path.exists(out + ".new"))
        self.assertEqual(self.files(case), before)                       # nothing written in the case
        # Made again: the new set replaces the old one once it's whole
        doc = self.p.make(case, out, "200", ("vortices",))
        self.assertEqual(sorted(os.listdir(out)), [self.p.MARK, "pictures.json", "seen", "vortices"])

    def test_without_a_cut_list_the_cuts_are_made_from_the_models_size(self):
        case = self.case(cuts=False)
        out = os.path.join(self.tmp, "set")
        doc = self.p.make(case, out, "200", ("cuts", "vortices"))
        self.assertEqual(doc["notes"], ["cuts made from the model's size: ahmedP has no cut list (cuts.json at its "
                                        "root)"])
        self.assertEqual(doc["pictures"][0], {"file": "cuts/a1_side_centre_U.png", "kind": "cuts",
                                              "title": "Side cut on the model's centre plane: speed"})   # its list's
        self.assertEqual({p["kind"] for p in doc["pictures"]}, {"cuts", "vortices"})
        with mock.patch.dict(os.environ, {"MD_TEST_PV_FAILS": "cut_views.py"}), \
                self.assertRaisesRegex(RuntimeError, r"^no picture was made: cuts made from the model's size: .*; "
                                                     r"cuts: ParaView stopped \(exit 2\); the job's log says why$"):
            self.p.make(case, os.path.join(self.tmp, "none"), "200", ("cuts",))
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "none")))

    def test_with_no_spot_of_unphysical_pressure_the_set_says_so(self):
        case, out = self.case(), os.path.join(self.tmp, "set")
        with mock.patch.dict(os.environ, {"MD_TEST_NO_SPOTS": "1"}):
            doc = self.p.make(case, out, "200", ("spots",))             # nothing to show, and still a set
        self.assertEqual(doc["pictures"], [])
        self.assertEqual(doc["notes"], ["no spots: no wall face has unphysical pressure (Cp below -5); the lowest "
                                        "Cp is -2.0"])
        with open(os.path.join(out, "pictures.json")) as f:
            self.assertEqual(json.load(f), doc)

    def test_the_mean_flow_of_a_run_that_has_averaged_it(self):
        plain = self.case(times=("0.0003",))
        self.assertEqual(self.p.why_not(plain, mean=True),
                         ("not-ready", "ahmedP has no mean flow (UMean and pMean): a transient run writes it in each "
                                       "time once its averaging is on, from when its forces have settled"))
        shutil.rmtree(os.path.join(self.tmp, "cases"))
        case = self.case(times=("0.0003", "0.0006"), mean={"0.0006": "0.00029"})
        self.assertEqual((self.p.times(case), self.p.mean_times(case)), (["0.0003", "0.0006"], ["0.0006"]))
        self.assertIsNone(self.p.why_not(case, mean=True))
        self.assertEqual(self.p.why_not(case, "0.0003", mean=True),
                         ("bad-request", "ahmedP's time 0.0003 has no mean flow (UMean and pMean); its latest times "
                                         "with one: 0.0006"))
        cmds, _ = self.p.plan(case, "/view", "/set", self.p.KINDS, "pvbatch", True, 0.00031)
        self.assertEqual({k: c[-1] for k, c in cmds.items()}, {k: "--mean" for k in self.p.KINDS})
        for c in cmds.values():                                         # each picture says what it shows
            self.assertIn("ahmedP, the mean flow from 0.00031 s to {it} s", c)
        out = os.path.join(self.tmp, "set")
        with mock.patch.object(self.p, "plan", wraps=self.p.plan) as plan:
            doc = self.p.make(case, out, "0.0006", self.p.KINDS, mean=True)
        self.assertEqual(plan.call_args[0][5:], (True, 0.00031))       # from when it began: 0.0006 s less 0.00029 s
        self.assertEqual((doc["time"], doc["mean"]), ("0.0006", True))
        titles = [p["title"] for p in doc["pictures"]]
        self.assertEqual(titles[1:3], ["Side cut on the centreline, seen from the side (+y), nose to the left: speed "
                                       "of the mean flow", "Vortices of the mean flow, Q = 21,000 1/s², from behind"])
        self.assertEqual(titles[5], "The worst spot of unphysical pressure (Cp below -5) in the mean flow, close up, "
                                    "with the surface mesh")
        with open(os.path.join(out, "seen")) as f:
            self.assertEqual([line.rsplit(" ", 1)[1] for line in f.read().splitlines()], ["--mean"] * 3)

    def test_a_cut_over_time_pictures_the_first_cut_at_each_kept_time(self):
        case = self.case(times=("50", "100", "200", "300"))
        before, out = self.files(case), os.path.join(self.tmp, "set")
        self.assertEqual(self.p.strip(case, "200"), (["50", "100", "200"], False, 3))
        self.assertEqual(self.p.how_many(case, ("cuts", "times"), "200"), 7 + 3)
        doc = self.p.make(case, out, "200", ("cuts", "times"))
        side = "Side cut on the centreline, seen from the side (+y), nose to the left"
        self.assertEqual([p for p in doc["pictures"] if p["kind"] == "times"],
                         [{"file": f"times/c1_side_centre_U_at_{t}.png", "kind": "times", "time": t,
                           "title": f"{side}: speed, written time {t}"} for t in ("50", "100", "200")])   # by time
        self.assertEqual((doc["kinds"], doc["notes"]), (["cuts", "times"], []))
        with open(os.path.join(out, "seen")) as f:
            self.assertEqual(f.read().splitlines(),
                             ["cut_views.py /usr/lib/python3/dist-packages 200 case.foam constant system",
                              "cut_views.py /usr/lib/python3/dist-packages 100 200 50 case.foam constant system "
                              "--over-time"])                           # its own links: each time up to 200
        self.assertFalse(os.path.exists(os.path.join(out, "view_times")))
        self.assertEqual(self.files(case), before)                       # nothing written in the case
        self.assertEqual(self.p._shown(doc)[-1], doc["pictures"][-1])    # served with its time
        self.assertNotIn("time", self.p._shown({"pictures": [dict(doc["pictures"][-1], time="../1")]})[0])
        cmds, _ = self.p.plan(case, "/view", "/set", ("times",), "pvbatch", over_time=("/strip", True))
        self.assertEqual(cmds["times"][3:6] + cmds["times"][-1:],
                         ["/strip/case.foam", "decomposed", "/set/times", "--over-time"])
        self.assertEqual(self.p.plan(case, "/view", "/set", ("times",), "pvbatch")[0], {})   # no times: no command
        ws, launched, ram, post = self.jobs_here(case)
        st, job, _ = post({"name": "ahmedP", "time": "200", "kinds": "times"})   # read joined: still twice the fields
        self.assertEqual((st, ram), (202, [(case, "pictures-times")]))

    def test_a_cut_over_time_reads_a_split_run_as_it_is_and_pictures_fifty_times_at_most(self):
        case = self.case(times=("0.0006",))
        self.split(case, ["0.0002", "0.0004", "0.0006"])
        self.ours(case)                                                  # a run Mesh Doctor made: still none joined
        self.assertEqual(self.p.strip(case, "0.0006"), (["0.0002", "0.0004", "0.0006"], True, 3))
        before, out = self.files(case), os.path.join(self.tmp, "set")
        doc = self.p.make(case, out, "0.0006", ("times",))
        self.assertEqual([p["time"] for p in doc["pictures"]], ["0.0002", "0.0004", "0.0006"])
        self.assertEqual(doc["notes"], ["the cut over time read its written times as they are, split onto its 2 "
                                        "processes: none was joined for it"])
        with open(os.path.join(out, "seen")) as f:
            self.assertEqual(f.read().splitlines(),
                             ["cut_views.py /usr/lib/python3/dist-packages case.foam constant processor0 processor1 "
                              "system processor0:0.0002,0.0004,0.0006,constant processor1:0.0002,0.0004,0.0006,"
                              "constant split --over-time"])
        self.assertEqual(self.files(case), before)                       # nothing joined, nothing written
        with mock.patch.object(self.p, "MAX_TIMES", 2):
            self.assertEqual(self.p.strip(case, "0.0006"), (["0.0002", "0.0006"], True, 3))
            doc = self.p.make(case, out, "0.0006", ("times",))
        self.assertEqual(doc["notes"][0], "the cut over time pictures 2 of its 3 written times up to 0.0006, evenly "
                                          "picked")
        with mock.patch.object(self.p, "MAX_TIMES", 1):
            self.assertEqual(self.p.strip(case, "0.0006"), (["0.0006"], True, 3))   # the latest alone
        ws, launched, ram, post = self.jobs_here(case)
        st, job, _ = post({"name": "ahmedP", "kinds": "cuts,times"})     # its times read split: the most memory
        self.assertEqual((st, job["params"]["kinds"], ram), (202, ["cuts", "times"], [(case, "pictures-times-split")]))

    def test_a_mean_flows_cuts_show_how_much_the_speed_swings(self):
        case = self.case(times=("0.0003", "0.0006"), mean={"0.0006": "0.0003"})
        open(os.path.join(case, "0.0006", "UPrime2Mean"), "w").close()
        self.assertEqual(self.p.how_many(case, ("cuts",), "0.0006", mean=True), 7 + 3)   # one more for each cut
        doc = self.p.make(case, os.path.join(self.tmp, "set"), "0.0006", ("cuts", "times"), mean=True)
        side = "Side cut on the centreline, seen from the side (+y), nose to the left"
        self.assertEqual([(p["file"], p["title"]) for p in doc["pictures"] if p["kind"] == "cuts"][1:],
                         [("cuts/c1_side_centre_U.png", f"{side}: speed of the mean flow"),
                          ("cuts/c1_side_centre_Urms.png", f"{side}: how much the speed swings about its mean "
                                                           "(rms / free-stream speed)")])
        self.assertEqual([(p["time"], p["title"]) for p in doc["pictures"] if p["kind"] == "times"],
                         [("0.0006", f"{side}: speed of the mean flow to 0.0006 s")])   # the times with a mean flow

    def test_a_cut_over_time_needs_more_memory_than_a_time_read_once(self):
        import ramguard                                  # as measured: 1.17 GB read joined, 1.39 GB split, at 0.48M
        with mock.patch.object(ramguard, "available_mb", return_value=1300):
            self.assertEqual(ramguard.check_cells(478901, "pictures-times"),
                             (True, "pictures over time of 478,901 cells needs about 1.1 GB; 1.3 GB free"))
            ok, msg = ramguard.check_cells(478901, "pictures-times-split")
            self.assertTrue(ramguard.check_cells(478901, "pictures-split")[0])
        self.assertFalse(ok)
        self.assertIn("pictures over time read split of 478,901 cells needs about 1.4 GB; 1.3 GB free", msg)

    def test_a_computers_first_set_starts_with_the_self_test(self):
        case, st = self.case(), os.path.join(self.tmp, "work", ".pictures", self.p.SELFTEST)
        ran = os.path.join(os.path.dirname(st), "selftests")            # the stand-in's list of the self tests run
        doc = self.p.make(case, os.path.join(self.tmp, "a"), "200", ("spots",), selftest_dir=st)
        self.assertEqual((doc["notes"], sorted(os.listdir(st))), ([], [self.p.MARK, "selftest.json"]))
        self.assertIn("pictures: the vortex script's self test\n", sys.stdout.getvalue())     # in the job's log
        self.p.make(case, os.path.join(self.tmp, "b"), "200", ("spots",), selftest_dir=st)   # passed: not again
        with open(ran) as f:
            self.assertEqual(f.read().splitlines(), [st])
        shutil.rmtree(st)
        with mock.patch.dict(os.environ, {"MD_TEST_SELFTEST": "fail"}):
            doc = self.p.make(case, os.path.join(self.tmp, "c"), "200", ("spots",), selftest_dir=st)
        self.assertEqual(doc["notes"], ["ParaView's self test didn't pass (the picture of the test vortex is blank: "
                                        "ParaView drew nothing offscreen), so these pictures may be blank or wrongly "
                                        "coloured; it runs again with the next set"])
        self.assertEqual(len(doc["pictures"]), 3)                       # the set is made all the same
        with mock.patch.dict(os.environ, {"MD_TEST_SELFTEST": "crash"}):
            doc = self.p.make(case, os.path.join(self.tmp, "d"), "200", ("spots",), selftest_dir=st)
        self.assertRegex(doc["notes"][0], r"^ParaView's self test didn't pass \(ParaView stopped, exit 9\), so ")
        with open(ran) as f:
            self.assertEqual(len(f.read().splitlines()), 3)             # until it passes, it runs each time
        shutil.rmtree(st)
        mine = os.path.join(self.tmp, "mine")
        os.makedirs(mine)
        os.symlink(mine, st)                                            # a link in its place isn't followed
        doc = self.p.make(case, os.path.join(self.tmp, "e"), "200", ("spots",), selftest_dir=st)
        self.assertRegex(doc["notes"][0], r"^ParaView's self test didn't pass \(its folder is in the way: it isn't "
                                          r"one Mesh Doctor made\)")
        self.assertEqual((os.listdir(mine), os.path.islink(st)), ([], True))

    def test_a_case_that_cant_be_pictured_says_why(self):
        self.assertEqual(self.p.why_not(self.case(times=()))[0], "not-ready")
        shutil.rmtree(os.path.join(self.tmp, "cases"))
        case = self.case(times=("100", "200"))
        self.assertIsNone(self.p.why_not(case))
        self.assertEqual(self.p.times(case), ["100", "200"])
        self.assertEqual(self.p.why_not(case, "300"),
                         ("bad-request", "ahmedP has no written time 300 with its flow (U and p); its latest are 100, "
                                         "200"))
        self.frame.update(flowSign=1)
        self.assertRegex(self.p.why_not(case)[1], r"^ahmedP's flow goes toward \+x, with z up: the picture scripts' "
                                                   r"cameras need it toward -x, with z up$")
        self.frame.update(flowSign=-1)
        with mock.patch.dict(os.environ, {"PATH": "/nonexistent"}):
            self.assertRegex(self.p.why_not(case)[1], r"^ParaView isn't installed")
        with open(os.path.join(case, "system", "controlDict"), "w") as f:
            f.write("application foamRun;\n")                           # no force function object at all
        self.assertRegex(self.p.why_not(case)[1], r"^ahmedP's model isn't found")

    def test_a_folder_that_isnt_a_set_is_refused_and_left_as_it_is(self):
        case, out = self.case(), os.path.join(self.tmp, "mine")
        os.makedirs(out)
        with open(os.path.join(out, "notes.txt"), "w") as f:
            f.write("mine\n")
        with self.assertRaisesRegex(RuntimeError, r"mine is in the way: it isn't a set of pictures Mesh Doctor made"):
            self.p.make(case, out, "200", self.p.KINDS)
        self.assertEqual((os.listdir(out), os.path.exists(out + ".new")), (["notes.txt"], False))
        os.remove(os.path.join(out, "notes.txt"))                         # an empty folder is no one's
        self.assertEqual(len(self.p.make(case, out, "200", ("spots",))["pictures"]), 3)
        os.makedirs(out + ".new")                                         # one cut short: its mark goes in first
        open(os.path.join(out + ".new", self.p.MARK), "w").close()
        self.assertEqual(len(self.p.make(case, out, "200", ("vortices",))["pictures"]), 3)

    FOAM_TO_VTK = """#!/usr/bin/env python3
import os, sys
a = sys.argv[1:]
log = os.environ["MD_TEST_VTK_LOG"]
with open(log, "a") as f:
    f.write("foamToVTK " + " ".join(a) + "\\n")
if os.environ.get("MD_TEST_VTK") == "fail":
    sys.exit(1)
roots = sorted(d for d in os.listdir(".") if d.startswith("processor")) if "-parallel" in a else ["."]
for r in roots:
    poly = os.path.join(r, "constant", "polyMesh")
    s = os.path.join(poly, "sets", "fastestCells")
    with open(s) as f:
        n = f.read().split("\\n\\n", 1)[1].split()[0]
    with open(log, "a") as f:
        f.write("%s: %s cells, %s; %s; %s\\n" % (r, n, "a link" if os.path.islink(s) else "not a link",
                                                 " ".join(sorted(os.listdir(poly))),
                                                 " ".join(sorted(os.listdir(os.path.join(poly, "sets"))))))
    os.makedirs(os.path.join(r, "VTK"), exist_ok=True)
    open(os.path.join(r, "VTK", "fastestCells_0.vtk"), "w").close()
    if r != ".":
        os.makedirs("VTK", exist_ok=True)
        os.symlink("../%s/VTK/fastestCells_0.vtk" % r, os.path.join("VTK", "%s_fastestCells_0.vtk" % r))
"""
    MPIRUN = """#!/usr/bin/env python3
import os, sys
a = sys.argv[1:]
with open(os.environ["MD_TEST_VTK_LOG"], "a") as f:
    f.write("mpirun " + " ".join(a[:a.index("foamToVTK")]) + "\\n")
os.execvp("foamToVTK", a[a.index("foamToVTK"):])
"""
    REGIONS = [{"nCells": 2, "centre": [-0.0635, 0.18, 0.322], "bbox": [[-0.11, 0.15, 0.28], [-0.01, 0.2, 0.35]],
                "h": 0.00264, "maxRate": 54000.0, "wall": "ahmed", "wallDist": 0.00238, "speed": 54.9},
               {"nCells": 1, "centre": [-0.93, 0.19, 0.3], "bbox": [[-0.99, 0.17, 0.27], [-0.83, 0.21, 0.35]],
                "h": 0.0022, "maxRate": 44000.0, "wall": None, "wallDist": None, "speed": None}]

    def foam_vtk(self):
        """OpenFOAM's environment: stand-ins for foamToVTK, which writes an empty VTK file of the cell set
        fastestCells it reads, for the whole mesh or, with -parallel, for each processor folder (with a link to it in
        VTK/, as the real one makes), or with MD_TEST_VTK=fail stops; and for mpirun, which runs the command once.
        Each writes what it was given, and what it read, in the file this returns."""
        foam, log = os.path.join(self.tmp, "foamvtk"), os.path.join(self.tmp, "vtk.log")
        os.makedirs(foam)
        for name, text in (("foamToVTK", self.FOAM_TO_VTK), ("mpirun", self.MPIRUN)):
            with open(os.path.join(foam, name), "w") as f:
                f.write(text)
            os.chmod(os.path.join(foam, name), 0o755)
        bashrc = os.path.join(self.tmp, "bashrc_vtk")
        with open(bashrc, "w") as f:
            f.write(f"export WM_PROJECT_DIR=/nowhere\nexport MD_TEST_VTK_LOG={log}\nexport PATH={foam}:$PATH\n")
        patch = mock.patch.dict(os.environ, {"MESHDOCTOR_FOAM_BASHRC": bashrc})
        patch.start()
        self.addCleanup(patch.stop)
        return log

    def fastest_plan(self, cells=((0, 3), (0, 9)), procs=1, gain=1.6):
        """tplan.plan stood in: the transient plan of the case at the time asked, its fastest `cells` ([processor,
        cell]) on `procs` processes, without which the time step could be `gain` times as long.  Each (case, time)
        asked goes in self.planned."""
        self.planned = []

        def plan(case, t):
            self.planned.append((case, t))
            return {"case": "ahmedP", "time": t, "processors": procs, "decomposed": procs > 1,
                    "tool": "foamCourantCells", "courantPerSecond": {"max": 54000.0 * gain, "withoutTop": 54000.0},
                    "regions": [dict(g) for g in self.REGIONS], "fastestCells": [list(c) for c in cells]}
        patch = mock.patch.object(self.p.tplan, "plan", side_effect=plan)
        self.plan = patch.start()
        self.addCleanup(patch.stop)

    def test_the_cells_that_set_the_time_step_are_drawn_with_the_walls(self):
        case = self.case(times=("100", "200"))
        open(os.path.join(case, "200", "phi"), "w").close()
        os.makedirs(os.path.join(case, "constant", "polyMesh", "sets"))
        open(os.path.join(case, "constant", "polyMesh", "sets", "mine"), "w").close()      # a set of the case's own
        log, before, out = self.foam_vtk(), self.files(case), os.path.join(self.tmp, "set")
        self.fastest_plan()
        self.assertEqual(self.p.how_many(case, ("fastest",), "200"), 3 + self.p.PLACES)
        doc = self.p.make(case, out, "200", ("cuts", "fastest"))
        self.assertEqual(self.planned, [(os.path.abspath(case), "200")])                 # at the time pictured
        fast = "The cells that set the time step: the 2 with the highest Courant number, "
        self.assertEqual([(p["file"], p["title"]) for p in doc["pictures"] if p["kind"] == "fastest"], [
            ("fastest/fastest_side.png", fast + "from the side"), ("fastest/fastest_top.png", fast + "from above"),
            ("fastest/fastest_front34.png", fast + "from the front"),
            ("fastest/fastest_place1.png", "Place 1 of the cells that set the time step, close up: 2 cells near "
                                           "(-0.0635, 0.18, 0.322) m, about 2.6 mm across and 2.4 mm from the wall "
                                           "ahmed, where the flow is up to 55 m/s"),
            ("fastest/fastest_place2.png", "Place 2 of the cells that set the time step, close up: 1 cell near "
                                           "(-0.93, 0.19, 0.3) m, about 2.2 mm across")])        # views, then places
        self.assertEqual(doc["notes"], ["the cells that set the time step are the 2 with the highest Courant number "
                                        "at written time 200: without them it could be 1.6 times as long"])
        with open(log) as f:                                # the cells alone, on the whole mesh, read through links
            self.assertEqual(f.read().splitlines(), [
                "foamToVTK -cellSet fastestCells -fields () -excludePatches (\".*\") -polyhedra polyhedra "
                "-noPointValues -noFaceZones -noFunctionObjects", ".: 2 cells, a link; boundary sets; fastestCells"])
        with open(os.path.join(out, "seen")) as f:          # drawn with the walls, which ParaView reads as for a cut
            self.assertEqual(f.read().splitlines()[-2:], [
                "fastest_cells.py /usr/lib/python3/dist-packages 200 case.foam constant system",
                "cells: fastestCells_0.vtk"])
        self.assertEqual(sorted(os.listdir(out)),             # and nothing of it left but its pictures and their words
                         sorted([self.p.MARK, "cuts", "fastest", self.p.FAST_DOC, "pictures.json", "seen"]))
        self.assertEqual(self.files(case), before)            # nothing written in the case
        self.assertEqual((self.p.listing(case, out), self.p._shown(doc)), (doc["pictures"], doc["pictures"]))
        cmds, _ = self.p.plan(case, "/view", "/set", ("fastest",), "pvbatch", fastest=("/vtk", "/set/fastest.json"))
        self.assertEqual(cmds["fastest"][2:], [os.path.join(self.p.SCRIPTS, "fastest_cells.py"), "/view/case.foam",
                                               "reconstructed", "/set/fastest", "/vtk", "--walls", "ahmed", "--places",
                                               "/set/fastest.json", "--note", "ahmedP, written time {it}"])
        self.assertEqual(self.p.plan(case, "/view", "/set", ("fastest",), "pvbatch")[0], {})    # none found: none
        self.assertEqual(self.p.plan(case, "/view", "/set", ("fastest",), "pvbatch", mean=True,
                                     fastest=("/vtk", "/doc"))[0], {})                       # nor of a mean flow

    def test_the_cells_that_set_the_time_step_of_a_split_case_are_written_on_each_process(self):
        case = self.case(times=())
        self.split(case, ("0.0006",))
        for n in range(2):
            open(os.path.join(case, f"processor{n}", "0.0006", "phi"), "w").close()
        log, before, out = self.foam_vtk(), self.files(case), os.path.join(self.tmp, "set")
        self.fastest_plan(cells=((1, 4), (0, 1), (1, 2)), procs=2, gain=1.04)
        doc = self.p.make(case, out, "0.0006", ("fastest",))
        self.assertEqual(doc["notes"], [
            "written time 0.0006 is split onto its 2 processes, so ParaView read it as it is, split: a case you made "
            "is only read",
            "the cells that set the time step are the 3 with the highest Courant number at written time 0.0006: "
            "leaving them out would hardly change it",
            "the cells that set the time step were written on each of its 2 processes: the case has no whole mesh "
            "(constant/polyMesh)"])
        with open(log) as f:                                # each processor's own set, in parallel
            self.assertEqual(f.read().splitlines(), [
                "mpirun --oversubscribe -np 2",
                "foamToVTK -parallel -cellSet fastestCells -fields () -excludePatches (\".*\") -polyhedra polyhedra "
                "-noPointValues -noFaceZones -noFunctionObjects",
                "processor0: 1 cells, a link; sets; fastestCells", "processor1: 2 cells, a link; sets; fastestCells"])
        with open(os.path.join(out, "seen")) as f:
            self.assertEqual(f.read().splitlines(), [
                "fastest_cells.py /usr/lib/python3/dist-packages case.foam constant processor0 processor1 system "
                "processor0:0.0006,constant processor1:0.0006,constant split",
                "cells: processor0_fastestCells_0.vtk processor1_fastestCells_0.vtk"])
        self.assertEqual(len(doc["pictures"]), 5)
        self.assertEqual(self.files(case), before)            # nothing written in the case

    def test_the_cells_that_set_the_time_step_say_why_they_arent_drawn(self):
        case, out = self.case(times=("200",)), os.path.join(self.tmp, "set")
        self.foam_vtk()
        self.fastest_plan()
        doc = self.p.make(case, out, "200", ("spots", "fastest"))
        self.assertEqual((doc["notes"], self.planned), (["no cells that set the time step: written time 200 has no "
                                                         "face flux (phi) to find them from"], []))
        self.assertEqual([p["kind"] for p in doc["pictures"]], ["spots"] * 3)     # the rest of the set all the same
        open(os.path.join(case, "200", "phi"), "w").close()
        with mock.patch.dict(os.environ, {"MD_TEST_VTK": "fail"}):
            doc = self.p.make(case, out, "200", ("spots", "fastest"))
        self.assertEqual(doc["notes"][1:], ["no pictures of the cells that set the time step: foamToVTK didn't write "
                                            "them (exit 1); the job's log says why"])
        self.assertEqual(sorted(os.listdir(out)), sorted([self.p.MARK, "pictures.json", "seen", "spots"]))
        for said, why in ((RuntimeError("foamCourantCells failed (exit 1): no face flux"),
                           "the transient plan that finds them stopped; the job's log says why"),
                          (MemoryError("a transient plan of 1,000 cells needs about 0.5 GB; 0.2 GB free"),
                           "a transient plan of 1,000 cells needs about 0.5 GB; 0.2 GB free"),
                          (lambda case, t: {"fastestCells": None},
                           "Mesh Doctor's foamCourantCells isn't built (./Allwmake in its folder), and OpenFOAM's "
                           "CourantNo finds only their places, not the cells")):
            self.plan.side_effect = said
            doc = self.p.make(case, out, "200", ("spots", "fastest"))
            self.assertEqual(doc["notes"], ["no cells that set the time step: " + why])
        self.assertIn("pictures: foamCourantCells failed (exit 1): no face flux\n", sys.stdout.getvalue())  # its log
        self.assertEqual(self.p.size_words(0.0999), "10 cm")
        self.assertEqual([self.p.size_words(m) for m in (0.00085, 0.045, 1.234)], ["0.85 mm", "4.5 cm", "1.2 m"])

    def test_the_cells_that_set_the_time_step_are_a_kind_of_their_own(self):
        import api_v1, schema
        case = self.case(times=("0.0003", "0.0006"), mean={"0.0006": "0.0003"})
        ws, launched, ram, post = self.jobs_here(case)
        st, job, _ = post({"name": "ahmedP", "kinds": "fastest,cuts"})
        self.assertEqual((st, job["params"]["kinds"], ram), (202, ["fastest", "cuts"], [(case, "pictures")]))
        self.assertEqual(launched[0][launched[0].index("--kinds") + 1], "fastest,cuts")
        st, err, _ = post({"name": "ahmedP", "kinds": "cuts,fastest", "mean": True})
        self.assertEqual((st, err["error"]["message"], len(launched)),
                         (400, "the cells that set the time step are found from a written time's own flow, not from "
                               "its mean flow: picture them without the mean flow", 1))
        st, err, _ = api_v1.handle("GET", "/api/v1/disk/pictures", {"name": "ahmedP", "kinds": "fastest",
                                                                     "mean": "true"})
        self.assertEqual((st, err["error"]["code"]), (400, "bad-request"))
        params = api_v1.JOBS["pictures"]["params"]
        self.assertEqual(schema.check({"name": "ahmed", "kinds": "times,fastest"}, params), [])
        self.assertNotEqual(schema.check({"name": "ahmed", "kinds": "fastest2"}, params), [])
        self.assertEqual(api_v1.API_VERSION, "1.21")

    def jobs_here(self, case):
        """POST /jobs of picture jobs of `case`, launched nowhere: (the workspace, the commands launched, the memory
        checks, post)."""
        import api_v1, jobs
        ws, launched, ram = os.path.join(self.tmp, "work"), [], []
        for patch in (mock.patch.dict(os.environ, {"MESHDOCTOR_CASES": os.path.dirname(case),
                                                   "MESHDOCTOR_WORKSPACE": ws}),
                      mock.patch.object(jobs, "_spawn", lambda argv: launched.append(argv) or 2 ** 22 + 9),
                      mock.patch.object(jobs, "solver_running", lambda: False),
                      mock.patch.object(jobs.ramguard, "check", lambda c, kind: ram.append((c, kind)) or (True, ""))):
            patch.start()
            self.addCleanup(patch.stop)

        def post(params):
            body = json.dumps({"kind": "pictures", "params": params}).encode()
            return api_v1.handle("POST", "/api/v1/jobs", {}, body, "application/json")
        return ws, launched, ram, post

    def test_the_job_pictures_a_case_of_the_cases_folder_into_the_workspace(self):
        import jobs, schema
        case = self.case(times=("100", "200"))
        ws, launched, ram, post = self.jobs_here(case)
        st, job, _ = post({"name": "ahmedP", "kinds": "vortices,spots,vortices"})
        self.assertEqual(st, 202, job)
        self.assertEqual((job["kind"], job["params"]), ("pictures", {"name": "ahmedP", "time": "200",
                                                                     "kinds": ["vortices", "spots"], "mean": False}))
        self.assertEqual((job["log"], job["result"]),
                         (".pictures/ahmedP/200.log", ".pictures/ahmedP/200/pictures.json"))
        self.assertEqual(ram, [(case, "pictures")])                       # ParaView's memory, on the case's mesh
        argv = launched[0]
        self.assertEqual(argv[argv.index("--") + 1:], [sys.executable, os.path.join(self.p.PKG, "pictures.py"), case,
                                                       "--time", "200", "--kinds", "vortices,spots", "--out",
                                                       os.path.join(ws, ".pictures", "ahmedP", "200")])
        st, doc, _ = post({"name": "ahmedP", "time": "300"})
        self.assertEqual((st, doc["error"]["message"]),
                         (400, "ahmedP has no written time 300 with its flow (U and p); its latest are 100, 200"))
        st, doc, _ = post({"name": "ahmedP", "time": "100"})               # one big job at a time
        self.assertEqual((st, doc["error"]["code"], len(launched)), (409, "busy", 1))
        self.assertEqual(schema.validate(jobs.get(job["id"]), "job"), [])  # the job schema has the kind

    def test_a_mean_flow_job_makes_its_own_set(self):
        case = self.case(times=("0.0003", "0.0006"), mean={"0.0006": "0.0003"})
        ws, launched, _, post = self.jobs_here(case)
        st, doc, _ = post({"name": "ahmedP", "time": "0.0003", "mean": True})
        self.assertEqual((st, doc["error"]["message"]),
                         (400, "ahmedP's time 0.0003 has no mean flow (UMean and pMean); its latest times with one: "
                               "0.0006"))
        st, job, _ = post({"name": "ahmedP", "mean": True})              # the latest time with one
        self.assertEqual(st, 202, job)
        self.assertEqual((job["params"], job["log"]),
                         ({"name": "ahmedP", "time": "0.0006", "kinds": list(self.p.KINDS), "mean": True},
                          ".pictures/ahmedP/0.0006_mean.log"))
        self.assertEqual(launched[0][-3:], ["--out", os.path.join(ws, ".pictures", "ahmedP", "0.0006_mean"),
                                            "--mean"])
        self.assertEqual(job["links"]["pictures"], "/api/v1/pictures/ahmedP/0.0006_mean")     # the set it makes

    def test_the_job_takes_a_time_and_the_kinds(self):
        import api_v1, schema
        params = api_v1.JOBS["pictures"]["params"]
        for good in ({"name": "ahmed"}, {"name": "ahmed", "time": "0.0012", "kinds": "cuts,spots", "mean": True},
                     {"name": "ahmed", "kinds": "times,cuts"}):
            self.assertEqual(schema.check(good, params), [], good)
        for bad in ({"name": "ahmed", "kinds": "cuts,photos"}, {"name": "ahmed", "kinds": "time"},
                    {"name": "ahmed", "time": "../0"},
                    {"name": "ahmed", "mean": "yes"}):
            self.assertNotEqual(schema.check(bad, params), [], bad)

    def test_a_picture_job_counts_its_set_on_the_disk(self):
        import api_v1, diskguard
        case = self.case(times=("100", "200"))
        ws, launched, _, post = self.jobs_here(case)
        self.assertEqual(self.p.how_many(case, self.p.KINDS), 7 + 9 + 3)     # the Ahmed cut list's 7 colours
        self.assertEqual(diskguard.pictures_mb(19), 7)                        # 19 x 0.3 MB and 1 MB, rounded up
        get = lambda **q: api_v1.handle("GET", "/api/v1/disk/pictures", {k: str(v) for k, v in q.items()})
        st, doc, _ = get(name="ahmedP")
        self.assertEqual((st, doc["needMb"], doc["keepMb"], doc["folder"]), (200, 7, diskguard.KEEP_MB, "workspace"))
        self.assertIsInstance(doc["freeMb"], int)
        self.assertEqual(get(name="ahmedP", kinds="vortices", time="100", mean="false")[1]["needMb"], 4)   # 9 x 0.3 + 1
        for q, status, code in (({"name": "ahmedP", "mean": "true"}, 409, "not-ready"),     # it has no mean flow
                                ({"name": "ahmedP", "mean": "yes"}, 400, "bad-request"),
                                ({"name": "ahmedP", "time": "300"}, 400, "bad-request"),
                                ({"name": "ahmedP", "kinds": "photos"}, 400, "bad-request"),
                                ({"name": "nope"}, 404, "not-found"), ({}, 400, "bad-request")):
            st, err, _ = get(**q)
            self.assertEqual((st, err["error"]["code"]), (status, code), q)
        self.assertEqual(get(name="ahmedP", mean="yes")[1]["error"]["message"], "mean must be true or false")
        os.remove(os.path.join(case, "cuts.json"))                            # cuts made from the model's size
        self.assertEqual(self.p.how_many(case, ("cuts",)), self.p.AUTO_CUTS)
        with mock.patch.object(diskguard, "free_mb", lambda path: 500):       # the job's start counts it too
            st, err, _ = post({"name": "ahmedP"})
        self.assertEqual((st, err["error"]["code"], launched), (409, "not-enough-disk", []))
        self.assertIn("the set of about 19 pictures of ahmedP needs about 7 MB, and the disk has 500 MB free",
                      err["error"]["message"])
        self.assertEqual(post({"name": "ahmedP"})[0], 202)

    def made(self, case, ws, at, mean=False, kinds=("vortices",), when=None):
        """A set of `case` at time `at` made in the workspace `ws`, as a job makes one; `when`: when it says it was
        made (UTC)."""
        out = os.path.join(ws, ".pictures", os.path.basename(case), self.p.set_name(at, mean))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        doc = self.p.make(case, out, at, kinds, mean)
        if when:
            doc["made"] = when
            with open(os.path.join(out, "pictures.json"), "w") as f:
                json.dump(doc, f)
        return out, doc

    def test_the_sets_are_listed_newest_first_each_with_its_latest_job(self):
        import api_v1, schema
        case = self.case(times=("100", "200"), mean={"200": "50"})
        ws, _, _, post = self.jobs_here(case)
        self.made(case, ws, "100", when="2026-11-24T10:00:00Z")
        self.made(case, ws, "200", mean=True, kinds=("vortices", "spots"), when="2026-11-24T11:00:00Z")
        top = os.path.join(ws, ".pictures")
        listed = os.path.join(top, "ahmedP", "100", "pictures.json")
        for odd in ("ahmedP/200.new", "ahmedP/300", self.p.SELFTEST):     # cut short; not Mesh Doctor's; the self test
            os.makedirs(os.path.join(top, odd))
            shutil.copy(listed, os.path.join(top, odd))
        for marked in ("ahmedP/200.new", self.p.SELFTEST):
            open(os.path.join(top, marked, self.p.MARK), "w").close()
        open(os.path.join(top, "ahmedP", "100.log"), "w").close()
        os.symlink(os.path.join(top, "ahmedP", "100"), os.path.join(top, "ahmedP", "400"))   # links: never read
        os.symlink(os.path.join(top, "ahmedP"), os.path.join(top, "other"))
        st, job, _ = post({"name": "ahmedP", "time": "200"})
        self.assertEqual(st, 202, job)
        self.assertEqual(job["links"]["pictures"], "/api/v1/pictures/ahmedP/200")
        st, doc, _ = api_v1.handle("GET", "/api/v1/pictures")
        self.assertEqual(st, 200)
        self.assertEqual(doc["items"], [
            {"case": "ahmedP", "set": "200", "time": "200", "mean": False, "kinds": list(self.p.KINDS), "made": None,
             "count": None, "job": {"id": job["id"], "state": "queued"}},           # being made: first
            {"case": "ahmedP", "set": "200_mean", "time": "200", "mean": True, "kinds": ["vortices", "spots"],
             "made": "2026-11-24T11:00:00Z", "count": 6, "job": None},               # made in a terminal: no job
            {"case": "ahmedP", "set": "100", "time": "100", "mean": False, "kinds": ["vortices"],
             "made": "2026-11-24T10:00:00Z", "count": 3, "job": None}])
        self.assertEqual(schema.check(doc, api_v1._items(api_v1.PICTURE_SETS)), [])
        self.assertEqual(api_v1.handle("GET", "/api/v1/pictures", {"case": "ahmedP"})[1], doc)
        self.assertEqual(api_v1.handle("GET", "/api/v1/pictures", {"case": "nope"})[:2], (200, {"items": []}))
        st, err, _ = api_v1.handle("GET", "/api/v1/pictures", {"case": self.p.SELFTEST})
        self.assertEqual((st, err["error"]["code"]), (400, "bad-request"))

    def test_a_set_and_its_pictures_are_served_only_from_its_list(self):
        import api_v1, schema
        case = self.case(times=("100", "200"))
        ws, _, _, post = self.jobs_here(case)
        out, doc = self.made(case, ws, "200", kinds=("cuts", "vortices"))
        get = lambda path: api_v1.handle("GET", "/api/v1/pictures/" + path)
        st, one, _ = get("ahmedP/200")
        self.assertEqual((st, one), (200, {"case": "ahmedP", "set": "200", "time": "200", "mean": False,
                                           "kinds": ["cuts", "vortices"], "made": doc["made"], "notes": [],
                                           "pictures": doc["pictures"]}))
        self.assertEqual(schema.check(one, api_v1.PICTURE_SET), [])
        png = self.p.PNG + b"a picture"
        with open(os.path.join(out, "vortices", "Q21000_top.png"), "wb") as f:
            f.write(png)
        st, raw, _ = get("ahmedP/200/vortices/Q21000_top.png")
        self.assertEqual((st, raw.ctype, raw.data), (200, "image/png", png))
        with open(os.path.join(out, "vortices", "secret.png"), "wb") as f:   # there, but not in the set's list
            f.write(png)
        elsewhere = os.path.join(self.tmp, "elsewhere.png")
        with open(elsewhere, "wb") as f:
            f.write(png)
        os.remove(os.path.join(out, "cuts", "c1_side_centre_U.png"))
        os.symlink(elsewhere, os.path.join(out, "cuts", "c1_side_centre_U.png"))     # listed, but a link
        os.symlink(out, os.path.join(os.path.dirname(out), "250"))                    # a set's folder that is a link
        for path, status, code, text in (
                ("ahmedP/200/vortices/secret.png", 404, "not-found", "the set 200 of ahmedP lists no picture "
                                                                     "vortices/secret.png"),
                ("ahmedP/200/cuts/c1_side_centre_U.png", 404, "not-found", "isn't there"),
                ("ahmedP/250/vortices/Q21000_top.png", 404, "not-found", "no set of pictures 250 of ahmedP"),
                ("ahmedP/200/vortices/Q21000_rear34.png", 422, "unsupported", "isn't a PNG file of at most 32 MB"),
                ("ahmedP/200/photos/Q21000_top.png", 400, "bad-request", "bad picture"),
                ("ahmedP/200/vortices/..", 400, "bad-request", "bad picture"),
                ("ahmedP/200/vortices/Q21000_top.jpg", 400, "bad-request", "bad picture"),
                ("../200/vortices/Q21000_top.png", 400, "bad-request", "bad name"),
                ("ahmedP/../vortices/Q21000_top.png", 400, "bad-request", "bad set"),
                ("ahmedP/latest", 400, "bad-request", "bad set"),
                ("ahmedP/300", 404, "not-found", "no set of pictures 300 of ahmedP")):
            st, err, _ = get(path)
            self.assertEqual((st, err["error"]["code"]), (status, code), path)
            self.assertIn(text, err["error"]["message"], path)
        with mock.patch.object(self.p, "MAX_PNG", len(png) - 1):                  # too large to be one
            self.assertEqual(get("ahmedP/200/vortices/Q21000_top.png")[0], 422)
        st, job, _ = post({"name": "ahmedP", "time": "100"})                      # being made for the first time
        self.assertEqual(st, 202, job)
        st, err, _ = get("ahmedP/100")
        self.assertEqual((st, err["error"]["message"]),
                         (409, f"the pictures 100 of ahmedP are being made: job {job['id']} is queued"))
        op = api_v1.openapi()["paths"]["/pictures/{case}/{set}/{kind}/{file}"]["get"]
        self.assertEqual(list(op["responses"]["200"]["content"]), ["image/png"])
        self.assertEqual([p["schema"].get("enum") for p in op["parameters"]], [None, None, list(self.p.ALL_KINDS), None])

    def test_a_set_made_is_deleted_with_its_log_but_not_while_a_job_makes_it(self):
        import api_v1, jobs
        case = self.case(times=("100", "200"))
        ws, _, _, post = self.jobs_here(case)
        top = os.path.join(ws, ".pictures", "ahmedP")
        for at in ("100", "200"):
            self.made(case, ws, at)
            open(os.path.join(top, at + ".log"), "w").close()
        os.makedirs(os.path.join(top, "200.new"))                                 # a remake cut short
        open(os.path.join(top, "200.new", self.p.MARK), "w").close()
        delete = lambda at: api_v1.handle("POST", f"/api/v1/pictures/ahmedP/{at}/delete")
        self.assertEqual(delete("200")[:2], (200, {"case": "ahmedP", "set": "200", "deleted": 3}))
        self.assertEqual(sorted(os.listdir(top)), ["100", "100.log"])
        os.makedirs(os.path.join(top, "300"))                                     # not a set Mesh Doctor made
        os.symlink(os.path.join(top, "100"), os.path.join(top, "400"))            # a link to one
        st, job, _ = post({"name": "ahmedP", "time": "100"})
        self.assertEqual(st, 202, job)
        for at, status, code, text in (
                ("100", 409, "busy", f"the pictures 100 of ahmedP are being made: job {job['id']} is queued; cancel "
                                     "it first"),
                ("300", 422, "unsupported", "300 of ahmedP in the workspace's .pictures isn't a set of pictures Mesh "
                                            "Doctor made, so it is left as it is"),
                ("400", 422, "unsupported", "isn't a set of pictures Mesh Doctor made"),
                ("500", 404, "not-found", "no set of pictures 500 of ahmedP"),
                ("..", 400, "bad-request", "bad set")):
            st, err, _ = delete(at)
            self.assertEqual((st, err["error"]["code"]), (status, code), at)
            self.assertIn(text, err["error"]["message"], at)
        self.assertEqual(sorted(os.listdir(top)), ["100", "100.log", "300", "400"])     # each left as it was
        self.assertEqual(len(os.listdir(os.path.join(top, "100", "vortices"))), 3)
        jobs.update(jobs.path_of(job["id"]), state="done")                        # once its job has ended
        os.rmdir(os.path.join(top, "300"))
        os.unlink(os.path.join(top, "400"))
        self.assertEqual(delete("100")[:2], (200, {"case": "ahmedP", "set": "100", "deleted": 3}))
        self.assertFalse(os.path.exists(top))                                     # the case's folder too, once empty
        self.assertEqual(api_v1.handle("GET", "/api/v1/pictures/ahmedP/100/delete")[0], 405)


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
        # an empty cases folder: no solve run in a terminal there keeps its jobs out (jobs.solving_outside)
        cases = mock.patch.dict(os.environ, {"MESHDOCTOR_CASES": os.path.join(self.ws, "cases")})
        cases.start()
        self.addCleanup(cases.stop)

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


class ValidateTest(unittest.TestCase):
    """validate.py: Verify install, a run of the Ahmed body template against the wind tunnel and against the
    accuracy check's own run of the same mesh (GET /api/v1/runs/{name}/validation), on runs written here."""

    def setUp(self):
        import api_v1, jobs, validate
        self.api, self.jobs, self.v = api_v1, jobs, validate
        self.d = tempfile.mkdtemp(prefix="validate_test_")
        self.addCleanup(shutil.rmtree, self.d, True)
        self.cases = os.path.join(self.d, "cases")
        os.makedirs(self.cases)
        env = mock.patch.dict(os.environ, {"MESHDOCTOR_CASES": self.cases,
                                           "MESHDOCTOR_WORKSPACE": os.path.join(self.d, "work")})
        env.start()
        self.addCleanup(env.stop)

    def run_of(self, name, cd, to=2000, size="coarse", marker=None):
        """A run of the template solved to `to`: its marker, its status file and its forceCoeffs file."""
        case = os.path.join(self.cases, name)
        os.makedirs(case)
        with open(os.path.join(case, self.jobs.CASE_MARKER), "w") as f:
            json.dump(marker or {"madeBy": "Mesh Doctor", "template": "ahmed-body", "size": size, "state": "done",
                                 "cells": 480_000}, f)
        with open(os.path.join(case, self.jobs.SOLVE_STATUS), "w") as f:
            json.dump({"state": "done", "step": "done", "iteration": to, "start": 0, "end": to, "nProcs": 6,
                       "stretches": [{"from": 0, "to": to}]}, f)
        self.coeffs(case, 0, to, cd)
        return case

    @staticmethod
    def coeffs(case, start, to, cd, cl=lambda i: 0.298):
        """forceCoeffs' file of a stretch from `start`, as OpenFOAM 14 writes it: Cm, Cd, Cl, Cl(f), Cl(r)."""
        out = os.path.join(case, "postProcessing", "forceCoeffs", str(start))
        os.makedirs(out)
        with open(os.path.join(out, "forceCoeffs.dat"), "w") as f:
            f.write("# Force coefficients\n# magUInf       : 4.00000000e+01\n# Time          \tCm              \t"
                    "Cd              \tCl              \tCl(f)           \tCl(r)           \n")
            for i in range(start + 1, to + 1):
                f.write(f"{i:<16}\t{0.07:.8e}\t{cd(i):.8e}\t{cl(i):.8e}\t{0.2:.8e}\t{0.1:.8e}\n")

    @staticmethod
    def settled(i):                             # 0.2985 then 0.2995 over the last 500: a mean of 0.299
        return 0.31 if i <= 1500 else 0.2985 if i <= 1750 else 0.2995

    def get(self, name):
        st, doc, _ = self.api.handle("GET", f"/api/v1/runs/{name}/validation", {})
        return st, doc

    def test_a_run_like_the_accuracy_checks_matches_it(self):
        import schema
        self.run_of("verify-install", self.settled)
        st, doc = self.get("verify-install")
        self.assertEqual(st, 200, doc)
        ok = next(r.ok for r in self.api.ROUTES if r.template == "/runs/{name}/validation")
        self.assertEqual(schema.check(doc, ok), [])
        self.assertEqual(doc, {
            "name": "verify-install", "state": "done", "template": "ahmed-body", "size": "coarse", "slant": 25,
            "cells": 480_000, "iterations": 2000, "window": 500, "cd": 0.299, "cl": 0.298, "drift": 0.34,
            "tunnel": {"cd": 0.285, "difference": 4.91},
            "published": {"cd": 0.299, "cl": 0.298, "iterations": 2000, "difference": 0.0},
            "comparable": True, "matches": True})
        self.assertNotIn("-0.0", json.dumps(doc))

    def test_a_continuation_s_own_file_wins_where_the_two_overlap(self):
        case = self.run_of("cont", lambda i: 0.31, to=1600)                 # stopped at 1600, then continued from 1500
        self.coeffs(case, 1500, 2000, lambda i: 0.299)
        doc = self.get("cont")[1]
        self.assertEqual((doc["iterations"], doc["window"], doc["cd"], doc["drift"]), (2000, 500, 0.299, 0.0))

    def test_a_run_short_of_2000_iterations_or_off_by_more_than_2_percent_doesnt_match(self):
        self.run_of("short", self.settled, to=1000)
        doc = self.get("short")[1]
        self.assertEqual((doc["iterations"], doc["window"], doc["comparable"], doc["matches"]), (1000, 250, False, False))
        self.run_of("off", lambda i: 0.31)
        doc = self.get("off")[1]
        self.assertEqual((doc["cd"], doc["published"]["difference"], doc["comparable"], doc["matches"]),
                         (0.31, 3.68, True, False))
        self.run_of("medium", lambda i: 0.2815, size="medium")             # each size against its own run
        doc = self.get("medium")[1]
        self.assertEqual((doc["published"]["cd"], doc["published"]["difference"], doc["matches"]), (0.28, 0.54, True))

    def test_only_a_run_of_the_template_with_forces_is_compared(self):
        for name, marker in (("copy", {"state": "done", "copyOf": "mine"}), ("wing", {"state": "done", "template":
                             "wheel-wing", "size": "medium"}), ("odd", {"state": "done", "template": "ahmed-body",
                                                                         "size": "huge"})):
            self.run_of(name, self.settled, marker=marker)
            st, doc = self.get(name)
            self.assertEqual((st, doc["error"]["code"]), (422, "unsupported"), name)
            self.assertIn("isn't made from the Ahmed body template", doc["error"]["message"])
        self.run_of("early", self.settled, to=5)                            # 5 rows: nothing to average yet
        st, doc = self.get("early")
        self.assertEqual((st, doc["error"]["code"]), (409, "not-ready"))
        err = self.get("nope")[1]["error"]
        self.assertEqual((err["code"], err["message"]), ("not-found", "no run nope"))
        self.assertEqual(self.get(".x")[0], 400)
        self.assertEqual(self.v.of_run("../x"), (None, ("bad-request", "bad run name")))
        for st, doc in (self.get("nope"), self.get("early")):
            self.assertNotIn(self.d, json.dumps(doc))                       # never this machine's folders

    def test_the_numbers_it_compares_with_are_the_accuracy_checks(self):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "validation.md")
        with open(path, encoding="utf-8") as f:
            text = f.read()
        rows = [line.split("|")[1:-1] for line in text.splitlines() if line.startswith("| ")]
        table = {r[0].strip(): [c.strip() for c in r] for r in rows[1:]}
        for size, ours in self.v.PUBLISHED.items():
            row = table[size]
            self.assertEqual((row[1], float(row[3]), float(row[5]), float(row[6])),
                             (f"{self.v.SLANT} deg", ours["cd"], ours["cl"], self.v.TUNNEL), size)
        self.assertIn(f"{self.v.ITERATIONS} iterations per case", text)


if __name__ == "__main__":
    unittest.main()
