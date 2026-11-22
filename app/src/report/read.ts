// SPDX-License-Identifier: GPL-3.0-or-later
// Opening a report file (meshdoctor report <name>) in this browser tab: a .mdreport.json, a .json.gz
// or an exported .html page. The file is never uploaded, and nothing in it runs: an exported page is
// parsed as an inert document and only the text of its data slot is read.
import type { components } from "@/engine/schema";

export type Report = components["schemas"]["Report"];
export type RepairDoc = components["schemas"]["Repair"];
export type AbtestDoc = components["schemas"]["Abtest"];
export type JudgeDoc = components["schemas"]["Judge"];

/** The largest file, or unpacked .gz, this page opens. Real reports are a few MB. */
export const MAX_BYTES = 64 * 1024 * 1024;

/** A report that can't be opened, with a message for the person who picked it. */
export class ReportError extends Error {}

export interface OpenedReport {
  report: Report;
  /** Where it came from, shown under the title: the file's name. */
  from: string;
}

const TOO_BIG = `This file is bigger than ${MAX_BYTES / 1024 / 1024} MB, which is far more than a report needs. Is it the right file?`;

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (typeof DecompressionStream === "undefined") {
    throw new ReportError("This browser can't unpack .gz files. Open the .json report instead.");
  }
  const body = new Response(bytes).body;
  if (!body) throw new ReportError("The file is empty.");
  const reader = body.pipeThrough(new DecompressionStream("gzip")).getReader();
  const text = new TextDecoder();
  let out = "";
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new ReportError(TOO_BIG);
      }
      out += text.decode(value, { stream: true });
    }
  } catch (e) {
    if (e instanceof ReportError) throw e;
    throw new ReportError("The .gz file is damaged, so it can't be unpacked.");
  }
  return out + text.decode();
}

function fromPage(html: string): string {
  // DOMParser makes an inert document: its scripts never run and nothing it names is fetched.
  const slot = new DOMParser().parseFromString(html, "text/html").getElementById("md-report");
  const data = slot?.textContent?.trim();
  if (!data) {
    throw new ReportError("This web page has no report inside. Open the .mdreport.json file, or a page made with meshdoctor report <name> --html.");
  }
  return data;
}

/** Checks the outside of a parsed file: is it a version 1 report with a repair in it? */
export function checkReport(data: unknown): Report {
  if (!isObject(data) || data.kind !== "meshdoctor-report") {
    throw new ReportError("This file isn't a Mesh Doctor report. Make one with meshdoctor report <name>.");
  }
  const version = String(data.schemaVersion ?? "").slice(0, 20);
  if (version.split(".")[0] !== "1") {
    throw new ReportError(`This report is version ${version || "unknown"}; this page reads version 1 reports. Is there a newer Mesh Doctor?`);
  }
  if (!isObject(data.documents) || !isObject(data.documents.repair)) {
    throw new ReportError("The report has no repair result in it.");
  }
  return data as unknown as Report;
}

/** Reads a report from a file's bytes. Throws ReportError with a plain message when it can't. */
export async function readReport(bytes: Uint8Array<ArrayBuffer>, from: string): Promise<OpenedReport> {
  if (bytes.byteLength === 0) throw new ReportError("The file is empty.");
  if (bytes.byteLength > MAX_BYTES) throw new ReportError(TOO_BIG);
  let text = bytes[0] === 0x1f && bytes[1] === 0x8b ? await gunzip(bytes) : new TextDecoder().decode(bytes);
  if (/^\s*</.test(text)) text = fromPage(text);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ReportError("This file isn't a Mesh Doctor report: it isn't JSON. Reports end in .mdreport.json, .json.gz or .html.");
  }
  return { report: checkReport(data), from };
}

/** The bytes of a picked or dropped file. */
export async function fileBytes(file: Blob): Promise<Uint8Array<ArrayBuffer>> {
  if (file.size > MAX_BYTES) throw new ReportError(TOO_BIG);
  if (typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
  // Older engines of the same browsers, and the test DOM, only have FileReader.
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(new ReportError("The file couldn't be read. Try picking it again."));
    r.readAsArrayBuffer(file);
  });
}
