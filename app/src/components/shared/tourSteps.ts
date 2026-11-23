// SPDX-License-Identifier: GPL-3.0-or-later
// The app tour's steps, in plain words: where things are and what each screen tells you. No imports, so the browser
// tests (e2e/) can load it too.

/** Kept in this browser once a tour has been open (the demo's or your own app's) or turned down, so the demo opens its
 * tour by itself, and your own app offers its tour, only the first time. */
export const TOUR_SEEN = "md-tour-seen";

export interface TourStep {
  title: string;
  text: string;
  /** The screen the step opens, under the app's own address (/demo or /app); a step without one stays where it is. */
  page?: string;
  /** The part of that screen the step rings: the element with this `data-tour`. */
  spot?: string;
}

/** The demo's tour. */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    title: "Welcome to Mesh Doctor",
    text: "This demo replays a real run of the public Ahmed-body example. Nothing here runs, so click anything you like. The tour opens each screen in turn and takes about a minute.",
  },
  {
    title: "Overview: the whole picture",
    text: "The tiles at the top show the engine, your source cases, your repair runs with how many of them improved the mesh, and the jobs running now. Below them are the latest jobs and repair runs.",
    page: "",
    spot: "tiles",
  },
  {
    title: "Cases: the meshes you start from",
    text: "Cases lists the OpenFOAM cases the engine found, with each one's size and the verdict of its latest repair. Mesh Doctor only ever reads a case: every repair works on a copy. To repair one, copy its repair command and run it in WSL.",
    page: "/cases",
    spot: "cases",
  },
  {
    title: "Jobs: what is running",
    text: "Every repair runs as a job, and Jobs shows its progress live. Cancel stops a job that is running; Report opens one that has finished.",
    page: "/jobs",
    spot: "jobs",
  },
  {
    title: "Reports: did the repair help?",
    text: "A report opens with its verdict. Below it are the checkMesh numbers before and after the repair, and where the mesh was repaired. When the repaired mesh was also run in the solver, it says whether the solver did better; if not, your own engine's report gives the command for that test.",
    // A repair that made the mesh better, so its report has something to show: the numbers it improved, and where.
    page: "/repairs/ahmed35-medium-fix/report",
    spot: "verdict",
  },
];

/** Your own app's tour: its own welcome, and a report step that opens the report of `report`, your latest finished
 * repair, or stays on Jobs, where reports open, before one has finished. */
export function engineTourSteps(report: string | null): readonly TourStep[] {
  const [, overview, cases, jobs, reports] = TOUR_STEPS as readonly [TourStep, TourStep, TourStep, TourStep, TourStep];
  return [
    {
      title: "Welcome to Mesh Doctor",
      text: "This browser is paired with the Mesh Doctor engine on your computer, so these screens show your own cases, repair runs and jobs, read from the engine. Your meshes stay on your computer. The tour opens each screen in turn and takes about a minute.",
    },
    overview,
    cases,
    jobs,
    report === null
      ? {
          title: reports.title,
          text: "No repair has finished yet. When one has, Report on the Jobs screen opens its report: the verdict first, then the checkMesh numbers before and after the repair, and where the mesh was repaired.",
        }
      : { ...reports, page: `/repairs/${encodeURIComponent(report)}/report` },
  ];
}
