// SPDX-License-Identifier: GPL-3.0-or-later
// Saving a report the app shows as a file, to keep or to share: the engine's own document, named and written as
// `meshdoctor report` writes it, so it opens in the report viewer (and the engine's) like any report; and any other
// file the app holds (a picture of a set). The file is made in this tab; nothing is sent anywhere.
import type { Report } from "./read";

/** Compact JSON with every character outside printable ASCII escaped, as Python's json.dump writes it (the engine
 * uses separators=(",", ":")), so any reader decodes the file the same whatever encoding it assumes. The browser
 * writes some numbers its own way (65 where Python wrote 65.0, 0.0000462 where it wrote 4.62e-05): the same
 * document, not always the same bytes. */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[^ -~]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** The name `meshdoctor report <name>` gives its file. */
export function reportFileName(name: string): string {
  return `${name}.mdreport.json`;
}

/** How long the file stays readable after the download starts: the browser may still be reading it when click()
 * returns (FileSaver.js waits 40 s too). */
export const KEEP_MS = 40_000;

/** Hands the browser `blob` as a file to save, named `name`. */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), KEEP_MS);
}

/** Hands the browser the report as a file to save. */
export function saveReport(report: Report): void {
  saveFile(new Blob([asciiJson(report)], { type: "application/json" }), reportFileName(report.name));
}
