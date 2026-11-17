# Gallery

What the toolkit's scripts make, all from the worked example (`examples/ahmed-body`: Ahmed body, 25 degree slant,
40 m/s, 836 k cells, steady k-omega SST). Each picture names the script and command that made it, so you can make
the same set for your own case (`/cfd-toolkit:pictures <case>` in Claude Code does all of it).

## Vortices: `vortex_views.py`

Q-criterion iso-surfaces coloured by the streamwise vorticity (red clockwise seen from behind, blue anticlockwise).

![Rear three-quarter view, Q = 20,000](images/ahmed_Q20000_rear34.png)
![Side view, Q = 70,000](images/ahmed_Q70000_side.png)

## Cut planes: `cut_views.py`

Planes from a JSON list (`examples/ahmed-body/cuts.json`), coloured by speed, Cp or total-pressure coefficient Cp,t
(1 = no losses, so dark areas are wakes and vortex cores).

![Speed on the centreline](images/ahmed_c1_side_centre_U.png)
![Total pressure on the centreline](images/ahmed_c1_side_centre_Cpt.png)
![Cross cut 0.2 m behind the base](images/ahmed_c3_cross_wake_Cpt.png)

## Convergence charts: `plot_convergence.py`

Forces with the averaging window shaded, residuals on a log scale, and a summary table with the window means and the
drift between windows.

![Total drag and lift](images/ahmed_forces_total.png)
![Residuals](images/ahmed_residuals.png)

## Dashboard: `meshdoctor serve`

Live progress of a running case, Mesh Doctor repairs and the repair map: see [dashboard.md](dashboard.md).

![Mesh Doctor page](images/meshdoctor.png)

## How accurate are these?

The same case on three meshes and at a second slant angle, against the wind tunnel: [validation.md](validation.md).
