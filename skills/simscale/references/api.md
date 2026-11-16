# SimScale API calls that worked (from the workbench page, same-origin fetch)

All calls run as `fetch(url, {credentials: 'include', ...})` from a tab on the SimScale workbench the user is signed
in to. Reload the workbench page after any PUT so the UI shows the change. IDs below are placeholders.

## Specs

| What | Call |
|---|---|
| Read / write a simulation spec | `GET` / `PUT /api/v1/spec/simulation/{specId}` (add `?validate=true` to get a problem list) |
| Read / write a mesh spec | `GET` / `PUT /api/v1/spec/meshing/{meshSpecId}` |
| Simulations and runs of a project | `GET /api/v2/projects/{pid}/simulations` -> `runs[]` with `runningStatus`, `progress` (0..1), `resultUuid` |
| Meshes of a project | `GET /api/v2/projects/{pid}/meshes` -> `runningStatus`, `relatedResultUuid` |
| Results and their files | `GET /api/v2/projects/{pid}/results` -> each result's `components` (FORCE_PLOT, RESIDUALS_PLOT, SOLVER_LOG, ...) with `downloadUrl` |
| One log component | `GET /api/v2/projects/{pid}/results/{rid}/components/{componentUuid}` (last ~1500 lines) |
| Mesh-size estimate | `GET /api/v1/computeresources/estimate?meshSpecId=...` - ignores refinements; for hex-dominant its "nodes" figure tracked real cells on one case, but it swung wildly elsewhere. Don't trust it. |

Useful spec paths: `analysis.resultControl.forcesMoments[]` (force groups), the end time / write interval /
max run time under the simulation control (raise all three for a longer run, then reload the page).
New simulations can come with a `meshSpecId` already; a duplicated simulation **shares** the original's mesh spec, so
make a separate mesh with the Mesh panel's "Create new mesh using settings from...". "Regenerate" on an assigned mesh
asks to delete the old result; copy instead. "Remove Assignments and Regenerate" unassigns the mesh: re-open the Mesh
under the simulation and confirm it before starting a run.

## Geometry (CAD service)

| What | Call |
|---|---|
| Face list | `GET /csm/v2/cads/{cad}/states/{state}/topology?version=1` -> `bodies[].entities` of type Face, IDs `B{body}_TE{n}` |
| Face areas | `POST /csm/v2/cads/{cad}/states/{state}/query?source=WORKBENCH` body `{query:'amount_info', parameters:{unit:'m'}}` |
| Face boxes | same, `{query:'bounding_box', parameters:{unit:'m', faces:[...]}}` -> `boundingBoxPerFace`; with no faces -> `boundingBoxPerBody` |
| External flow volume | `POST /csm/v2/cads/{cad}/states/{state}/features?source=WORKBENCH` body `{parentFeatureId, feature:'flow_volume_extraction_external', parameters:{flow_box:{box:{minX,...,maxZ}, unit:'m'}, excluded_parts:[]}}` |
| Delete the solid bodies afterwards | same endpoint, `{feature:'delete_occurrences', parameters:{occurrences:[names of regions with tiny volume from amount_info]}}` |
| Wait for an operation | poll `GET /csm/v2/cads/{cad}`; queries return 202 until ready |

Box faces of the flow region keep the same numbers across projects made the same way (e.g. Max X, Min X, Min Y ...),
so read them once from the topology and reuse. Model faces come in per-body blocks ordered by body name; they change
on every re-upload, so reselect them by bounding box.

## Reading a mesh result

The cell count lives in the mesh result's SOLVER_LOG entries: a line with `cells:` (checkMesh), or, if missing,
`scheme 2 cells : N` near the end. The snappy log's "Cells per refinement level" appears after castellation, long
before the mesh finishes - read it ~10-15 minutes in and cancel if the count is far off target (the final count is
~0.83-0.90 of the castellation count, after cells inside solids are removed).

## UI facts

- The run "+" next to "Simulation runs" only shows on hover; find it as the last "Create" button in the
  accessibility tree. Then "Simulation setup has warnings" -> Run anyway -> "New run" dialog -> Start.
- Escape closes the New Project dialog and loses what was typed. A new project opens the workbench in a new tab;
  read the card's link (`workbench/?pid=...`) and navigate in the same tab if new tabs are blocked.
- Face picking in the UI: box-select is "fully inside"; use the top view. API face lists are far faster.
