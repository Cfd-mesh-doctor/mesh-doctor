// SPDX-License-Identifier: GPL-3.0-or-later
// Where each piece of the documentation is read. entries.test.ts keeps this equal to the repository's docs/
// folder, so a new doc can't be left off the Docs page.
import { REPO_URL } from "@/lib/site";

export interface DocEntry {
  title: string;
  about: string;
  /** the doc in the repository's docs/ folder, when there is one */
  file?: string;
  /** this site's page for it, when there is one; otherwise it's read on GitHub */
  page?: string;
}

/** Read here: pages of this site, each kept equal to the doc or README section it comes from by that page's own test. */
export const ON_SITE: DocEntry[] = [
  { title: "How it works", page: "/how-it-works", file: "how-it-works.md",
    about: "Each step and the command behind it: the repair, which looks only at the mesh, then the checks that it helped." },
  { title: "Accuracy check", page: "/accuracy", file: "validation.md",
    about: "The Ahmed body, run through the same chain you would use for a car, against its wind-tunnel measurements." },
  { title: "Gallery", page: "/gallery", file: "gallery.md",
    about: "What the toolkit's scripts make for the worked Ahmed-body example, each picture with the script that made it." },
  { title: "Install", page: "/install",
    about: "Setting it up on your own computer: Linux, or WSL on Windows, with OpenFOAM 14 and Python. From the README." },
  { title: "Troubleshooting", page: "/troubleshooting", file: "troubleshooting.md",
    about: "Problems people actually hit, with the fix. Search it for the message you see." },
  { title: "Report viewer", page: "/report",
    about: "Open a report to see what a repair changed in the mesh and whether it helped the solver. Never uploaded." },
  { title: "Size estimator", page: "/estimate",
    about: "Whether a case fits in your computer's memory, how long it takes to solve and what a cloud machine would cost." },
];

/** Read on GitHub: the docs this site has no page for yet. Each title is the doc's own heading. */
export const ON_GITHUB: DocEntry[] = [
  { title: "Limits", file: "limits.md",
    about: "What Mesh Doctor is not, the versions it runs on, and where the repair, the A/B test, the map and the dashboard stop." },
  { title: "Safety model", file: "safety.md",
    about: "Why it can't damage a case you care about, and why its dashboard isn't a way into your computer." },
  { title: "Starting your own case from the Ahmed example", file: "templates.md",
    about: "Copy the tested Ahmed-body case and change its geometry, domain and flow conditions to make your own." },
  { title: "Dashboard tour", file: "dashboard.md",
    about: "The engine's own dashboard (meshdoctor serve), page by page, with screenshots." },
  { title: "Architecture", file: "architecture.md",
    about: "Where the code is, where it is going and why: the engine, its versioned results and API, and this site." },
  { title: "Using this repository with Claude Code", file: "claude.md",
    about: "The repository is also a Claude Code plugin, cfd-toolkit: how to install it, its skills and its slash commands." },
];

export const githubDoc = (file: string) => `${REPO_URL}/blob/main/docs/${file}`;
