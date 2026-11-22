// SPDX-License-Identifier: GPL-3.0-or-later
// The sitemap tells search engines which pages the site has: every page of the router, less those robots.txt keeps
// out (the app and the pairing page need the engine on your own computer, so there is nothing there to index).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SITE_URL } from "@/lib/site";
import { routes } from "@/router";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");
const read = (name: string) => readFileSync(resolve(PUBLIC, name), "utf8");

describe("the sitemap", () => {
  it("lists each page robots.txt lets in, once, at the site's address, in the router's order", () => {
    const kept = [...read("robots.txt").matchAll(/^Disallow: (\S+)$/gm)].map((m) => m[1]);
    expect(kept).toEqual(["/app", "/connect"]);
    const pages = routes.flatMap((r) => r.children ?? []).map((r) => r.path ?? "").filter((p) => p.startsWith("/"));
    const listed = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(listed).toEqual(pages.filter((p) => !kept.includes(p)).map((p) => SITE_URL + p));
    expect(listed).toContain(`${SITE_URL}/`);
  });

  it("is where robots.txt says it is", () => {
    expect(read("robots.txt").split(/\r?\n/)).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });
});
