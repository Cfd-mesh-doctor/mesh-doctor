# Template: wheel and wing on a moving ground

A ready-to-run starting point for the most common racing-car aero question: a front wing in ground effect ahead of a
rotating wheel. It is a full model (no symmetry plane), with a moving ground, a rolling wheel and forces per part.
Drop in your own STL and adjust the numbers marked below.

```bash
. /opt/openfoam14/etc/bashrc
cp -r examples/wheel-wing $FOAM_RUN/myWing && cd $FOAM_RUN/myWing
./Allmesh                 # geometry from make_wheel_wing.py, then snappyHexMesh (serial)
./Allrun 6 1500           # 6 cores, 1500 iterations; run again with a bigger number to continue
```

**Tested** (OpenFOAM 14, 6 cores): 0.92 M cells in under 3 min (1.7 GB), wing layers 2.9 of 3, wheel 2.6. checkMesh
fails on concave cells and a few low-weight faces; `meshdoctor full` repairs the low-weight faces with no regressions.
The solve runs at about 0.9 s per iteration (0.8 GB). After 300 iterations: wing 8.9 N downforce and 0.8 N drag
(Cl about 0.43 on 0.154 m2, still rising), wheel 11 N drag and 6 N lift. These are a smoke test, not settled numbers:
run 1500 or more iterations before comparing designs.

## What is in it

| File | What it sets |
|---|---|
| `make_wheel_wing.py` | the demo geometry: an 18 inch wheel sunk 5 mm into the ground, an upside-down NACA 4412 wing (0.28 m chord, 6 deg, 50 mm off the ground). Options `--aoa`, `--clearance`, `--sink` |
| `initial/conditions` | speed (15 m/s toward -x), turbulence, wheel rotation `omegaWheel` = speed / rolling radius |
| `initial/U` | moving ground, slip top and sides, no-slip parts, the wheel's `rotatingWallVelocity` |
| `system/blockMeshDict` | the domain: 6.0 x 2.6 x 1.4 m, 0.1 m background cells |
| `system/snappyHexMeshDict` | refinement boxes (wakes, the wing and its ground gap, the tyre contact), surface levels per part, 3 layers |
| `system/controlDict` | `forcesTotal`, `forcesWing`, `forcesWheel` (N, rho 1.205) |

## Use it for your own parts

1. **Geometry.** Export your parts as one STL, in metres, in the toolkit's axes (x forward, z up, ground at z = 0),
   one solid per part. Save it as `constant/geometry/model.stl` and delete the `make_wheel_wing.py` line in
   `Allmesh`. Each solid `xyz` becomes the patch `model_xyz`. Check it first: `surfaceCheck model.stl` must say
   "Surface is closed".
2. **Tyre contact.** Sink the tyre 3-6 mm into the ground in CAD (a flat contact patch). A tyre that only touches the
   ground leaves a zero-thickness wedge that snappyHexMesh can't mesh.
3. **Wheel rotation.** In `initial/U`, set `origin` to your wheel centre and `omegaWheel` in `initial/conditions` to
   speed / rolling radius. Keep `axis (0 1 0)` for a wheel on the +y side rolling forward; check that the contact
   patch moves the same way as the ground (toward -x). Several wheels: one entry per wheel patch.
4. **Parts and levels.** In `snappyHexMeshDict`, give each region a surface level: thin plates need cells under a
   third of their thickness (a 3 mm endplate needs level 6, 1.6 mm). Move the boxes to cover your wakes and gaps.
5. **Forces.** Add one `forcesXyz { $forceDefaults; patches (model_xyz); }` per part you want to see. Many force
   objects slow the run down; group small parts.
6. **Size it** before meshing: `python3 skills/cfd-results/scripts/size_estimate.py <million cells>`.

## Charts

```bash
python3 skills/paraview-post/scripts/plot_convergence.py $FOAM_RUN/myWing charts ww "Wing and wheel, 15 m/s" \
    --total forcesTotal --parts forcesWing:Wing,forcesWheel:Wheel --uinf 15 --rho 1.205 --window 500
```

A rotating wheel's forces take longer to settle than a wing's: expect 1500 or more iterations, and judge them by the
drift between the last two averaging windows (the cfd-results skill).
