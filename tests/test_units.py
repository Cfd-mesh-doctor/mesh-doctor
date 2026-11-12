# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 The Mesh Doctor authors
"""Unit tests that need neither OpenFOAM nor a mesh.

    python3 -m unittest discover -s tests
"""
import json, math, os, re, shutil, sys, tempfile, time, unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "meshdoctor"))
os.environ["MESHDOCTOR_CONFIG"] = os.devnull
import abtest, md_api, repair  # noqa: E402


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


class JudgeTest(unittest.TestCase):
    """abtest.judge on a synthetic steady run: log residuals + a forces file."""

    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="judge_test_")
        os.makedirs(os.path.join(self.d, "0"))
        with open(os.path.join(self.d, "0", "U"), "w") as f:
            f.write("internalField uniform (20 0 0);\nboundaryField\n{\n}\n")

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def write_run(self, n, p_of, drag_of):
        with open(os.path.join(self.d, "log.foamRun"), "w") as f:
            for t in range(1, n + 1):
                f.write(f"Time = {t}s\n\nGAMG:  Solving for p, Initial residual = {p_of(t)}, Final residual = 1e-9, "
                        "No Iterations 3\n\n")
        os.makedirs(os.path.join(self.d, "postProcessing", "body", "0"))
        with open(os.path.join(self.d, "postProcessing", "body", "0", "forces.dat"), "w") as f:
            for t in range(1, n + 1):
                f.write(f"{t} (({drag_of(t)} 0 -30) (0 0 0))\n")

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
        dt = 1e-3
        with open(os.path.join(self.d, "log.pimple"), "w") as f:
            for i in range(1, n + 1):
                f.write(f"Courant Number mean: 0.05 max: {co_max}\nTime = {i * dt:g}s\n\n")
                for k, p in ((1, 1e-2), (2, p_last)):
                    f.write(f"PIMPLE: Iteration {k}\nGAMG:  Solving for p, Initial residual = {p}, "
                            "Final residual = 1e-7, No Iterations 5\n")
                if bounding:
                    f.write("bounding k, min: -0.1 max: 2 average: 0.5\n")
        os.makedirs(os.path.join(self.d, "postProcessing", "body", "0"))
        with open(os.path.join(self.d, "postProcessing", "body", "0", "forces.dat"), "w") as f:
            for i in range(1, n + 1):
                f.write(f"{i * dt:g} (({drag_of(i)} 0 -30) (0 0 0))\n")

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
        sys.modules.setdefault("numpy", type(sys)("numpy"))      # mapdata imports numpy at the top
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
        self.assertEqual(self.get("/cases")[:2], (200, {"items": ["c1"]}))
        st, doc, _ = self.get("/repairs/r1")
        self.assertEqual((st, doc["source"]), (200, self.src))
        self.assertEqual(self.get("/repairs")[1]["items"][0]["name"], "r1")
        self.assertEqual(self.get("/")[1]["schemas"], self.schema.VERSIONS)
        self.assertEqual(self.get("/schemas/judge")[1]["$id"], self.schema.schema("judge")["$id"])
        st, rep, _ = self.get("/repairs/r1/report")
        self.assertEqual((st, rep["kind"], rep["documents"]["repair"]["source"]), (200, "meshdoctor-report", "cases/c1"))
        self.assertError(self.get("/repairs/nope/report"), 404, "not-found")

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
        self.assertEqual(doc["paths"]["/jobs"]["post"]["security"], [{"launchToken": []}])
        self.assertEqual(sorted(doc["components"]["schemas"]["Error"]["properties"]["error"]["properties"]
                                ["code"]["enum"]), sorted(self.api.STATUS))
        refs = re.findall(r'"\$ref": "schemas/(\w+)"', json.dumps(doc))
        self.assertTrue(refs and all(k in self.schema.VERSIONS for k in refs), refs)


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


if __name__ == "__main__":
    unittest.main()
