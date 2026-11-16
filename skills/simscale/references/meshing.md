# SimScale hex-dominant (snappy) meshing: what the sizes really do

## The size ladder

Snappy refines by halving a base cell. Every requested size **snaps down** to the next level of that ladder, so a
request just below a level costs a whole extra level (8x cells in a volume, 4x on a surface).

- Find the ladder from the meshing log ("Cells per refinement level") or from the base size: with base 172 mm the
  levels are 86 / 43 / 21.5 / 10.8 / 5.4 / 2.7 / 1.35 mm. Request sizes **just above** a level (10.8 -> 10.4 mm
  actual) - "10 mm" became 5.2 mm on one case.
- Manual sizing (`sizing: {type:'MANUAL', maximumEdgeLength, minimumEdgeLength}`) controls the base. On one domain
  max 0.172 m gave ~50 mm level-0 cells, not 172 mm, and every refinement landed one level finer than planned
  (25.8M cells). Always read the real level sizes from the first mesh's log, then set the refinements.
- Automatic sizing on a small model in a big box can estimate far too many nodes and fail with "No instance with
  sufficient computational resources". Manual sizing fixed it.

## Cell-count calibration

- Volume boxes at fine levels cost far more than volume / h^3: two small boxes estimated at +1.1M added ~4.9M.
  Volume-based guesses ran 1.6-2x low on the whole.
- Surface refinement at 2.6 mm costs ~0.9M cells per m^2 of surface (with its buffer layers).
- The finest surface on a large curved part (e.g. a wing at 1.3 mm) dominates the count. Keep the finest level only
  inside small boxes where it matters (slot gaps), not on the whole surface.
- Thin parts (3-7 mm skins, plates) meshed at 5-10 mm come out ragged and crinkled; give them ~2.6 mm and holes
  ~1.3 mm.
- Grade refinements: finest at surfaces and small gaps, coarser near body, coarsest wake. Moderate global fineness
  plus graded zones beat a high global fineness.

## Failures seen

| Symptom | Cause / fix |
|---|---|
| "element size too close to CAD tolerance" (standard mesher) | sub-micron CAD edges; hex-dominant ignores them |
| "multiple-regions-in-single-region-mesh" | solid bodies still present next to the flow volume; delete them |
| Out of memory / "instance unhealthy" restarts in snapping | ~12M+ cells with millions of fine surface points; trim the finest surfaces |
| Solver crash at start, no core hours charged | mesh too big for the plan (~14M+ cells) |
| "Min Y defeatured" style run failures | a boundary condition on a box face that no longer exists; pick the real face |
| Mesh quality warning (skewness/non-ortho) | usually a few faces; "Run anyway" is fine if counts are small, but read them |

## Quality to expect

A good 5-10M car/wheel mesh: max non-orthogonality ~55-70 deg, a handful of faces over skewness 4, one region.
No boundary layers unless "Automatic boundary layers" is switched on in the mesh panel.
