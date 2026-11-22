// SPDX-License-Identifier: GPL-3.0-or-later
// Careful readers for values from a report file. A report can come from anywhere, so every value is checked
// before it is used: a missing or odd field reads as empty, never as a broken page.

export type Obj = Record<string, unknown>;

export const obj = (x: unknown): Obj => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Obj) : {});
export const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
export const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
export const str = (x: unknown): string | null => (typeof x === "string" && x ? x : null);
export const strs = (x: unknown): string[] => arr(x).filter((s): s is string => typeof s === "string");
