// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { DESIGN } from "@/pages/architecture/design";
import { GROUPS } from "@/pages/troubleshooting/problems";
import { ON_SITE } from "./entries";
import { SEARCH_INDEX, searchDocs } from "./searchIndex";

const at = (page: string) => SEARCH_INDEX.filter((e) => e.page === page);

describe("searching the docs", () => {
  it("holds every section of the pages that show a doc's sections, each at a page of this site, once", () => {
    const pages = ON_SITE.map((d) => d.page);
    for (const e of SEARCH_INDEX) expect(pages, e.page).toContain(e.page);
    expect(at("/architecture").map((e) => e.id)).toEqual(DESIGN.map((s) => s.id));
    expect(at("/troubleshooting").map((e) => e.id)).toEqual(GROUPS.map((g) => g.id));
    expect(new Set(SEARCH_INDEX.map((e) => `${e.page}#${e.id}`)).size).toBe(SEARCH_INDEX.length);
    expect(new Set(SEARCH_INDEX.map((e) => e.page))).toEqual(new Set([
      "/limits", "/safety", "/your-own-case", "/claude-code", "/dashboard-tour", "/architecture", "/troubleshooting",
    ]));
  });

  it("finds the sections holding every word typed, whatever their case", () => {
    const hits = searchDocs("sigterm WRAPPER");
    expect(hits.map((h) => `${h.page}#${h.id}`)).toContain("/architecture#jobs");
    for (const h of hits) {
      const all = `${h.title} ${h.text}`.toLowerCase();
      expect(all).toContain("sigterm");
      expect(all).toContain("wrapper");
    }
    expect(searchDocs("sigterm quantumflux")).toEqual([]);
    expect(searchDocs("   ")).toEqual([]);
  });

  it("puts the sections whose title holds the words first", () => {
    expect(searchDocs("jobs")[0]).toMatchObject({ page: "/architecture", pageTitle: "Architecture", id: "jobs", title: "Jobs" });
  });

  it("finds a problem by its message, in its Troubleshooting group", () => {
    const hit = searchDocs("patchField").find((h) => h.page === "/troubleshooting");
    expect(hit).toMatchObject({ pageTitle: "Troubleshooting", title: "OpenFOAM runs" });
  });

  it("reads a section as its page does: a link by its words, not its address", () => {
    expect(searchDocs("how-it-works.md")).toEqual([]);
    const safety = at("/safety").map((e) => e.text).join(" ");
    expect(safety).toContain("(see how it works)");
    for (const e of SEARCH_INDEX) expect(e.text, `${e.page}#${e.id}`).not.toMatch(/\]\(|\*\*|\s{2}/);
  });

  it("shows a short piece of the section's text around the word, cut between words", () => {
    const hit = searchDocs("SIGKILL").find((h) => h.id === "jobs");
    expect(hit?.snippet).toMatch(/SIGKILL/);
    expect(hit?.snippet.length).toBeLessThanOrEqual(162);
    for (const h of searchDocs("engine", 50)) {
      const body = h.snippet.replace(/^…/, "").replace(/…$/, "");
      const start = h.text.indexOf(body);
      expect(start, h.snippet).toBeGreaterThanOrEqual(0);
      expect(h.snippet.startsWith("…"), h.snippet).toBe(start > 0);
      if (start > 0) expect(h.text[start - 1], h.snippet).toBe(" ");
      if (start + body.length < h.text.length) expect(h.text[start + body.length], h.snippet).toBe(" ");
    }
  });

  it("returns at most the number asked for", () => {
    expect(searchDocs("the", 3)).toHaveLength(3);
  });
});
