// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { catchDownloads } from "@/test/downloads";
import { checkReport, readReport } from "./read";
import sample from "./samples/pitzdaily-fix.mdreport.json";
import sampleFile from "./samples/pitzdaily-fix.mdreport.json?raw";
import { KEEP_MS, asciiJson, reportFileName, saveReport } from "./save";

/** A JSON escape spelled out, so that no editor or tool turns it back into its character. */
const u = (hex: string) => `\\u${hex}`;

describe("a report saved as a file", () => {
  afterEach(() => void vi.useRealTimers());

  it("is written as Python's json.dump writes it: compact, with only printable ASCII", () => {
    // the right-hand side is what python -c 'json.dumps(..., separators=(",", ":"))' prints for the same object
    expect(asciiJson({ slant: "25°", del: "\u007f", face: "\u{1F600}", tab: "\t" }))
      .toBe(`{"slant":"25${u("00b0")}","del":"${u("007f")}","face":"${u("d83d")}${u("de00")}","tab":"\\t"}`);
  });

  it("is the engine's file, but for how the browser writes whole numbers", () => {
    // pitzDaily's report (written by meshdoctor report) has no numbers small enough for Python's e-notation,
    // so its whole numbers (65.0 in Python, 65 in the browser) are all that differ: escapes, key order and
    // separators come out byte for byte.
    expect(asciiJson(JSON.parse(sampleFile))).toBe(sampleFile.replace(/(\d)\.0(?=[,\]}])/g, "$1"));
  });

  it("reads back as the same report", async () => {
    const text = asciiJson(sample);
    expect(text).toMatch(/^[ -~]+$/);
    const opened = await readReport(new TextEncoder().encode(text), "a saved file");
    expect(opened.report).toEqual(sample);
  });

  it("is named as meshdoctor report names it", () => {
    expect(reportFileName("ahmed25-medium-fix")).toBe("ahmed25-medium-fix.mdreport.json");
  });

  it("goes to the browser as a download, and is let go once the browser has had time to read it", async () => {
    vi.useFakeTimers();
    const downloads = catchDownloads();
    try {
      saveReport(checkReport(sample));
      expect(downloads.saved.map(({ name, type, inPage }) => ({ name, type, inPage })))
        .toEqual([{ name: "pitzdaily-fix.mdreport.json", type: "application/json", inPage: true }]);
      expect(document.querySelector("a[download]")).toBeNull(); // the link is gone again
      vi.advanceTimersByTime(KEEP_MS - 1);
      expect(downloads.open()).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(downloads.open()).toEqual([]);
      vi.useRealTimers();
      expect(await downloads.saved[0]!.text()).toBe(asciiJson(sample));
    } finally {
      downloads.restore();
    }
  });
});
