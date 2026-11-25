// SPDX-License-Identifier: GPL-3.0-or-later
// The Pictures screen's words and checks: the kinds a set has, a set's name, address and title, the set a picture job
// makes, the written times of a run that can be pictured (the split ones too, on an engine that joins one first), and
// whether a picture job fits in the memory of the engine's computer.
import { isActive, type Job, type MachineInfo, type PictureKind, type PictureSetBrief, type Run } from "@/engine/types";
import { machineFields } from "@/estimate/machine";
import type { MemoryCheck } from "./repairStart";
import { timeInput } from "./solveStart";

/** The kinds of picture a set can have, in the engine's order, with what each one shows. */
export const KINDS: readonly { value: PictureKind; label: string; about: string }[] = [
  {
    value: "cuts",
    label: "Cuts",
    about: "Plane cuts through the flow, coloured by speed and pressure: from the case's cut list (cuts.json), else "
      + "three made from the model's size.",
  },
  {
    value: "vortices",
    label: "Vortices",
    about: "The vortices as Q-criterion surfaces at three levels, seen from behind, above and the side, coloured by "
      + "which way they turn.",
  },
  {
    value: "spots",
    label: "Spots",
    about: "The worst spot of unphysical pressure on the walls (Cp below -5: a numerical error), from three views; "
      + "nothing when there is none.",
  },
];

/** A cut over time (API 1.20): a set made with it has the first cut's speed at each written time, oldest first. */
const OVER_TIME = {
  value: "times",
  label: "Over time",
  about: "The first cut's speed at each written time up to the one pictured, oldest first: the flow as it changes.",
} as const;

/** What a kind of picture is, as a set's page heads it: those the dialog offers, and a cut over time. */
export function kindInfo(kind: PictureKind | undefined): { value: PictureKind; label: string; about: string } | undefined {
  return [...KINDS, OVER_TIME].find((k) => k.value === kind);
}

const KIND_WORD: Record<PictureKind, string> = {
  cuts: "cuts", vortices: "vortices", spots: "spots", times: "a cut over time",
};

