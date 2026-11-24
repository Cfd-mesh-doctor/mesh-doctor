// SPDX-License-Identifier: GPL-3.0-or-later
// The accuracy check's results and how to run it, written exactly as docs/validation.md writes them.
// results.test.ts compares them with the doc, so a new validation run there asks for this page to change too.
import { column, type DocTable } from "@/lib/docTable";

/** The Ahmed body against the wind tunnel (docs/validation.md, "Results"). */
export const RESULTS: DocTable = {
  head: ["Case", "Slant", "Cells", "Cd", "Drift", "Cl", "Wind tunnel Cd", "Difference", "Solve time"],
  rows: [
    ["coarse", "25 deg", "0.48 M", "0.299", "-0.11 %", "0.298", "0.285", "+4.8 %", "14 min"],
    ["medium", "25 deg", "0.84 M", "0.280", "-0.02 %", "0.295", "0.285", "-1.7 %", "27 min"],
    ["fine", "25 deg", "1.57 M", "0.280", "-0.05 %", "0.292", "0.285", "-1.8 %", "51 min"],
    ["35 deg", "35 deg", "0.84 M", "0.408", "-0.15 %", "0.445", "0.26", "+57 %", "24 min"],
  ],
};

/** The commands that make those results (the doc's code block). */
export const RUN = [
  ". /opt/openfoam14/etc/bashrc",
  "cp -r examples/ahmed-body $FOAM_RUN/ahmed && cd $FOAM_RUN/ahmed",
  "./Allvalidate 6 2000          # ranks, iterations per case; writes ../ahmed_validation/results.md",
];

/** The command that verifies an install: the coarse mesh alone (the doc's "Verify your install"). */
export const VERIFY = [
  "meshdoctor solve verify-install --template ahmed-body --size coarse --to 2000 --np 6",
];

/** "25 deg" as "25°", and the doc's "-" as a minus sign. */
export function readable(cell: string): string {
  return cell.replace(/(\d) deg\b/g, "$1°").replace(/^-(?=\d)/, "−");
}

export interface Case {
  /** "Medium mesh, 25° slant" */
  name: string;
  cells: string;
  cd: number;
  tunnel: number;
  difference: string;
  drift: string;
  cl: number;
  /** how long it took ("" when it isn't known) */
  time: string;
  /** the 25° runs land within a few percent; the 35° one is the known miss of steady RANS */
  miss: boolean;
  /** the iterations its Cd, Cl and drift are taken over: the accuracy check's last 500 unless it says */
  window?: number;
}

/** The results as numbers, for the chart. */
export function cases(table: DocTable = RESULTS): Case[] {
  const col = (name: string) => column(table, name);
  const [names, slants, cells, cd, drift, cl, tunnel, difference, time] = [
    col("Case"), col("Slant"), col("Cells"), col("Cd"), col("Drift"), col("Cl"), col("Wind tunnel Cd"),
    col("Difference"), col("Solve time"),
  ];
  return names.map((n, i) => {
    const slant = readable(slants[i] ?? "");
    const pct = Math.abs(Number.parseFloat(difference[i] ?? ""));
    return {
      name: n === slants[i] ? `${slant} slant, medium mesh` : `${n[0]?.toUpperCase()}${n.slice(1)} mesh, ${slant} slant`,
      cells: cells[i] ?? "",
      cd: Number(cd[i]),
      tunnel: Number(tunnel[i]),
      difference: readable(difference[i] ?? ""),
      drift: readable(drift[i] ?? ""),
      cl: Number(cl[i]),
      time: time[i] ?? "",
      miss: !(pct < 10),
    };
  });
}
