# Safety model

Mesh Doctor is built so that it cannot damage a case you care about, and so that its dashboard is not a way into your machine. Each rule below is enforced in code, and most are covered by the tests in `tests/`.

## Your cases are only read

- **Every job works on a copy** in the workspace (`<workspace>/<name>`). The source case is opened read-only.
- **The utility refuses to touch an original.** `foamMeshDoctor -fix` exits unless the case holds a `.meshDoctorCopy` marker, which only Mesh Doctor's own copy step writes.
- **Proof afterwards.** Before each job, Mesh Doctor takes a SHA-256 fingerprint of the source case's mesh and settings, and checks it again at the end. The result is in `result.json` (`sourceCheck`) and `ab_result.json`. If the source ever changed, the dashboard says so and the command exits with code **3**.
- **Plain names only.** Run and case names must be letters, digits, `_`, `.` and `-` (at most 80 characters, not starting with `.`), so no name can reach outside the workspace or the cases folder. Mesh Doctor only deletes and re-makes folders inside the workspace, and the cases it made from a template (below).
- **A new case goes in a new folder.** A case made from a template (`meshdoctor new`, or New case on the app's Solve screen) is copied into the cases folder under a name that isn't taken there, with a `.meshdoctor-case.json` marker. Only a case with that marker is ever replaced, and only when you ask (`--replace`), as after a mesh that failed. A case you made is never changed.
- **A solve runs only in a case Mesh Doctor made.** A solve (`meshdoctor solve`, or Solve in the app) runs only in a case with that marker whose mesh is made, never in a case you made: a case you made is solved through a copy of its mesh and settings, not its results, made under a new name with the marker (naming the case it copied), with files of its own (it follows the links in your case rather than keeping them, so a solve can't write through one into your case), and a copy cut short is removed. In the case it solves, a solve changes only the run's own settings (`endTime`, `writeInterval`, `startFrom`, `stopAt`, the split onto processes and, in a copy, `deltaT` and `writeControl`, so that it counts and writes by iteration, or in a transient run `startTime` and `beginTime`, so that it goes on from its latest time) and writes its results beside them. A transient run of a steady run is a new case too, made under a new name from the steady run's mesh, settings and latest result, which it only reads. Stop asks the solver to write the iteration it is at and end, so nothing solved is lost.
- **Keep the workspace outside your cases.** By default it is `<cases>/meshdoctor`, a separate folder.

## The mesh can only get better

- A point move is accepted only if the worst face around it gets no worse and no cell is turned inside out (see [how it works](how-it-works.md)). Corners, sharp edges and patch junctions never move, so the geometry stays the same.
- The final `checkMesh` is compared with the first one. Any number that got worse is listed under `regressions` in the verdict, on the command line and on the page.
- The face-collapse step is rolled back if `checkMesh` shows any regression.
- The experimental tools have their own rules, listed in [limits](limits.md).

## The dashboard answers only you

- It listens on **127.0.0.1 only**, so other computers on the network cannot reach it. On Windows, WSL forwards the port to Windows' own localhost only. Remote use goes through an SSH tunnel.
- It **checks the Host and Origin headers** of every request, so a web page on another site that you happen to open cannot read it or start jobs. This blocks cross-site requests and DNS-rebinding attacks.
- **A token for every launch.** Starting or stopping a job needs a random token that the server creates at start-up and puts only in its own pages. Requests without it are refused.
- **The web app needs its address and a key.** The web app is a static site that runs in your browser and talks to the engine on this computer directly; your cases and results never go to the site's host. The engine answers it only when the request comes from an address in the `app_origins` setting **and** carries the pairing key, on every request, reads included (there the key takes the launch token's place). `meshdoctor pair` keeps the key in `~/.config/meshdoctor/app.key`, readable by you only, and prints the pairing link. The link carries the key after `#`, the part of a link a browser never sends to the site, but it is still a password: don't post it or show it in a screenshot. `meshdoctor pair --new` makes a new key, which unpairs every browser once you restart `meshdoctor serve`; until then the running engine still accepts the old key.
- **The site can reach only itself and this computer.** Its Content-Security-Policy allows connections to its own address and to `localhost` / `127.0.0.1` only, it loads no outside scripts or fonts, and it has no accounts or analytics. It keeps four things in your browser: the pairing, the colour theme, whether you've seen the app's tour and whether the sidebar's Coming next list is open.
- **Fixed pages only.** It serves its four pages and a JSON API, never arbitrary files. The API reads only inside the workspace and the cases folder, by plain names.
- **No shell injection.** Jobs are started with fixed command templates; the only user-supplied parts are plain names and numbers.
- **One big job at a time.** A new repair, A/B test, new case or solve is refused while an OpenFOAM solver or mesher is running.
- **Memory check.** A job that would not fit in free memory is refused before it starts (`--no-ram-check` overrides it on the command line).
- `serve --container` (all interfaces) refuses to run outside a Docker or Podman container. The image itself publishes the port on 127.0.0.1 only when started as the README shows.
- Native Windows Python refuses to run anything. Run it in WSL.

**Shared machines:** any user logged in to the same computer can connect to a 127.0.0.1 port. On a cluster login node or a shared lab PC, they could open your dashboard. There, use the command line (results land in your workspace, which is private), or run `serve` only on your own computer.

## Your results are private

- The workspace is created readable by you only (mode 700). If an existing workspace is open to others, `serve` and `meshdoctor check` warn you; fix it with `chmod 700 <workspace>`.
- The Docker image runs as a normal user, mounts your cases read-only, and writes only to `/work`.
- The Slurm templates bind the source case read-only into the container, and require `MESHDOCTOR_WORKSPACE` to be set.

## Keeping data out of this repository

The repository must never hold simulation data, CAD, spreadsheets, personal paths or team names. `tools/data_guard.py` checks for them:
- the `pre-commit` hook checks every staged file;
- the `pre-push` hook checks the whole history;
- CI checks both on every push, with the private word list supplied as a repository secret.

The only example case is OpenFOAM's own motorBike tutorial, and the documentation's screenshots come from it.

## Reporting a problem

If you find a way around one of these rules, tell the maintainers privately (not in a public issue), with the steps to reproduce it.
