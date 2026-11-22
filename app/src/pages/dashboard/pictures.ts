// SPDX-License-Identifier: GPL-3.0-or-later
// The Dashboard tour's pictures, by the path the doc writes: docs/images itself (the data guard allows pictures nowhere
// else), each with its size in pixels. tour.test.ts checks both against the doc and the files.
import type { DocPictures } from "@/lib/docSections";
import ab from "../../../../docs/images/ab.png";
import cluster from "../../../../docs/images/cluster.png";
import meshdoctor from "../../../../docs/images/meshdoctor.png";
import meshmap from "../../../../docs/images/meshmap.png";
import run from "../../../../docs/images/run.png";

export const PICTURES: DocPictures = {
  "images/meshdoctor.png": { src: meshdoctor, width: 1400, height: 520 },
  "images/cluster.png": { src: cluster, width: 1032, height: 560 },
  "images/ab.png": { src: ab, width: 1032, height: 1180 },
  "images/meshmap.png": { src: meshmap, width: 1400, height: 1000 },
  "images/run.png": { src: run, width: 1400, height: 1300 },
};
