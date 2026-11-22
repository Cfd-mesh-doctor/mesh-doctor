// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { REPO_URL } from "@/lib/site";
import { routes } from "@/router";
import { docNames, readDoc } from "@/test/markdown";
import { ON_GITHUB, ON_SITE, githubDoc } from "./entries";

describe("the Docs page's list", () => {
  it("has every doc in the repository's docs folder, once", () => {
    const listed = [...ON_SITE, ...ON_GITHUB].flatMap((d) => (d.file ? [d.file] : []));
    expect([...listed].sort()).toEqual(docNames());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("names each doc on GitHub by its own heading, and links to it on main", () => {
    for (const d of ON_GITHUB) {
      expect(d.page, d.title).toBeUndefined();
      expect(readDoc(d.file ?? "").match(/^# (.+)$/m)?.[1], d.file).toBe(d.title);
    }
    expect(githubDoc("limits.md")).toBe(`${REPO_URL}/blob/main/docs/limits.md`);
  });

  it("points each of the site's own entries at one of its pages", () => {
    const pages = routes.flatMap((r) => r.children ?? []).map((r) => r.path);
    for (const d of ON_SITE) expect(pages, d.title).toContain(d.page);
  });
});
