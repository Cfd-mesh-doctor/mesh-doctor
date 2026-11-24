// SPDX-License-Identifier: GPL-3.0-or-later
// Generated from docs/architecture.md; design.test.ts keeps it equal to the doc. Change the doc, then this.
import type { DocSection } from "@/lib/docSections";

export const TITLE = "Architecture";

export const INTRO = "Where the code is today, where it is going, and why. The goal is that Mesh Doctor can later become a website without a rewrite: the parts that compute, the parts that serve, and the parts that draw stay separate, and they agree on versioned data.";

export const DESIGN: DocSection[] = [
  {
    "id": "the-rule-that-shapes-everything",
    "title": "The rule that shapes everything",
    "blocks": [
      {
        "text": "**Meshing and solving can never run on a web host.** OpenFOAM needs gigabytes of memory and runs for minutes to days. Serverless platforms such as Vercel stop a function after 300–800 s and give it 2–4 GB. So the computing always happens on a **worker**: your own machine, a lab PC, a cluster node, or a cloud VM. A website can only be the front end, plus a thin API that hands jobs to workers and shows their results."
      }
    ]
  },
  {
    "id": "layers",
    "title": "Layers",
    "blocks": [
      {
        "code": " clients      CLI (meshdoctor ...)   local dashboard (web/)   future website\n                  |                        |                        |\n api          ----+---- /api/v1 (JSON, versioned, OpenAPI) ---------+\n                  |\n jobs         Job model + Runner:  LocalRunner (today)  |  Slurm / remote worker (later)\n                  |\n core         case reading, repair, A/B, judge, map, RAM and disk guards, config   (no HTTP, no UI)\n                  |\n OpenFOAM     foamMeshDoctor, foamResidualHotspots, checkMesh, foamRun, ..."
      },
      {
        "text": "Rules between layers:"
      },
      {
        "list": [
          "**core** never imports `api`, `web` or `jobs`, never prints for a UI, and returns plain data (dicts that match the schemas below). The CLI and the API are its only callers.",
          "**jobs** is the only place that starts long-running processes. Admission rules (one big job at a time, the RAM guard, and the disk guard of each job that writes a case) live here, so every client gets them.",
          "**api** translates HTTP to core and jobs calls. It holds the security checks (host and origin, token, plain names) and nothing else.",
          "**web** talks only to `/api/v1`. It never reads files or assumes it is served from the same machine as the worker."
        ]
      }
    ]
  },
  {
    "id": "where-the-code-is-today",
    "title": "Where the code is today",
    "blocks": [
      {
        "table": {
          "head": [
            "Today",
            "Layer",
            "Notes"
          ],
          "rows": [
            [
              "`caseinfo.py`, `ramguard.py`, `diskguard.py`, `config.py`, `mapdata.py`",
              "core",
              "already free of HTTP and UI"
            ],
            [
              "`tplan.py`",
              "core + CLI",
              "the transient plan: `plan()` returns a `tplan` document, from Mesh Doctor's `foamCourantCells` (OpenFOAM's `CourantNo` where it isn't built); it runs OpenFOAM only in a throwaway shadow case, so the case is only read. A `tplan` job (`start()`) writes it to `<workspace>/.tplans/<case>.json`, which `GET /tplans/{name}` answers, and the cell set of the fastest cells to `<workspace>/.tplans/<case>.sets` (a split case's for its whole mesh too, where it has the one it was split from, each cell found by its processor's `cellProcAddressing`)"
            ],
            [
              "`repair.py`, `abtest.py`",
              "core + CLI",
              "the library functions (`full`, `fix`, `judge`, `run_one`, ...) are core; their `main()` is CLI"
            ],
            [
              "`md_api.py`",
              "api",
              "reads results; checks job requests and hands them to `jobs.py`; refusals carry an error code"
            ],
            [
              "`jobs.py`, `jobrun.py`",
              "jobs",
              "job files, admission (one big job, RAM guard, disk guard), the LocalRunner and its wrapper, cancel"
            ],
            [
              "`api_v1.py`",
              "api",
              "the `/api/v1` route table, request checks, error format and OpenAPI document"
            ],
            [
              "`server.py`",
              "api",
              "HTTP, the security checks, the live monitors, and the old `/api/md/*`, `/api/run` and `/api/status` routes"
            ],
            [
              "`web/*.html`",
              "web",
              "five pages: HTML and CSS, plus the page's own script in `web/js/`"
            ],
            [
              "`web/js/md.js`",
              "web",
              "the shared front-end core: `/api/v1` client, jobs, escaping templates, number formats, small DOM helpers"
            ],
            [
              "`web/js/chart.js`",
              "web",
              "the one line chart (log or linear, stage band and marks, hover tooltip)"
            ],
            [
              "`web/js/report.js`",
              "web",
              "the report viewer's script (on `md.js` + `chart.js`); `--html` inlines all three"
            ],
            [
              "`__main__.py`",
              "CLI",
              "dispatches to the scripts"
            ]
          ]
        }
      },
      {
        "text": "The modules import each other by plain name (`import caseinfo`), which `__main__` makes work from a clone, pip and the images. New code keeps that convention until the package is restructured. That restructure is the last step below, not the first, so the tree never goes through a broken state."
      }
    ]
  },
  {
    "id": "results-portable-and-versioned",
    "title": "Results: portable and versioned",
    "blocks": [
      {
        "text": "Every file Mesh Doctor writes for another program to read carries `\"schemaVersion\": \"<major>.<minor>\"`, and has a JSON Schema in `meshdoctor/schemas/`:"
      },
      {
        "table": {
          "head": [
            "File",
            "Written by",
            "Read by"
          ],
          "rows": [
            [
              "`meshDoctor/result.json`",
              "repair",
              "dashboard, map, A/B, reports"
            ],
            [
              "`<name>_ab/ab_result.json`",
              "A/B test",
              "dashboard, reports"
            ],
            [
              "judge output",
              "`judge` (CLI, API)",
              "dashboard live pages, reports"
            ],
            [
              "transient plan",
              "`transient-plan` (CLI), a `tplan` job",
              "people deciding on a transient run; the web app's run page"
            ],
            [
              "`meshDoctor/map.json`",
              "map",
              "repair map page, reports"
            ],
            [
              "`.jobs/<id>.json`",
              "job runner (`jobs.py`, `jobrun.py`)",
              "API, `meshdoctor jobs`, dashboard"
            ],
            [
              "`<name>.mdreport.json`",
              "`meshdoctor report` (`report.py`)",
              "the report viewer, anywhere"
            ]
          ]
        }
      },
      {
        "list": [
          "A minor bump only adds fields. A major bump changes or removes them.",
          "Readers accept any minor version of the major version they know, and refuse a newer major version with a clear message.",
          "Tests validate real outputs against the schemas, so a field cannot quietly disappear.",
          "`meshdoctor schema <repair|abtest|judge|map|job|report> <file>` checks any file by hand. `meshdoctor/schema.py` holds the versions, the read and write helpers (which stamp the version and refuse a newer major version), and a small validator for the JSON Schema keywords the schemas use (standard library only, like the rest of the package).",
          "Files written before versioning existed have no `schemaVersion`. They are read as \"legacy\" and never re-stamped, so an old file is not mislabelled as 1.0."
        ]
      },
      {
        "text": "This is what makes a **report bundle** possible."
      }
    ]
  },
  {
    "id": "report-bundles",
    "title": "Report bundles",
    "blocks": [
      {
        "text": "`meshdoctor report <name>` writes one file, `<name>.mdreport.json`, that holds a run's versioned documents: the repair result, its repair map and its A/B test, when they exist. `--gzip` makes it about 5× smaller. `--html` writes the viewer with the report inside: one file to email, which opens with a double-click. `--viewer` writes the same one-file viewer with no report in it, for a static host or a shared folder. `GET /api/v1/repairs/{name}/report` returns the same thing."
      },
      {
        "list": [
          "**Worker paths are replaced** before anything is written: `workspace/...`, `cases/...`, or just the file name. Encoded data (the map's base64 images) is never touched. The `redacted` field counts the replacements.",
          "**What stays:** the case's geometry coordinates, patch and force-group names and all the numbers. A report is shared like the case itself; the viewer says so.",
          "**Integrity:** `contents` lists each document's schema version (or `legacy`), size and the sha256 of its sorted compact JSON."
        ]
      },
      {
        "text": "The viewer is `web/report.html` with its script in `web/js/report.js`, on the same `md.js` and `chart.js` as the dashboard pages: no build step and no libraries. It works in three places:"
      },
      {
        "table": {
          "head": [
            "Where",
            "How it gets the report"
          ],
          "rows": [
            [
              "the dashboard, `/report?name=<run>`",
              "from `/api/v1/repairs/{name}/report`"
            ],
            [
              "a static site (shape 2) serving `web/` (the page and `js/`), or the `--viewer` file anywhere",
              "the user picks or drops a `.json`, `.json.gz` or exported `.html` file; it is read in the browser"
            ],
            [
              "an exported `--html` report",
              "the report is inside the page"
            ]
          ]
        }
      },
      {
        "text": "An export (`--html` or `--viewer`) is one file: `report.py` copies `md.js`, `chart.js` and `report.js` into the page and swaps the policy's `script-src 'self'` for the sha256 hash of each one. The page runs exactly those three scripts and nothing else, not even an inline script injected later. That is why no file in `web/js/` may contain a closing script tag or an HTML comment opener: the export refuses to inline one that does."
      },
      {
        "text": "The page's Content-Security-Policy allows no network access except its own server (`connect-src 'self'`), and none at all in an exported report (`connect-src 'none'`). So the viewer cannot send a report anywhere, even by mistake. Everything from the file goes through `MD.html`, which escapes every value, so a report from someone else cannot run code in the page. An exported `.html` opened in the viewer is parsed as an inert document (its scripts never run) and only its report slot is read. Each card renders on its own: a damaged part of a file costs that card, not the page. A report from a newer major version is refused with a clear message."
      }
    ]
  },
  {
    "id": "api-v1",
    "title": "API v1",
    "blocks": [
      {
        "text": "All routes live under `/api/v1` (`meshdoctor/api_v1.py`). The routes are a table that knows nothing about the HTTP server: `handle(method, path, query, body, content_type)` returns a status and a JSON document. `server.py` runs the security checks first and then hands the request over, so another server, or a test, can use the same table."
      },
      {
        "list": [
          "Responses are JSON. Errors are always `{\"error\": {\"code\": \"...\", \"message\": \"...\"}}`, with the HTTP status that the code maps to (below). Messages never contain the worker's file paths.",
          "`GET /api/v1/openapi.json` describes the API in OpenAPI 3.1. It is built from the same table, so it cannot drift from the code. The result documents refer to `GET /api/v1/schemas/{kind}`, the JSON Schemas above.",
          "List answers are objects, `{\"items\": [...]}`, so fields can be added later without breaking clients."
        ]
      },
      {
        "table": {
          "head": [
            "v1 route",
            "Old route",
            "Purpose"
          ],
          "rows": [
            [
              "`GET /`",
              "",
              "API version, result-file versions, job kinds"
            ],
            [
              "`GET /openapi.json`, `GET /schemas/{kind}`",
              "",
              "the API description and the result schemas"
            ],
            [
              "`GET /cases`",
              "`/api/md/sources`",
              "source cases the worker may read, with each one's cell count from its mesh's owner header (null when the header doesn't say; API 1.2); a new case from a template is listed once its mesh is made, and `made` names the cases Mesh Doctor made, with what each was made from: a template (`template`), a case you made (`copyOf`: a solve job's copy of it), or a steady run (`transientOf`: a transient run of it): the ones a solve takes (API 1.6); `results` gives each one's latest written time with its face flux (`phi`), the result a transient plan starts from, or null before one (API 1.8)"
            ],
            [
              "`GET /repairs`, `GET /repairs/{name}`",
              "`/api/md/results`, `/api/md/result`",
              "repair runs, and a finished run's result (repair schema)"
            ],
            [
              "`GET /repairs/{name}/clusters/{id}?tag=before|after|report`",
              "`/api/md/cluster`",
              "geometry of one defect cluster"
            ],
            [
              "`GET /repairs/{name}/log`",
              "`/api/md/log`",
              "the repair sweeps from the log"
            ],
            [
              "`GET /abtests`, `GET /abtests/{name}`",
              "`/api/md/ablist`, `/api/md/ab`",
              "A/B tests, with each one's last step and, once both runs have ended, its residual ratios and the verdict `ab extend` saved (API 1.3); one test: its step, result (abtest schema), each run's residuals and oscillation maps"
            ],
            [
              "`GET /abtests/{name}/live`",
              "`/api/run?label=`",
              "the steady-run page: stages, forces, residuals, live judge"
            ],
            [
              "`GET /live/abtest`",
              "`/api/run` (no label)",
              "the same, for the A/B test running now (or else the one updated last); its name is in `label`"
            ],
            [
              "`GET /live/judge?window=&avgFrom=`",
              "(new)",
              "the transient judge on the live case's transient log (`log.ddes*`, else `log.foamRun*`): force means stationary, each time step converged, Courant number, bounded fields. Kept until a log changes size or time, since it reads the whole log; the live page asks at most once a minute. 503 when the server has no live monitor, 404 when there is no live case or log"
            ],
            [
              "`GET /maps`, `GET /maps/{name}`",
              "`/api/md/maplist`, `/api/md/map`",
              "repair maps (map schema)"
            ],
            [
              "`GET /abtests/{name}/judge?side=base|fixed&to=&window=&avgFrom=`",
              "(new)",
              "the judge on one run of an A/B test; `to` judges it as it was at that iteration, so both runs can be compared over the same iterations. A test that reused another's original-mesh run (`--base-from`) is judged on that run; `run` in the answer says which"
            ],
            [
              "`GET /judge?case=&window=&avgFrom=&log=`",
              "(CLI only)",
              "convergence verdict for a case in the cases folder (judge schema); `log` picks the solver log, such as `log.pimple`; `window` is the iterations (a transient run's time steps) it judges, 200 by default, or `auto`: half the run's, 10 to 200, as `meshdoctor judge` takes it (API 1.11)"
            ],
            [
              "`GET /live`",
              "`/api/status`",
              "the live (transient) case: forces, averaging window, time step, processes, memory"
            ],
            [
              "`GET /variants`",
              "`/api/md/variants`",
              "solver-setting variants for an A/B second run"
            ],
            [
              "`GET /machine`",
              "",
              "the computer the engine runs on, as Linux sees it (inside WSL, what WSL was given): processors, physical cores, memory and the RAM guard's `ram_limit_mb`; the app's size estimator fills in its memory and solver ranks from it (API 1.1)"
            ],
            [
              "`GET /disk`",
              "(new)",
              "the free space for a new case in the cases folder (inside WSL 2, at most that of the Windows drive that holds Linux's own disk), which the disk guard checks a solve against; with `?case=`, what solving that case takes on the disk: a copy of it, a transient run of it, and a solve from the start or continued, on several processes or one (API 1.7); a new transient run's solve from the start with its averaged flow, `transientSolveMb` (API 1.9); with `&writes=`, what a transient run takes when each stretch writes that many times, each kept: a new one's, and a transient run's continuation (API 1.10); with `?template=&size=` (no size: the template's own), what a solve that makes a case of that template takes, as Verify install's does: the new case, its mesh with the sets beside it, then its solve from the start, on several processes or one (API 1.13)"
            ],
            [
              "`GET /disk/repair?source=`, `GET /disk/abtest?name=&iters=&init=&variant=`, `GET /disk/abextend?name=&to=`, `GET /disk/case?template=&size=`",
              "(new)",
              "what a repair, an A/B test, running an A/B test's second run longer or a new case writes, as the disk guard counts it before the job starts, from the params its job takes (and with the refusals its start gives), and the free space of the disk it writes on, in MB: the workspace's, or the cases folder's for a new case (API 1.12)"
            ],
            [
              "`GET /check`",
              "(CLI only)",
              "is this computer ready: `meshdoctor check` as JSON. Python, numpy, the cases folder and the workspace, OpenFOAM 14, the programs a repair, an A/B test and a solve run (`mpirun` among them) and the memory, each `ok`, `warn` or `fail` with what was found, the fix and a command for it, never this machine's folders; and the largest mesh a repair or a solve could take in the memory free now, by the RAM guard. The app's Solve screen opens with it. Each answer runs the checks (a second or two), one at a time (API 1.4)"
            ],
            [
              "`GET /templates`",
              "(CLI only)",
              "the cases the engine can make: the templates in `examples/` (the Ahmed body, a wheel and a front wing), each with its mesh sizes and about how many cells each one makes. A `case` job makes one; `meshdoctor new` lists the same (API 1.5)"
            ],
            [
              "`POST /jobs`",
              "`/api/md/start`, `abstart`, `abextend`",
              "start a repair, A/B test, A/B extension, new case, solve or transient plan (202 Accepted, the job document)"
            ],
            [
              "`GET /jobs?state=&limit=`, `GET /jobs/{job}`",
              "",
              "jobs, newest first, with progress and links to their runs (job schema)"
            ],
            [
              "`POST /jobs/{job}/cancel`",
              "",
              "stop a job and everything it started (`409 finished` if it already ended)"
            ],
            [
              "`GET /runs`, `GET /runs/{name}`",
              "(new)",
              "solves of cases Mesh Doctor made (`solve` jobs, and `meshdoctor solve` in a terminal), newest first: each run's state (`running`, `done`, `stopped` at a written iteration, `failed`, `cancelled`, or `interrupted` when nothing solves it any more: no job, and no solve in a terminal), the iteration it is at, the latest one written and the stretches solved so far (a transient run's in seconds, with `transient`: the steady run it started from, the time of the result it took, its largest Courant number and its model); a transient run's `averaging` says from when it averages its flow, which its solve switches on once its forces have settled (a run made before API 1.9 gets it when it is solved again), when they settled and the latest time written with the average (API 1.9); `times` lists the written times it keeps and `joined` those of them joined in the case's own folder, and a transient run's `transient.writes` says how many times each of its stretches writes, evenly to its end: it keeps every one (API 1.10); one run adds its links, its judge (`GET /judge?case=`; a transient run's with `window=auto`, API 1.11) among them (API 1.6)"
            ],
            [
              "`GET /runs/{name}/live`",
              "(new)",
              "a run's page: its stretches, the solver's iteration, pace and time left (a transient run's: its time steps left, at its latest time step), its residuals and forces over all its stretches, and the live judge (a transient run's: the transient judge, in time steps, as `GET /judge?case=&window=auto` answers it, its means from when its forces settled, judged again at most every 15 s while it solves; and its time steps, `steps`: the time step and the Courant number, mean and largest, at each) (API 1.6)"
            ],
            [
              "`GET /runs/{name}/validation`",
              "(new)",
              "Verify install: a run of the Ahmed body template against the wind tunnel and against the accuracy check's run of the same mesh ([validation.md](validation.md)): its Cd and Cl over the last quarter of its iterations, the drift between that quarter's two halves, and whether it matches (solved to 2000 iterations or more, its drag within 2 % of the accuracy check's); `422 unsupported` for a run made otherwise, `409 not-ready` before it has forces (API 1.6)"
            ],
            [
              "`POST /runs/{name}/stop`",
              "",
              "Stop: the run writes the iteration it is at and ends (`stopAt writeNow`), so a later solve job continues from there (`409 not-ready` if it isn't solving)"
            ],
            [
              "`GET /tplans/{name}`",
              "(new)",
              "the transient plan a `tplan` job made of a case in the cases folder, from its latest result (`tplan` schema): the time step a transient run would need at each max Courant number, which cells set it (where they are, their nearest wall, the flow's speed and their shape there, and the cell set of them the job wrote, and whether it is for the whole mesh), and the steps and hours such a run would take; `404 not-found` before a plan (API 1.6)"
            ]
          ]
        }
      },
      {
        "text": "A job request names its kind and its parameters, which are checked against a schema (also in the OpenAPI document) before anything starts. Unknown parameters are refused:"
      },
      {
        "code": "{\"kind\": \"repair\", \"params\": {\"source\": \"motorBike\", \"name\": \"mb\", \"profile\": \"openfoam\"}}\n{\"kind\": \"abtest\", \"params\": {\"name\": \"mb\", \"iters\": 200, \"init\": \"0.warm\", \"variant\": \"\"}}\n{\"kind\": \"abextend\", \"params\": {\"name\": \"mb\", \"to\": 1000}}\n{\"kind\": \"case\", \"params\": {\"template\": \"ahmed-body\", \"size\": \"coarse\", \"name\": \"ahmed\"}}\n{\"kind\": \"solve\", \"params\": {\"name\": \"ahmed\", \"to\": 2000, \"np\": 4}}\n{\"kind\": \"solve\", \"params\": {\"name\": \"mb-run\", \"source\": \"motorBike\", \"to\": 2000, \"np\": 4}}\n{\"kind\": \"solve\", \"params\": {\"name\": \"verify-install\", \"template\": \"ahmed-body\", \"size\": \"coarse\", \"to\": 2000, \"np\": 6}}\n{\"kind\": \"solve\", \"params\": {\"name\": \"ahmed-ddes\", \"steady\": \"ahmed\", \"maxCo\": 1, \"to\": 0.2088, \"np\": 6}}\n{\"kind\": \"tplan\", \"params\": {\"name\": \"ahmed\"}}",
        "lang": "json"
      },
      {
        "text": "A new repair or A/B test refuses to replace an existing run of the same name (`409 exists`) unless the request says `\"replace\": true`, because the copy step deletes the old run. A new case refuses a name that is taken in the cases folder; there `\"replace\": true` makes again only a case that an earlier case job made (it holds a `.meshdoctor-case.json`), never one you made. A solve runs only in a case Mesh Doctor made, once its mesh is made (`422 unsupported` for a case you made): while no iteration is written it splits the case and starts the flow with `potentialFoam`, and once one is written it continues from the latest, on the same split. A case you made is solved through a copy: with a `source`, the solve first makes `name` as a copy of its mesh and settings, not its results (no time past 0, no `processor*`, `postProcessing` or logs), with the marker naming the case it copied. The copy needs the mesh joined in `constant/polyMesh` (`409 not-ready` for one split onto processors only), a `0` or `0.orig` folder and a steady foamRun setup, a `solver` entry and `steadyState` time schemes (`422 unsupported` without them); one that fails or is cancelled is removed, so its name is free again. With a `template` (and a `size`, else the template's own), the solve first makes `name` from the template as a case job does, then solves it, in one job: its run says `meshing`, then the mesh's own step, while the case is made (Stop works once it solves; a cancel keeps the folder, as a case job's does), and its memory check is the mesh's. That is the web app's Verify install: the coarse Ahmed body solved to 2000 iterations and compared by `GET /runs/{name}/validation`. With a `steady` run (a solved run of a case Mesh Doctor made), the solve first makes `name` a transient run of it: its mesh, settings and latest result, which must be joined (`409 not-ready` while it is on its processors only, or the steady run solves), solved with PIMPLE, `backward` time steps and a time step OpenFOAM adjusts to the largest Courant number `maxCo` (default 1), with the `model`: `DDES`, the default, which starts from a `kOmegaSST` run and takes a `maxCo` of 2 at most, or `URANS` (`422 unsupported` for settings it can't make transient). It starts from the steady flow, so it has no `potentialFoam`, and its times are seconds: its `to` (by default 8 flow times, 8 L/U from the force coefficients' `lRef` and the freestream speed) and its continuations', which must say it. It writes `writes` times a stretch (default 4, up to 200), evenly to its end, and keeps every one, for pictures of the flow over time; a continuation's `writes` goes for its later stretches too (`400 bad-request` with a steady run, a `source` or a `template`). A steady run's `to` is a whole number. A transient plan only reads its case, so it plans a case you made as well as a run; it needs a written result with its face flux (`409 not-ready` before one), and a new plan of a case replaces the last, with its cell set, once it is whole. The old routes keep their old behaviour."
      },
      {
        "table": {
          "head": [
            "Error code",
            "HTTP",
            "Meaning"
          ],
          "rows": [
            [
              "`bad-request`",
              "400",
              "a bad name, parameter or body"
            ],
            [
              "`forbidden`",
              "403",
              "unknown Host, another site's Origin, or a missing or wrong launch token"
            ],
            [
              "`not-found`",
              "404",
              "no such route, run, case or log"
            ],
            [
              "`method-not-allowed`",
              "405",
              "wrong method; the `Allow` header says which"
            ],
            [
              "`exists`, `busy`, `not-ready`, `not-enough-memory`, `not-enough-disk`, `schema-version`",
              "409",
              "the request is fine, but the worker's state refuses it: the run exists, another OpenFOAM job is running, the run it needs is not finished, the RAM guard or the disk guard says no, or a result file is from a newer Mesh Doctor"
            ],
            [
              "`too-large`, `unsupported-media-type`",
              "413, 415",
              "job bodies are JSON (`Content-Type: application/json`), at most 64 KB"
            ],
            [
              "`unsupported`",
              "422",
              "something Mesh Doctor cannot do yet, such as an A/B test of a decomposed-only mesh"
            ],
            [
              "`internal`, `unavailable`",
              "500, 503",
              "a bug (details go to the server window), or a route this server does not run"
            ]
          ]
        }
      },
      {
        "text": "The security rules are the same as for the old routes: the Host and Origin checks on every request, and the launch token (`X-MD-Token`) on every POST. Requiring a JSON body adds one more barrier: a plain form on another site can only send form encodings, which `/jobs` refuses with 415. `tests/security_check.py` checks all of this against a running server."
      },
      {
        "text": "Every page uses only `/api/v1`. The old routes still answer for scripts that call them, but each answer carries a `Deprecation` header (RFC 9745, dated 2026-11-11) and a `Link` to the v1 OpenAPI document. They are removed in a major release."
      }
    ]
  },
  {
    "id": "front-end",
    "title": "Front end",
    "blocks": [
      {
        "text": "The pages are plain HTML and CSS with no build step, so they can be served by this server, copied to a static host, or ported to a framework later. Their rules:"
      },
      {
        "list": [
          {
            "text": "**One shared core, `web/js/md.js`,** loaded first by every page:",
            "list": [
              "`MD.api` is the `/api/v1` client. It sends the launch token on every POST and reads the API's one error format into `MD.ApiError` (`.code` is the API's code: `not-found`, `busy`, `exists`, ...; `.api` is false when no Mesh Doctor API answered, such as a static host or a proxy's error page). `MD.api.find` gives `null` for not-found, for runs that have not finished.",
              "`MD.jobs` starts, follows and cancels jobs. If a run of that name exists, `submit` asks before replacing it. The old routes replaced it silently.",
              "`MD.html` is a template tag that escapes every value: ``MD.html`<b>${name}</b>` ``. `MD.render` puts its result into an element and refuses plain strings. Pages build markup only this way (or with `textContent`); `innerHTML` appears only inside `MD.render`.",
              "`MD.fmt` holds the number formats; `MD.ui` the small DOM helpers (a `<dl>` of rows, a progress bar, the live/offline line)."
            ]
          },
          "**One chart, `web/js/chart.js`** (`MD.chart.line`): log or linear y, outliers clipped on request, the start of a run left out of the y scale on request (`settle`, so a steady run's start-up spike does not flatten the forces), a shaded band (the current stage or averaging window), dashed marks where settings changed, a text-only hover tooltip, and 1-2-5 ticks. The tick and range maths are plain functions with their own tests.",
          "**Each page's script is its own file in `web/js/`,** served at `/js/<name>.js` (plain names only).",
          "**Every page gets a Content-Security-Policy header.** It allows nothing from other sites (`default-src 'none'`), connections only to this server, and no framing. Pages whose script is all in files (`STRICT` in `server.py`: every page, the report viewer included) run no inline script at all (`script-src 'self'`). Even if a bug let markup from a run file into the page, it could not run code."
        ]
      },
      {
        "text": "`tests/test_units.py` (`PagesTest`) checks these rules on every page, `tests/js/` tests `md.js` and the chart maths with Node's own test runner (`node --test tests/js/*.test.js`), and `tests/security_check.py` checks the headers and the `/js/` route on a running server."
      }
    ]
  },
  {
    "id": "jobs",
    "title": "Jobs",
    "blocks": [
      {
        "text": "`meshdoctor/jobs.py` is the only place that starts long-running work. A job is a file `<workspace>/.jobs/<id>.json` (`schemas/job.schema.json`):"
      },
      {
        "code": "{\"schemaVersion\": \"1.0\", \"id\": \"20261111-213000-repair-mb-3fa2\", \"kind\": \"repair\",\n \"params\": {\"source\": \"motorBike\", \"name\": \"mb\", \"profile\": \"openfoam\"}, \"name\": \"mb\",\n \"state\": \"running\", \"runner\": \"local\", \"created\": \"2026-11-11T21:30:00Z\", \"started\": \"...\", \"finished\": null,\n \"pid\": 4242, \"exitCode\": null, \"log\": \"mb.log\", \"result\": \"mb/meshDoctor/result.json\", \"error\": null,\n \"progress\": {\"step\": \"checkMesh (after)\", \"fraction\": 0.75, \"updated\": \"...\"}}",
        "lang": "json"
      },
      {
        "list": [
          "**States:** `queued` → `running` → `done` | `failed` | `cancelled`. Paths are relative to the workspace, so a job means the same thing on another worker.",
          "**Admission** happens in `jobs.submit`, so every client gets the same rules. Only one big job runs at a time, judged from the job files, from solves run in a terminal (`meshdoctor solve`, whose status files name their processes) and from OpenFOAM processes started outside Mesh Doctor (from `/proc`). The RAM guard runs before the job is written, and the disk guard (`diskguard.py`): for a solve, the new case it makes (a copy of a case you made, a transient run, or a template's mesh) and what it writes as it goes, its split and its written times worked out from the size of its mesh, must fit in the cases folder's free space with 1 GB to spare, and so must a new case's mesh with the sets beside it. In the workspace's, so must a repair's copy, its points' backup, the sets it writes and room to collapse faces in its mesh; an A/B test's copy of the case for each run it solves, with its split and two written times; and the times running its second run longer writes.",
          {
            "text": "**The LocalRunner** starts `jobrun.py`, a small wrapper, detached from the server. Init adopts it, so a finished job leaves no zombie process, and a job keeps running if the server stops. The wrapper:",
            "list": [
              "runs the command, an argument list with no shell, at nice 5 in its own process group;",
              "writes the log;",
              "records `running`, then the end state, exit code and finish time."
            ],
            "after": "The command comes from the wrapper's own arguments, never from the job file. While a job is live, only the wrapper writes its file, so no update is lost."
          },
          "**Cancel** sends SIGTERM to the wrapper. The wrapper stops the whole process group (mpirun ranks included), sends SIGKILL after 30 s, and records `cancelled`.",
          "**Progress** is read when a job is read, from the tool's own `status.json` / `ab_status.json`, a new case's `.meshdoctor-case.json` (which follows its `Allmesh` and snappyHexMesh's phases) or a solve's `.meshdoctor-solve.json` (whose fraction follows the iterations, or a transient run's time). It holds the current step, and a rough fraction where the step is known.",
          "**Lost jobs:** a `running` job whose wrapper is gone (machine restarted, process killed) is marked `failed` with a reason the next time it is read. So is a `queued` job that never started within a minute.",
          "**Errors** are the last line of the job's log, with the workspace's and the cases folder's paths removed, because they may be shown on a web page.",
          "`md_api` (and so the old dashboard routes and `/api/v1/jobs`) starts work only through `jobs.submit`. `meshdoctor jobs [list | show <id> | cancel <id>]` follows jobs from the shell. The CLI commands (`full`, `ab`, ...) still run in the foreground without a job file.",
          "**Later runners:** a `SlurmRunner` would submit the sbatch templates and read `squeue`. A remote **worker** would poll a queue over an outgoing connection, so no port on your machine is ever opened to the internet. Both write the same job files."
        ]
      }
    ]
  },
  {
    "id": "three-ways-to-put-it-on-the-web",
    "title": "Three ways to put it on the web",
    "blocks": [
      {
        "table": {
          "head": [
            "Shape",
            "What runs where",
            "Team data",
            "Needs"
          ],
          "rows": [
            [
              "**1. Local (today)**",
              "everything on your machine; the browser talks to 127.0.0.1",
              "stays on your machine",
              "nothing more"
            ],
            [
              "**2. Static report viewer**",
              "a static site (for example Vercel) serves only `web/report.html`; you open a report bundle from your own disk, and it is read in the browser and never uploaded",
              "never on the server",
              "ready: `meshdoctor report --viewer` writes the one file to deploy"
            ],
            [
              "**3. Hosted app + private workers**",
              "the website and API are hosted; workers (your PC, cluster, cloud VM) pull jobs and push results to private storage",
              "stored in the hosted service",
              "real sign-in, per-user storage, a job queue, a worker that connects out, CORS and rate limits, and a decision about which data may leave the team's machines"
            ]
          ]
        }
      },
      {
        "text": "Shape 2 comes first: it is useful on its own (share a result with a teammate as a file), costs nothing to host, and keeps the data rule simple. Shape 3 is only worth building once shapes 1 and 2 are solid, and it needs the team's agreement on where data may live. On Vercel's Hobby plan the production domain is public, so shape 3 would need a paid plan or another host with access control."
      }
    ]
  },
  {
    "id": "order-of-work",
    "title": "Order of work",
    "blocks": [
      {
        "list": [
          "This document. (Done.)",
          "Schemas and `schemaVersion` for the result files, validated in tests. (Done.)",
          "The `/api/v1` router with the error format and `openapi.json`. Old routes become aliases. (Done.)",
          "The job model and `LocalRunner`. `md_api` starts jobs only through it. (Done.)",
          "`meshdoctor report <name>`: the portable bundle, and a viewer that reads only bundles. (Done.)",
          "Shared front-end modules (charts, 3D viewer, API client); pages move to `/api/v1`. (Done: `md.js` and `chart.js` under every page, the report viewer included; every page uses only `/api/v1` and runs no inline script; the old routes are marked deprecated; exports inline the scripts, pinned by hash. Left for later: the WebGL viewer as a module.)",
          "A pluggable auth layer: the launch token now, real sign-in for shape 3.",
          "The package restructure (`core/`, `jobs/`, `api/`) with shims, once the boundaries above are proven."
        ],
        "numbered": true
      },
      {
        "text": "Each step keeps every test passing and every command working, so the tool stays usable while it changes."
      }
    ]
  }
];
