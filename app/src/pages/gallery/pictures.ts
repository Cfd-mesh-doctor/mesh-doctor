// SPDX-License-Identifier: GPL-3.0-or-later
// The gallery's sections and pictures, as docs/gallery.md lists them. The pictures are docs/images itself (the data
// guard allows pictures nowhere else); pictures.test.ts keeps the captions and sections equal to the doc's.
import forces from "../../../../docs/images/ahmed_forces_total.png";
import qRear from "../../../../docs/images/ahmed_Q20000_rear34.png";
import qSide from "../../../../docs/images/ahmed_Q70000_side.png";
import residuals from "../../../../docs/images/ahmed_residuals.png";
import cutCpt from "../../../../docs/images/ahmed_c1_side_centre_Cpt.png";
import cutU from "../../../../docs/images/ahmed_c1_side_centre_U.png";
import wakeCpt from "../../../../docs/images/ahmed_c3_cross_wake_Cpt.png";
import dashboard from "../../../../docs/images/meshdoctor.png";

export interface Picture {
  /** the file name in docs/images */
  file: string;
  src: string;
  /** the doc's caption */
  alt: string;
  width: number;
  height: number;
}

export interface GallerySection {
  id: string;
  title: string;
  /** what made the pictures */
  tool: string;
  text: string;
  pictures: Picture[];
}

const still = (file: string, src: string, alt: string): Picture => ({ file, src, alt, width: 1280, height: 720 });

export const GALLERY: GallerySection[] = [
  {
    id: "vortices",
    title: "Vortices",
    tool: "vortex_views.py",
    text: "Q-criterion iso-surfaces coloured by the streamwise vorticity (red clockwise seen from behind, blue anticlockwise).",
    pictures: [
      still("ahmed_Q20000_rear34.png", qRear, "Rear three-quarter view, Q = 20,000"),
      still("ahmed_Q70000_side.png", qSide, "Side view, Q = 70,000"),
    ],
  },
  {
    id: "cuts",
    title: "Cut planes",
    tool: "cut_views.py",
    text: "Planes from a JSON list (examples/ahmed-body/cuts.json), coloured by speed, Cp or total-pressure " +
      "coefficient Cp,t (1 = no losses, so dark areas are wakes and vortex cores).",
    pictures: [
      still("ahmed_c1_side_centre_U.png", cutU, "Speed on the centreline"),
      still("ahmed_c1_side_centre_Cpt.png", cutCpt, "Total pressure on the centreline"),
      still("ahmed_c3_cross_wake_Cpt.png", wakeCpt, "Cross cut 0.2 m behind the base"),
    ],
  },
  {
    id: "charts",
    title: "Convergence charts",
    tool: "plot_convergence.py",
    text: "Forces with the averaging window shaded, residuals on a log scale, and a summary table with the window " +
      "means and the drift between windows.",
    pictures: [
      still("ahmed_forces_total.png", forces, "Total drag and downforce (negative: the Ahmed body makes lift)"),
      still("ahmed_residuals.png", residuals, "Residuals"),
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard",
    tool: "meshdoctor serve",
    text: "Live progress of a running case, Mesh Doctor repairs and the repair map.",
    pictures: [{ file: "meshdoctor.png", src: dashboard, alt: "Mesh Doctor page", width: 1400, height: 520 }],
  },
];
