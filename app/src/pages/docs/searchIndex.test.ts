// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { DESIGN } from "@/pages/architecture/design";
import { GROUPS } from "@/pages/troubleshooting/problems";
import { ON_SITE } from "./entries";
import { SEARCHED, SEARCH_INDEX, hitTarget, searchDocs } from "./searchIndex";

const at = (page: string) => SEARCH_INDEX.filter((e) => e.page === page);

describe("searching the docs", () => {
  it("holds every section of the pages that show a doc's sections, each at a page of this site, once", () => {
    const pages = ON_SITE.map((d) => d.page);
    for (const e of SEARCH_INDEX) expect(pages, e.page).toContain(e.page);
    expect(at("/architecture").map((e) => e.id)).toEqual(DESIGN.map((s) => s.id));
    expect(at("/troubleshooting").map((e) => e.id)).toEqual(GROUPS.map((g) => g.id));
    expect(new Set(SEARCH_INDEX.map((e) => `${e.page}#${e.id}`)).size).toBe(SEARCH_INDEX.length);
    expect(new Set(SEARCH_INDEX.filter((e) => e.id).map((e) => e.page))).toEqual(new Set([
      "/limits", "/safety", "/your-own-case", "/claude-code", "/dashboard-tour", "/architecture", "/troubleshooting",
    ]));
    // Every other page the Docs page lists is in it once, by what the Docs page says about it.
    for (const d of ON_SITE) expect(SEARCH_INDEX.some((e) => e.page === d.page), d.title).toBe(true);
    expect(SEARCH_INDEX.filter((e) => !e.id)).toEqual(ON_SITE.filter((d) => !SEARCHED.includes(d.title))
      .map((d) => ({ page: d.page, pageTitle: d.title, id: "", title: d.title, text: d.about })));
  });

  it("finds a page written as a page of its own by its summary, and opens it at its top", () => {
    const install = searchDocs("WSL OpenFOAM Python").find((h) => h.page === "/install");
    expect(install).toMatchObject({ id: "", title: "Install" });
    expect(install && hitTarget(install, "WSL")).toEqual({ pathname: "/install", search: "", hash: "" });
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

  it("finds a word where one of the doc's own words starts: “pair” finds “pairing”, not “repair”", () => {
    const starts = /(^|[^\p{L}\p{N}])pair/iu;
    const expected = SEARCH_INDEX.filter((e) => starts.test(`${e.title} ${e.text}`)).map((e) => `${e.page}#${e.id}`);
    expect(expected.length).toBeGreaterThan(0);
    expect(searchDocs("PAIR", 100).map((h) => `${h.page}#${h.id}`).sort()).toEqual(expected.sort());
    expect(SEARCH_INDEX.some((e) => /repair/i.test(e.text) && !starts.test(`${e.title} ${e.text}`))).toBe(true);
    expect(searchDocs("orthogonality").map((h) => h.id)).toContain("what-mesh-doctor-is-not"); // in "non-orthogonality"
  });

  it("finds the Troubleshooting group whose problem quotes a line pasted from a log, first, and opens it there", () => {
    const line = "--> FOAM FATAL ERROR: Cannot find patchField entry for procBoundary0to1 (file: processor0/0/U)";
    const [first] = searchDocs(line);
    expect(first).toMatchObject({ page: "/troubleshooting", id: "openfoam-runs" });
    expect(first && hitTarget(first, line).search).toBe(`?${new URLSearchParams({ q: line })}`);
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
      if (start + body.length < h.text.length) expect(h.text[start + body.length], h.snippet).toMatch(/^[ .,;:]$/);
      expect(h.snippet, "no stop before the …").not.toMatch(/[.,;:]…$/);
    }
  });

  it("returns at most the number asked for", () => {
    expect(searchDocs("the", 3)).toHaveLength(3);
  });

  it("names the pages it looks in in the Docs page's order", () => {
    expect(SEARCHED).toEqual(ON_SITE.map((d) => d.title).filter((t) => SEARCH_INDEX.some((e) => e.pageTitle === t && e.id)));
    expect(SEARCHED).toHaveLength(7);
  });

  it("opens a section at its heading, and a Troubleshooting group at its problems that hold all the words", () => {
    const find = (q: string, id: string) => searchDocs(q, 100).find((h) => h.id === id);
    const jobs = find("SIGKILL", "jobs");
    expect(jobs && hitTarget(jobs, "SIGKILL")).toEqual({ pathname: "/architecture", search: "", hash: "#jobs" });
    const one = find("patchField", "openfoam-runs");
    expect(one && hitTarget(one, " patchField ")).toEqual({ pathname: "/troubleshooting", search: "?q=patchField", hash: "#openfoam-runs" });
    // Both words are in the group, but no one problem holds both: the group opens with all its problems.
    const apart = "patchField nNonOrthogonalCorrectors";
    const both = find(apart, "openfoam-runs");
    expect(both && hitTarget(both, apart)).toEqual({ pathname: "/troubleshooting", search: "", hash: "#openfoam-runs" });
  });
});
