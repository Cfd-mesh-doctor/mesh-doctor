# Architecture

Where the code is today, where it is going, and why. The goal is that Mesh Doctor can later become a website without a rewrite: the parts that compute, the parts that serve, and the parts that draw stay separate, and they agree on versioned data.

## The rule that shapes everything

**Meshing and solving can never run on a web host.** OpenFOAM needs gigabytes of memory and runs for minutes to days. Serverless platforms such as Vercel stop a function after 300–800 s and give it 2–4 GB. So the computing always happens on a **worker**: your own machine, a lab PC, a cluster node, or a cloud VM. A website can only be the front end, plus a thin API that hands jobs to workers and shows their results.

## Layers

```
 clients      CLI (meshdoctor ...)   local dashboard (web/)   future website
                  |                        |                        |
 api          ----+---- /api/v1 (JSON, versioned, OpenAPI) ---------+
                  |
 jobs         Job model + Runner:  LocalRunner (today)  |  Slurm / remote worker (later)
                  |
 core         case reading, repair, A/B, judge, map, RAM guard, config   (no HTTP, no UI)
                  |
 OpenFOAM     foamMeshDoctor, foamResidualHotspots, checkMesh, foamRun, ...
```

Rules between layers:
- **core** never imports `api`, `web` or `jobs`, never prints for a UI, and returns plain data (dicts that match the schemas below). The CLI and the API are its only callers.
- **jobs** is the only place that starts long-running processes. Admission rules (one big job at a time, the RAM guard) live here, so every client gets them.
- **api** translates HTTP to core and jobs calls. It holds the security checks (host and origin, token, plain names) and nothing else.
- **web** talks only to `/api/v1`. It never reads files or assumes it is served from the same machine as the worker.

## Where the code is today

| Today | Layer | Notes |
|---|---|---|
| `caseinfo.py`, `ramguard.py`, `config.py`, `mapdata.py` | core | already free of HTTP and UI |
| `repair.py`, `abtest.py` | core + CLI | the library functions (`full`, `fix`, `judge`, `run_one`, ...) are core; their `main()` is CLI |
| `md_api.py` | api + jobs | starts jobs with `Popen`, and finds running ones from `/proc` and `status.json` |
| `server.py` | api | an if-chain over `/api/md/*`, `/api/run` and `/api/status`; security checks |
| `web/*.html` | web | four pages; chart and 3D-viewer code is copied between them |
| `__main__.py` | CLI | dispatches to the scripts |

The modules import each other by plain name (`import caseinfo`), which `__main__` makes work from a clone, pip and the images. New code keeps that convention until the package is restructured. That restructure is the last step below, not the first, so the tree never goes through a broken state.

## Results: portable and versioned

Every file Mesh Doctor writes for another program to read carries `"schemaVersion": "<major>.<minor>"`, and has a JSON Schema in `meshdoctor/schemas/`:

| File | Written by | Read by |
|---|---|---|
| `meshDoctor/result.json` | repair | dashboard, map, A/B, reports |
| `<name>_ab/ab_result.json` | A/B test | dashboard, reports |
| judge output | `judge` (CLI, API) | dashboard live pages, reports |
| `meshDoctor/map.json` | map | repair map page, reports |
| `.jobs/<id>.json` | job runner | API, dashboard |

- A minor bump only adds fields. A major bump changes or removes them.
- Readers accept any minor version of the major version they know, and refuse a newer major version with a clear message.
- Tests validate real outputs against the schemas, so a field cannot quietly disappear.
- `meshdoctor schema <repair|abtest|judge|map> <file>` checks any file by hand. `meshdoctor/schema.py` holds the versions, the read and write helpers (which stamp the version and refuse a newer major version), and a small validator for the JSON Schema keywords the schemas use (standard library only, like the rest of the package).
- Files written before versioning existed have no `schemaVersion`. They are read as "legacy" and never re-stamped, so an old file is not mislabelled as 1.0.

This is what makes a **report bundle** possible: a folder of these files plus a viewer, which can be opened anywhere, including a static website, without the worker.

## API v1

All routes live under `/api/v1`. Responses are JSON, and errors are always `{"error": {"code": "...", "message": "..."}}` with a matching HTTP status. The server publishes `/api/v1/openapi.json`, so a website (or a script) can be written against the description instead of the code.

