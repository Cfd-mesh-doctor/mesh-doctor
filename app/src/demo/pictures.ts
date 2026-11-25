// SPDX-License-Identifier: GPL-3.0-or-later
// The demo's set of pictures (GET /pictures, API 1.17), which the recording's engine predates: the gallery's pictures
// of the Ahmed body (docs/images, already in the app's bundle), the 25° slant on its medium mesh at its 2,000
// iterations, as a picture job would list them. The scripts made them 1920 × 1080; the docs' copies are 1280 × 720.
import { EngineError } from "@/engine/errors";
import type { PictureSet, PictureSetBrief } from "@/engine/types";
import { GALLERY } from "@/pages/gallery/pictures";

/** Each picture of the set, by its file in the set, and its file in docs/images. Titled as the engine titles them:
 * a cut from the Ahmed body's cut list (examples/ahmed-body/cuts.json) and its colour, a vortex picture from its Q
 * level and its view. */
const FILES: readonly { file: string; docs: string; title: string }[] = [
  {
    file: "cuts/c1_side_centre_Cpt.png", docs: "ahmed_c1_side_centre_Cpt.png",
    title: "Side cut on the centreline, seen from the side (+y), nose to the left: total pressure coefficient Cp,t",
  },
  {
    file: "cuts/c1_side_centre_U.png", docs: "ahmed_c1_side_centre_U.png",
    title: "Side cut on the centreline, seen from the side (+y), nose to the left: speed",
  },
  {
    file: "cuts/c3_cross_wake_Cpt.png", docs: "ahmed_c3_cross_wake_Cpt.png",
    title: "Cross cut 0.2 m behind the base, seen from behind: the slant-edge vortex: total pressure coefficient Cp,t",
  },
  { file: "vortices/Q20000_rear34.png", docs: "ahmed_Q20000_rear34.png", title: "Vortices, Q = 20,000 1/s², from behind" },
  { file: "vortices/Q70000_side.png", docs: "ahmed_Q70000_side.png", title: "Vortices, Q = 70,000 1/s², from the side" },
];

/** Where the bundle has each docs picture. */
const SRC = new Map(GALLERY.flatMap((s) => s.pictures).map((p) => [p.file, p.src]));

/** The demo's set, made `made` (UTC). */
export function demoPictureSet(made: string): PictureSet {
  return {
    case: "ahmed-25-medium", set: "2000", time: "2000", mean: false, kinds: ["cuts", "vortices"], made,
    notes: ["The demo's set is the gallery's: five of the pictures the scripts made of this case, at 1280 × 720 as in "
      + "the docs (a picture job makes them 1920 × 1080), and no spots."],
    pictures: FILES.map(({ file, title }) => ({ file, kind: file.startsWith("cuts/") ? "cuts" : "vortices", title })),
  };
}

/** A set as GET /pictures lists it: made in a terminal, so with no job. */
export function briefOfSet(s: PictureSet): PictureSetBrief {
  return { case: s.case, set: s.set, time: s.time, mean: s.mean, kinds: s.kinds, made: s.made, count: s.pictures.length,
    job: null };
}

/** The bundle's picture for one of the set's files, or not-found as the engine answers for a file its set doesn't
 * list. */
export function demoPictureSrc(file: string): string {
  const docs = FILES.find((f) => f.file === file)?.docs;
  const src = docs ? SRC.get(docs) : undefined;
  if (!src) throw new EngineError("not-found", `the demo's set lists no picture ${file}`, 404);
  return src;
}
