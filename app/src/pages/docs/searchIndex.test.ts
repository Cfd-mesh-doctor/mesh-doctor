// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { DESIGN } from "@/pages/architecture/design";
import { GALLERY } from "@/pages/gallery/pictures";
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
    expect(at("/gallery").map((e) => e.id)).toEqual(GALLERY.map((s) => s.id));
    expect(new Set(SEARCH_INDEX.map((e) => `${e.page}#${e.id}`)).size).toBe(SEARCH_INDEX.length);
    // The pages written as pages of their own: their top, then each of their sections.
    expect(at("/how-it-works").map((e) => e.id))
      .toEqual(["", "detect", "highlight", "correct", "ab-test", "judge", "hotspots", "dashboard"]);
    expect(at("/accuracy").map((e) => e.id)).toEqual([""]);
    expect(at("/install").map((e) => e.id)).toEqual(["", "one-command", "by-hand", "next"]);
    expect(new Set(SEARCH_INDEX.filter((e) => e.id).map((e) => e.page))).toEqual(new Set([
      "/how-it-works", "/gallery", "/install", "/limits", "/safety", "/your-own-case", "/claude-code", "/dashboard-tour",
      "/architecture", "/troubleshooting",
    ]));
    // Every page the Docs page lists is in it; the two whose words aren't searched (the tools) once, by what the
    // Docs page says about them.
    for (const d of ON_SITE) expect(SEARCH_INDEX.some((e) => e.page === d.page), d.title).toBe(true);
    const summed = ON_SITE.filter((d) => !SEARCHED.includes(d.title));
    expect(summed.map((d) => d.page)).toEqual(["/report", "/estimate"]);
    for (const d of summed) {
      expect(at(d.page ?? "")).toEqual([{ page: d.page, pageTitle: d.title, id: "", title: d.title, text: d.about }]);
    }
  });

  it("finds a page of its own by the words it shows: a section at its heading, the rest at the page's top", () => {
    const docker = searchDocs("docker volume").find((h) => h.page === "/install");
    expect(docker).toMatchObject({ pageTitle: "Install", id: "by-hand", title: "By hand" });
    expect(docker && hitTarget(docker, "docker")).toEqual({ pathname: "/install", search: "", hash: "#by-hand" });
    const tunnel = searchDocs("Faltin").find((h) => h.page === "/accuracy");
    expect(tunnel).toMatchObject({ pageTitle: "Accuracy check", id: "", title: "Accuracy check" });
    expect(tunnel && hitTarget(tunnel, "Faltin")).toEqual({ pathname: "/accuracy", search: "", hash: "" });
  });

  it("finds a tool by what the Docs page says about it, and opens it at its top", () => {
    const viewer = searchDocs("uploaded").find((h) => h.page === "/report");
    expect(viewer).toMatchObject({ id: "", title: "Report viewer" });
    expect(viewer && hitTarget(viewer, "uploaded")).toEqual({ pathname: "/report", search: "", hash: "" });
  });

  it("finds a Gallery section by what its pictures show, and opens it at its heading", () => {
    const cuts = searchDocs("centreline speed").find((h) => h.page === "/gallery");
    expect(cuts).toMatchObject({ pageTitle: "Gallery", id: "cuts", title: "Cut planes" });
    expect(cuts && hitTarget(cuts, "centreline")).toEqual({ pathname: "/gallery", search: "", hash: "#cuts" });
    expect(searchDocs("vortex_views").map((h) => `${h.page}#${h.id}`)).toContain("/gallery#vortices");
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
    // Only the page whose own words name the file finds it ("This page follows docs/how-it-works.md").
    expect(searchDocs("how-it-works.md").map((h) => `${h.page}#${h.id}`)).toEqual(["/how-it-works#"]);
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
    expect(SEARCHED).toEqual(ON_SITE.filter((d) => d.page !== "/report" && d.page !== "/estimate").map((d) => d.title));
    expect(SEARCHED).toHaveLength(11);
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
