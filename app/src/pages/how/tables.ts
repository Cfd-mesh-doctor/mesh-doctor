// SPDX-License-Identifier: GPL-3.0-or-later
// The tables of the "How it works" page, written exactly as docs/how-it-works.md writes them (`code` in
// backticks). tables.test.ts compares them with the doc, so when the engine's targets or verdicts change
// there, the test asks for this page to change too.
import type { DocTable } from "@/lib/docTable";

/** What each command needs and gives. */
export const COMMANDS: DocTable = {
  head: ["Command", "Needs", "Gives"],
  rows: [
    ["`inspect`, `fix`, `full`", "a mesh (`constant/polyMesh`, serial or decomposed)", "bad faces found, highlighted and corrected on a copy"],
    ["`ab`", "a case that runs (`0/`, `constant/`, `system/`) and a repaired copy from `full`", "both meshes solved, residuals, forces and hotspots compared"],
    ["`judge`", "a run's log or residuals, and its forces", "a convergence verdict"],
    ["`ab hotspots`, `ab mode`", "a solved case with written times", "where the residuals, or a slow oscillation, are largest"],
    ["`map`", "a `full` run, plus optional hotspot layers", "repairs drawn over hotspots, side and top views"],
    ["`serve`", "any of the above", "the dashboard pages"],
  ],
};

/** The quality targets a face must meet, per profile. */
export const PROFILES: DocTable = {
  head: ["Profile", "Non-ortho", "Skew", "Boundary skew", "Min weight", "Min volume ratio"],
  rows: [
    ["`openfoam` (default)", "65°", "4", "4", "0.05", "0.01"],
    ["`strict`", "60°", "3", "4", "0.1", "0.05"],
  ],
};

/** The convergence judge's verdicts for a steady run. */
export const VERDICTS: DocTable = {
  head: ["Verdict", "Means"],
  rows: [
    ["converged", "p residual below 1e-4, forces drift and oscillate less than 0.5 %"],
    ["statistically steady", "forces stationary (drift < 1 %, oscillation < 2 %) but residuals not low: use the window means"],
    ["still converging", "the p residual is still falling (by more than 10 % between windows)"],
    ["not converged", "residuals flat and forces still moving: a plateau or a slow oscillation"],
  ],
};
