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
    text: "Cases lists the OpenFOAM cases the engine found, with each one's size and the verdict of its latest repair. Mesh Doctor only ever reads a case: every repair works on a copy. To repair one, press Repair under its name, or copy its repair command and run it in a WSL or Linux terminal.",
    page: "/cases",
    spot: "cases",
  },
  {
    title: "Solve: run a case in OpenFOAM",
    text: "Solve runs OpenFOAM on the engine's computer, and first checks that the computer has everything a solve needs. New case makes a ready-made case from a template, such as the Ahmed body, and meshes it; Solve under Runs then solves it, or a copy of a case you made. A run's page draws its residuals and forces as it solves and says whether it has converged. For a first run step by step, open Try it on the Ahmed body, at the foot of the menu.",
    page: "/solve",
    spot: "new-case",
  },
  {
    title: "Repairs: every repair run",
    text: "Repairs lists every repair run, newest first, with its verdict: whether the repair made the mesh better. Each finished run opens its report, and New repair starts another, always on a copy of the case.",
    page: "/repairs",
    spot: "repairs",
  },
  {
    title: "A/B tests: does the solver do better?",
    text: "An A/B test solves a case twice, on the original mesh and on the repaired one, and compares how well each run converges. Start one here or from a finished repair's report; each test's page follows it while it runs.",
    page: "/abtests",
    spot: "abtests",
  },
  {
    title: "Jobs: what is running",
    text: "Repairs, A/B tests, new cases, solves, transient plans and pictures run as jobs, whether started here or from the engine's dashboard, and Jobs shows their progress live. Cancel stops a job that is running; a job's link opens what it makes: a repair's report, an A/B test, a new case, a solve's run, a transient plan or a set of pictures. A repair run in a terminal shows on the Overview instead.",
    page: "/jobs",
    spot: "jobs",
  },
  {
    title: "Reports: did the repair help?",
    text: "A report opens with its verdict. Below it are the checkMesh numbers before and after the repair, and where the mesh was repaired. When the repaired mesh was also run in the solver, it says whether the solver did better; if not, your own engine's report offers to start that test.",
    // A repair that made the mesh better, so its report has something to show: the numbers it improved, and where.
    page: "/repairs/ahmed35-medium-fix/report",
    spot: "verdict",
  },
];

/** Your own app's Overview step while the engine lists no repair run: the Overview then opens with Getting started,
 * the steps to a first one, which the step rings. */
export const FIRST_STEPS_TOUR_STEP: TourStep = {
  title: "Overview: where to start",
  // Short, so the tour's box stays low enough for Getting started to show above it on a laptop's screen.
  text: "Until your first repair, the Overview opens with Getting started: the three steps to one, each ticked off once the engine lists it. The step marked Next is the one to do now.",
  page: "",
  spot: "start",
};

/** Your own app's tour: its own welcome, and a report step that opens the report of `report`, your latest finished
 * repair, or stays on Jobs, where a job's report opens, before one has finished. With `noRuns` (the engine lists no repair run
 * yet), its Overview step is about Getting started, which the Overview opens with until then. */
export function engineTourSteps(report: string | null, noRuns = false): readonly TourStep[] {
  const [, overview, cases, solve, repairs, abtests, jobs, reports] =
    TOUR_STEPS as readonly [TourStep, TourStep, TourStep, TourStep, TourStep, TourStep, TourStep, TourStep];
  return [
    {
      title: "Welcome to Mesh Doctor",
      text: "This browser is paired with the Mesh Doctor engine on your computer, so these screens show your own cases, solves, repair runs, A/B tests and jobs, read from the engine. Your meshes stay on your computer. The tour opens each screen in turn and takes about a minute.",
    },
    noRuns ? FIRST_STEPS_TOUR_STEP : overview,
    cases,
    solve,
    repairs,
    abtests,
    jobs,
    report === null
      ? {
          title: reports.title,
          text: "No repair has finished yet. When one has, Report beside it on the Overview, or beside its job here, opens its report: the verdict first, then the checkMesh numbers before and after the repair, and where the mesh was repaired.",
        }
      : { ...reports, page: `/repairs/${encodeURIComponent(report)}/report` },
  ];
}
