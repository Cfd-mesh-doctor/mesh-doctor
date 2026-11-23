// SPDX-License-Identifier: GPL-3.0-or-later
// The New case dialog's checks: the name the case gets, suggested from the template and its size and kept clear of
// the engine's cases and of earlier new cases, and the command that makes the same case in a terminal.
import { isPlainName } from "@/engine/commands";
import { isActive, type Job, type Template } from "@/engine/types";

/** For an engine from before API 1.5, which has no templates to make cases from. */
export const OLD_ENGINE_CASES = "Your engine is older than this page and can't make cases from templates yet. Update "
  + "Mesh Doctor (`git pull` in its folder) and restart the engine.";

/** The terminal command that makes the same case: `meshdoctor new`, with the size when it isn't the template's own. */
export function newCaseCommand(template: Template, size: string, name: string): string {
  return `meshdoctor new ${template.name} ${name}${size === template.size ? "" : ` --size ${size}`}`;
}

/** Names a new case can't take without a word: every case's, and every earlier new case's (the engine lists a new case
 * only once its mesh is made, so one being made or that stopped is known here by its job). */
export function takenCaseNames(cases: readonly string[] | undefined, jobs: readonly Job[] | undefined): Set<string> {
  return new Set([...(cases ?? []), ...(jobs ?? []).filter((j) => j.kind === "case").map((j) => j.name)]);
}

/** A free name for a template's case: the template's first word and the size ("ahmed-coarse"), or its whole name when
 * it has one size ("wheel-wing"), then -2, -3… while that is taken. */
export function suggestName(template: Template, size: string, taken: ReadonlySet<string>): string {
  const base = template.sizes.length > 1 ? `${template.name.split("-")[0]}-${size}` : template.name;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** A new case's steps, as the engine names them (meshdoctor/jobs.py), in plain words with the program at work. */
const CASE_STEPS: Record<string, string> = {
  copying: "Copying the template",
  geometry: "Making the geometry",
  surfaceFeatures: "Finding the shape's edges (surfaceFeatures)",
  blockMesh: "Making the background mesh (blockMesh)",
  "snappyHexMesh: refining": "Refining the mesh around the shape (snappyHexMesh)",
  "snappyHexMesh: snapping": "Snapping the mesh to the shape (snappyHexMesh)",
  "snappyHexMesh: adding layers": "Adding layers at the walls (snappyHexMesh)",
  checkMesh: "Checking the mesh (checkMesh)",
  done: "Done",
};

/** A new case job's step in plain words; one this app doesn't know reads as the engine says it. */
export function caseStep(step: string | null | undefined): string | null {
  return step ? (CASE_STEPS[step] ?? step) : null;
}

export interface CaseNameCheck {
  /** what's wrong with the name, or null when the engine will take it */
  problem: string | null;
  /** an earlier new case of this name that stopped before its mesh was made: making it again replaces what it left */
  again: Job | null;
}

/** Whether a new case can have this name. The engine makes again only a case it made itself, and the app asks it to
 * only for a new case that failed or was cancelled, never for a case that has its mesh. */
export function checkCaseName(name: string, cases: readonly string[], jobs: readonly Job[]): CaseNameCheck {
  const no = (problem: string): CaseNameCheck => ({ problem, again: null });
  if (!name) return no("Give the new case a name.");
  if (!isPlainName(name)) return no("Use only letters, digits and _ . - (not . or - first), at most 80 characters.");
  if (cases.includes(name)) return no("A case with this name exists already. Pick another name.");
  const last = jobs.find((j) => j.kind === "case" && j.name === name);          // the engine lists the newest first
  if (last && isActive(last.state)) return no("A new case with this name is being made now. Pick another name.");
  if (last && (last.state === "failed" || last.state === "cancelled")) return { problem: null, again: last };
  return { problem: null, again: null };
}
