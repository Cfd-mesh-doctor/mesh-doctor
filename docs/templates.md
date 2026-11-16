# Starting your own case from the Ahmed example

`examples/ahmed-body` is a complete, tested external-aero case (snappyHexMesh, steady k-omega SST, moving ground,
forces). Copy the folder and change the parts below; leave the rest.

```bash
cp -r examples/ahmed-body $FOAM_RUN/mycase && cd $FOAM_RUN/mycase && ./Allclean
```

## 1. Geometry

Put your STL in `constant/geometry/` and point the case at it:

- `system/surfaceFeaturesDict`: `surfaces ("mymodel.stl");`
- `system/snappyHexMeshDict`: in `geometry`, `mymodel { type triSurface; file "mymodel.stl"; }`, and rename the
  `ahmed` entry in `refinementSurfaces` and the `"ahmed.*"` layer entry. Keep `inGroups (ahmedGroup)` (or rename the
  group everywhere: the `initial/` fields and both force functions in `system/controlDict` use it).
- `Allmesh`: replace the `make_ahmed.py` line with nothing (your STL is already there).
- One STL solid per part gives one patch per part (`mymodel_frontWing`, ...), so you can get forces per part.

Check the STL first: `surfaceCheck constant/geometry/mymodel.stl` must say "Surface is closed" and one zone per body.
Export in metres, with the toolkit's axes (x forward, z up, ground at z = 0) so the scripts' views are right.

## 2. Domain and cells

- `system/blockMeshDict`: about 3-4 lengths ahead, 6-8 behind, 3+ heights above and to the side; blockage under 5 %.
  Keep the background cell a power-of-two multiple of the sizes you want near the body.
- `system/snappyHexMeshDict`: refinement boxes around the near body, the wake and small gaps; surface levels per part
  (thin plates need cells under 1/3 of their thickness). Read "Cells per refinement level" in `log.snappyHexMesh`.
- Size it first: `python3 skills/cfd-results/scripts/size_estimate.py <million cells>`.

## 3. Flow conditions

- `initial/conditions`: free-stream velocity (pointing toward -x), `kInf`, `omegaInf`.
- `system/controlDict`: `magUInf`, `lRef`, `Aref` (half the frontal area for a half model), `CofR`, `rhoInf` in both
  force functions.

## Variant: wheel and wing on a moving ground (full model, no symmetry)

- `system/blockMeshDict`: domain on both sides (y from -Y to +Y); turn the `symmetry` patch into a second `side`
  patch (type patch) and set it to `slip` in `initial/*`.
- Sink the tyre 3-6 mm into the ground (flat contact patch) in CAD, so there is no zero-thickness wedge.
- Rotating wheel, in `initial/U` (give the wheel its own STL solid, e.g. patch `model_wheel`):

  ```
  model_wheel
  {
      type    rotatingWallVelocity;
      origin  (0.21 0.01 0.198);     // wheel centre
      axis    (0 1 0);               // sign: the contact patch must move like the ground (toward -x)
      omega   75.7;                  // rad/s = U / rolling radius
  }
  ```
- Add a refinement box for the tyre contact and the gap between parts. Expect 1500+ iterations before a rotating
  wheel's forces settle.

## Variant: half car with a symmetry plane

The Ahmed case already is one: keep `symmetry` at y = 0 and model the left half only. Halve `Aref` (and remember
that forces are for the half car: double them for the full car, except side force and yaw/roll moments, which
cancel). Asymmetric cars need a full model.

## After meshing

Run `meshdoctor full <case> <name>` before solving; if it reports regressions it rolls them back. Then
`./Allrun <ranks> <iterations>`, and judge the result with the cfd-results skill (last-window means, drift).
