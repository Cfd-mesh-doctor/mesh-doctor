// SPDX-License-Identifier: GPL-3.0-or-later
// The app tour's steps, in plain words: where things are and what each screen tells you.
export const TOUR_STEPS: readonly { title: string; text: string }[] = [
  {
    title: "Welcome to Mesh Doctor",
    text: "This demo replays a real run of the public Ahmed-body example. Nothing here runs, so click anything you like. The tour takes about a minute.",
  },
  {
    title: "Overview: the whole picture",
    text: "The tiles at the top show the engine, your source cases, your repair runs with how many of them improved the mesh, and the jobs running now. Below them are the latest jobs and repair runs.",
  },
  {
    title: "Cases: the meshes you start from",
    text: "Cases lists the OpenFOAM cases the engine found, with each one's size and the verdict of its latest repair. Mesh Doctor only ever reads a case: every repair works on a copy.",
  },
  {
    title: "Jobs: what is running",
    text: "Every repair runs as a job, and Jobs shows its progress live. Cancel stops a job that is running; Report opens one that has finished.",
  },
  {
    title: "Reports: did the repair help?",
    text: "A report opens with its verdict. Below it are the checkMesh numbers before and after the repair, and where the mesh was repaired. When the repaired mesh was also run in the solver, it says whether the solver did better.",
  },
];
