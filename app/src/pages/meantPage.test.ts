// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { ON_SITE } from "./docs/entries";
import { meantPage } from "./meantPage";

describe("the page an address that leads nowhere most likely meant", () => {
  it.each([
    ["/instal", "/install", "a letter short"],
    ["/galery", "/gallery", "a letter short"],
    ["/Architecure", "/architecture", "a letter short, in capitals"],
    ["/troubleshootnig", "/troubleshooting", "two letters swapped"],
    ["/conect", "/connect", "a letter short"],
    ["/trouble", "/troubleshooting", "cut short"],
    ["/how", "/how-it-works", "cut short"],
    ["/installation", "/install", "run on"],
    ["/reports", "/report", "run on"],
    ["/estimator", "/estimate", "a word for the page"],
    ["/size-estimator", "/estimate", "the page's name"],
    ["/report_viewer", "/report", "the page's name"],
    ["/Accuracy%20check", "/accuracy", "the page's name, as a browser sends it"],
    ["/validation", "/accuracy", "its doc's name"],
    ["/docs/validation.md", "/accuracy", "its doc's file"],
    ["/docs/templates.md", "/your-own-case", "its doc's file"],
    ["/blob/main/docs/safety.md", "/safety", "its doc's file on GitHub"],
    ["/docs/install", "/install", "the last piece that's near a page decides"],
    ["/docs/troublshooting", "/troubleshooting", "the last piece that's near a page decides"],
    ["/how-it-works/detect", "/how-it-works", "a section as a folder"],
  ])("%s means %s (%s)", (address, page) => expect(meantPage(address)?.page).toBe(page));

  it.each(["/nowhere", "/x", "/wp-admin", "/index.html", "/%E0%A4%A"])("guesses nothing for %s", (address) =>
    expect(meantPage(address)).toBeUndefined());

  it("finds every page by its own name, and every doc page by its doc's file", () => {
    for (const d of ON_SITE.filter((e) => e.page)) {
      expect(meantPage(`/${d.title}`)).toEqual({ page: d.page, title: d.title });
      if (d.file) expect(meantPage(`/docs/${d.file}`)).toEqual({ page: d.page, title: d.title });
    }
  });
});
