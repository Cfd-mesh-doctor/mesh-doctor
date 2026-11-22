// SPDX-License-Identifier: GPL-3.0-or-later
/** Real reports made from the public Ahmed-body example (examples/ahmed-body); each loads only when picked. The
 * report viewer offers them as samples, and the demo answers with them for these two repairs. */
export const SAMPLES = [
  { name: "ahmed25-medium-fix", label: "25° slant, with an A/B test",
    load: () => import("./ahmed25-medium-fix.mdreport.json") },
  { name: "ahmed35-medium-fix", label: "35° slant, with a repair map",
    load: () => import("./ahmed35-medium-fix.mdreport.json") },
] as const;
