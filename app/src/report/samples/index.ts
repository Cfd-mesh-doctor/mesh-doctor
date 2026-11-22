// SPDX-License-Identifier: GPL-3.0-or-later
/** Real reports from the demo's recording (`meshdoctor report` on its runs of the public Ahmed-body example,
 * examples/ahmed-body, and of OpenFOAM's pitzDaily tutorial), one for each finished repair; each loads only when
 * opened. The demo answers with all of them; the report viewer offers the two with the most to show as samples.
 * `label` is what the demo's list of reports calls each one, and says only what the demo's own answer holds: the
 * 25° medium run's A/B test is still running in the demo's job list, so the demo leaves it out of that report.
 * `sample` is what the viewer's sample card calls it, where the whole recorded report opens. */
export const RECORDED = [
  { name: "ahmed25-coarse-fix", label: "25° slant, coarse mesh, with an A/B test",
    load: () => import("./ahmed25-coarse-fix.mdreport.json") },
  { name: "ahmed25-medium-fix", label: "25° slant, medium mesh", sample: "25° slant, with an A/B test",
    load: () => import("./ahmed25-medium-fix.mdreport.json") },
  { name: "ahmed25-fine-fix", label: "25° slant, fine mesh",
    load: () => import("./ahmed25-fine-fix.mdreport.json") },
  { name: "ahmed35-medium-fix", label: "35° slant, with a repair map", sample: "35° slant, with a repair map",
    load: () => import("./ahmed35-medium-fix.mdreport.json") },
  { name: "pitzdaily-fix", label: "pitzDaily, OpenFOAM's tutorial",
    load: () => import("./pitzdaily-fix.mdreport.json") },
] as const;

/** The report viewer's samples: an A/B test with both runs' residuals, and a repair map. */
export const SAMPLES = RECORDED.flatMap((r) => ("sample" in r ? [{ name: r.name, label: r.sample, load: r.load }] : []));