| v1 route | Today | Purpose |
|---|---|---|
| `GET /cases` | `/api/md/sources` | source cases the worker may read |
| `GET /repairs`, `GET /repairs/{name}` | `/api/md/results`, `/api/md/result` | repair runs and their result |
| `GET /repairs/{name}/clusters/{id}` | `/api/md/cluster` | geometry of one defect cluster |
| `GET /repairs/{name}/log` | `/api/md/log` | repair log |
| `GET /abtests`, `GET /abtests/{name}` | `/api/md/ablist`, `/api/md/ab` | A/B tests and their residuals |
| `GET /abtests/{name}/live` | `/api/run?label=` | the steady-run page: progress, forces, residuals, live judge |
| `GET /maps`, `GET /maps/{name}` | `/api/md/maplist`, `/api/md/map` | repair maps |
| `GET /judge?case=` | (CLI only) | convergence verdict for a case |
| `GET /live` | `/api/status` | the live (transient) case: forces, averaging window, time step, processes, memory |
| `GET /variants` | `/api/md/variants` | solver-setting variants |
| `POST /jobs`, `GET /jobs`, `GET /jobs/{id}`, `POST /jobs/{id}/cancel` | `/api/md/start`, `abstart`, `abextend` | start and follow repair, A/B, extend and map jobs |

The old routes stay as aliases until the pages have moved to v1, then they are removed in a major release.

## Jobs

A job is a file `<workspace>/.jobs/<id>.json`:

```json
{"schemaVersion": "1.0", "id": "20261111-213000-repair-mb", "kind": "repair",
 "params": {"source": "motorBike", "name": "mb", "profile": "openfoam"},
 "state": "running", "created": "...", "started": "...", "finished": null,
 "progress": {"step": "checkMesh (after)", "fraction": 0.8},
 "log": "mb/meshDoctor/log.full", "result": "mb/meshDoctor/result.json", "error": null}
```

- **States:** `queued` → `running` → `done` | `failed` | `cancelled`.
- **Runners** turn a job into a process. `LocalRunner` is today's behaviour (a detached process on this machine, with the one-big-job rule and the RAM guard). `SlurmRunner` would submit the sbatch templates. A remote **worker** would poll a queue over an outgoing connection, so no port on your machine is ever opened to the internet.
- The API, the CLI and the dashboard all start work through the runner, never with their own `Popen`.

## Three ways to put it on the web

| Shape | What runs where | Team data | Needs |
|---|---|---|---|
| **1. Local (today)** | everything on your machine; the browser talks to 127.0.0.1 | stays on your machine | nothing more |
| **2. Static report viewer** | a static site (for example Vercel) serves only the viewer; you open a report bundle from your own disk, and it is read in the browser and never uploaded | never on the server | report bundles, a viewer that uses only the schemas |
| **3. Hosted app + private workers** | the website and API are hosted; workers (your PC, cluster, cloud VM) pull jobs and push results to private storage | stored in the hosted service | real sign-in, per-user storage, a job queue, a worker that connects out, CORS and rate limits, and a decision about which data may leave the team's machines |

Shape 2 comes first: it is useful on its own (share a result with a teammate as a file), costs nothing to host, and keeps the data rule simple. Shape 3 is only worth building once shapes 1 and 2 are solid, and it needs the team's agreement on where data may live. On Vercel's Hobby plan the production domain is public, so shape 3 would need a paid plan or another host with access control.

## Order of work

1. This document.
2. Schemas and `schemaVersion` for the result files, validated in tests.
3. The `/api/v1` router with the error format and `openapi.json`. Old routes become aliases.
4. The job model and `LocalRunner`. `md_api` starts jobs only through it.
5. `meshdoctor report <name>`: the portable bundle, and a viewer that reads only bundles.
6. Shared front-end modules (charts, 3D viewer, API client); pages move to `/api/v1`.
7. A pluggable auth layer: the launch token now, real sign-in for shape 3.
8. The package restructure (`core/`, `jobs/`, `api/`) with shims, once the boundaries above are proven.

Each step keeps every test passing and every command working, so the tool stays usable while it changes.
