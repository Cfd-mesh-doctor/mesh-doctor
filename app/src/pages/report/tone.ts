// SPDX-License-Identifier: GPL-3.0-or-later
import type { Change } from "@/report/summary";

/** A number that got better in green, one that got worse in red, as the report's tables show them. */
export const changeText = (c: Change) => (c === "better" ? "text-success font-medium" : c === "worse" ? "text-danger font-medium" : "");