/** The kinds in words: "cuts, vortices and spots". */
export function kindsText(kinds: readonly PictureKind[]): string {
  const words = kinds.map((k) => KIND_WORD[k] ?? k);
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** A set's name: the written time it pictures, `<time>_mean` for a transient run's mean flow (the engine's set_name). */
export const setName = (time: string, mean: boolean) => `${time}${mean ? "_mean" : ""}`;

/** What a set's name says it pictures: its written time, and whether of its mean flow. */
export function parseSet(set: string): { time: string; mean: boolean } {
  const mean = set.endsWith("_mean");
  return { time: mean ? set.slice(0, -"_mean".length) : set, mean };
}

/** Where a set shows in the app, below its base (/app or /demo). */
export const setPath = (name: string, set: string) => `/pictures/${encodeURIComponent(name)}/${encodeURIComponent(set)}`;

/** What a set pictures: "written time 2000", or "the mean flow to 0.0006 s". */
export function setTitle(s: { time: string; mean: boolean }): string {
  return s.mean ? `the mean flow to ${s.time} s` : `written time ${s.time}`;
}

/** The same, as a heading: "Written time 2000". */
export function setHeading(s: { time: string; mean: boolean }): string {
  const t = setTitle(s);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** A picture's file when saved: its case, its set and its file in the set ("ahmed_2000_cuts_c1_side_centre_U.png"). */
export const pictureFileName = (name: string, set: string, file: string) => `${name}_${set}_${file.replace(/\//g, "_")}`;

/** The set a picture job makes, once it says its time (the engine fills in the latest when it starts): its case and
 * its name. Null for another kind of job. */
export function setOfJob(job: Pick<Job, "kind" | "params">): { name: string; set: string } | null {
  if (job.kind !== "pictures") return null;
  const { name, time, mean } = job.params as { name?: unknown; time?: unknown; mean?: unknown };
  if (typeof name !== "string" || typeof time !== "string" || !time) return null;
  return { name, set: setName(time, mean === true) };
}

/** The newest picture job of set `set` of case `name` (GET /jobs lists the newest first), if any. */
export function jobOfSet(jobs: readonly Job[] | undefined, name: string, set: string): Job | undefined {
  return jobs?.find((j) => {
    const s = setOfJob(j);
    return s !== null && s.name === name && s.set === set;
  });
}

/** Whether a picture job waits or runs: of case `name`, or of any case. */
export function makingPictures(jobs: readonly Job[] | undefined, name?: string): boolean {
  return jobs?.some((j) => j.kind === "pictures" && isActive(j.state) && (name === undefined || j.name === name)) ?? false;
}

/** A set's state as the screens show it: being made (its job waits or runs), made, or, with no set made, how its job
 * ended. */
export type SetShown = "making" | "made" | "failed" | "cancelled";

export function setShown(s: Pick<PictureSetBrief, "made" | "job">): SetShown {
  if (s.job && (s.job.state === "queued" || s.job.state === "running")) return "making";
  if (s.made) return "made";
  return s.job?.state === "cancelled" ? "cancelled" : "failed";
}

/** A written time as its folder names it, from GET /runs' number: to 6 significant digits, as OpenFOAM writes its
 * times (2000, 0.0006). */
export const timeName = (t: number) => timeInput(t);

/** Does the engine picture a written time still split onto a run's processes (API 1.19), joining it first into the
 * run's own folder? An older one pictures a joined time only. */
export function joinsTimes(apiVersion: string | null | undefined): boolean {
  const m = /^(\d+)\.(\d+)/.exec(apiVersion ?? "");
  return m != null && (Number(m[1]) > 1 || (Number(m[1]) === 1 && Number(m[2]) >= 19));
}

/**
 * The written times of a run that a picture job can picture, newest first, as their folders name them: each one it
 * keeps, with `split` (an engine that joins a split time first, joinsTimes()), else the joined ones only, on the whole
 * mesh (on several processes, the latest of each stretch). With `mean`, those a transient run wrote with its mean
 * flow: after the time its averaging started from, up to the latest written with it. Empty for a run that has none
 * yet.
 */
export function pictureTimes(run: Pick<Run, "times" | "joined" | "averaging">, mean: boolean, split = false): string[] {
  const av = run.averaging;
  const from = av?.from;
  const last = av?.written;
  const ok = (t: number) => !mean || (from != null && last != null && t > from && t <= last);
  return [...((split ? run.times ?? run.joined : run.joined) ?? [])].filter(ok).sort((a, b) => b - a).map(timeName);
}

/** The written times a run keeps still split onto its processes, not joined, as their folders name them. */
export function splitTimes(run: Pick<Run, "times" | "joined">): Set<string> {
  const joined = new Set((run.joined ?? []).map(timeName));
  return new Set((run.times ?? []).map(timeName).filter((t) => !joined.has(t)));
}

/** Whether a run has its mean flow to picture: a transient run that has written a time with it. */
export const hasMeanFlow = (run: Pick<Run, "averaging"> | undefined) => run?.averaging?.written != null;

/** The memory a picture job takes, as the engine's RAM guard counts it: ParaView reading the case with its cell data
 * made point data, 0.6 KB a cell (18 GB at 31 million cells, 7 GB at 12 million), and 0.5 GB to spare. */
const KB_PER_CELL = 0.6;
const HEADROOM_GB = 0.5;

/** Whether a picture job of a case of `cells` cells fits in the memory of the engine's computer, as the repair
 * dialog's check: under 90 % of it. Null when either isn't known (the engine still checks its free memory when the
 * job starts). */
export function picturesMemory(cells: number | null | undefined, machine: MachineInfo | undefined): MemoryCheck | null {
  if (cells == null || !(cells > 0) || !machine) return null;
  const { ram, limited } = machineFields(machine);
  if (ram === undefined) return null;
  const need = Math.round(((cells * KB_PER_CELL) / 1024 / 1024 + HEADROOM_GB) * 10) / 10;
  return { need, have: ram, limited: limited === true, fits: need < 0.9 * ram };
}
