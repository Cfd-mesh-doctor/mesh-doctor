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
    about: "Each step and the command behind it: the repair, which looks only at the mesh, the checks that it helped, a solved case's results and pictures of its flow." },
  { title: "Accuracy check", page: "/accuracy", file: "validation.md",
    about: "The Ahmed body, run through the same chain you would use for a car, against its wind-tunnel measurements." },
  { title: "Gallery", page: "/gallery", file: "gallery.md",
    about: "What the toolkit's scripts make for the worked Ahmed-body example, each picture with the script that made it." },
  { title: "Install", page: "/install",
    about: "Setting it up on your own computer: Linux, or WSL on Windows, with OpenFOAM 14 and Python. From the README." },
  { title: "Dashboard tour", page: "/dashboard-tour", file: "dashboard.md",
    about: "The engine's own dashboard (meshdoctor serve), page by page, with screenshots." },
  { title: "Your own case", page: "/your-own-case", file: "templates.md",
    about: "Copy the tested Ahmed-body case and change its geometry, domain and flow conditions to make your own." },
  { title: "Claude Code", page: "/claude-code", file: "claude.md",
    about: "The repository is also a Claude Code plugin, cfd-toolkit: how to install it, its skills and its slash commands." },
  { title: "Troubleshooting", page: "/troubleshooting", file: "troubleshooting.md",
    about: "Problems people actually hit, with the fix. Search it for the message you see." },
  { title: "Limits", page: "/limits", file: "limits.md",
    about: "What Mesh Doctor is not, the versions it runs on, and where the repair, the A/B test, the map and the dashboard stop." },
  { title: "Safety model", page: "/safety", file: "safety.md",
    about: "Why it can't damage a case you care about, and why its dashboard isn't a way into your computer." },
  { title: "Architecture", page: "/architecture", file: "architecture.md",
    about: "Where the code is, where it is going and why: the engine, its versioned results and API, and this site." },
  { title: "Report viewer", page: "/report",
    about: "Open a report to see what a repair changed in the mesh and whether it helped the solver. Never uploaded." },
  { title: "Size estimator", page: "/estimate",
    about: "Whether a case fits in your computer's memory, how long it takes to solve and what a cloud machine would cost." },
];

/** Read on GitHub: the docs this site has no page for yet (none now). Each title is the doc's own heading. */
export const ON_GITHUB: DocEntry[] = [];

export const githubDoc = (file: string) => `${REPO_URL}/blob/main/docs/${file}`;

/** What the Docs page says about the page at this address: the page's description for search results too. */
export const aboutPage = (page: string) => ON_SITE.find((d) => d.page === page)?.about;

/** Where a doc's link to another doc ("safety.md", "safety.md#section") opens: this site's page for that doc when there
 *  is one, otherwise the doc on GitHub. A web address stays as it is. */
export function docHref(target: string): string {
  if (/^https?:/.test(target)) return target;
  const [file = "", section] = target.split("#");
  const page = ON_SITE.find((d) => d.file === file)?.page;
  return (page ?? githubDoc(file)) + (section ? `#${section}` : "");
}
