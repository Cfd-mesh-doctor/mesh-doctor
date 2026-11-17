# Accuracy check: how close are the answers?

Before trusting a toolkit with your own car, check it on a case with a known answer. The Ahmed body is the standard
one: a simple car-like body measured in the wind tunnel by Ahmed, Ramm and Faltin (1984). The example in
`examples/ahmed-body` runs it through the same chain you would use for a car: snappyHexMesh, Mesh Doctor, a steady
k-omega SST solve on a moving ground, then the charts.

Run it yourself (about 2 h on 6 cores, 4.5 GB peak):

```bash
. /opt/openfoam14/etc/bashrc
cp -r examples/ahmed-body $FOAM_RUN/ahmed && cd $FOAM_RUN/ahmed
./Allvalidate 6 2000          # ranks, iterations per case; writes ../ahmed_validation/results.md
```

## Results

Tested with OpenFOAM 14, 2000 iterations per case on 6 cores. Cd and Cl are the means over the last 500 iterations;
drift is the change between the two halves of that window (under 1 % means settled).

| Case | Slant | Cells | Cd | Drift | Cl | Wind tunnel Cd | Difference | Solve time |
|---|---|---|---|---|---|---|---|---|
| coarse | 25 deg | 0.48 M | 0.299 | -0.11 % | 0.298 | 0.285 | +4.8 % | 14 min |
| medium | 25 deg | 0.84 M | 0.280 | -0.02 % | 0.295 | 0.285 | -1.7 % | 27 min |
| fine | 25 deg | 1.57 M | 0.280 | -0.05 % | 0.292 | 0.285 | -1.8 % | 51 min |
| 35 deg | 35 deg | 0.84 M | 0.408 | -0.15 % | 0.445 | 0.26 | +57 % | 24 min |

Wind tunnel: Ahmed, Ramm & Faltin, SAE 840300 (1984), 60 m/s; the 35 deg value (about 0.26) as quoted from it in
later papers. Simulation: 40 m/s, half model with a symmetry plane, moving ground, no stilts. The three 25 deg meshes
differ only in the background cell size; every refinement level follows it, so each step roughly doubles the cells.

## What it shows

- **The mesh is fine enough at 0.84 M cells.** Going from the medium to the fine mesh (twice the cells) changes Cd
  by less than 0.5 % and Cl by 1 %. The coarse mesh is 7 % higher: too coarse for numbers, fine for a quick look.
  Do the same on your own car: run two meshes and only quote numbers that stop changing.
- **25 deg: within 2 % of the wind tunnel.** That is better than steady RANS usually manages on this shape, and
  part of it is luck: the real flow separates at the top of the slant and reattaches, which two-equation models
  get only roughly. The big features (stagnation, base wake, the slant-edge vortices) are right; see
  `docs/gallery.md`.
- **35 deg: steady RANS gets it wrong.** In the wind tunnel the flow leaves the slant completely above about 30 deg
  and the drag drops to 0.26. Here the flow stays on the slant, the edge vortices grow, and Cd rises to 0.408 (the
  high lift, 0.445, shows the same). This is a known weakness of steady RANS near the critical angle, and it is
  the reason for this page: a settled, smooth-looking result can still be wrong. Where a part sits near a
  separation point (a steep diffuser, a highly loaded flap, a slant like this), check with a transient DDES run or
  a test, and compare designs rather than trusting the absolute number.

## Using this on your own work

- Treat differences between designs (A vs B on the same mesh and setup) as more reliable than absolute numbers.
- Settled forces (drift under 1 %) only mean the solver has stopped changing, not that it is right.
- Report a mesh study with the result: two meshes, and the change between them.
