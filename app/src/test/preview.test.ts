// SPDX-License-Identifier: GPL-3.0-or-later
// A shared link to the site shows a preview in chat apps and social sites (Open Graph and Twitter card tags): the
// page's own title and description, at the site's address, with docs/images/og-home.png, which the build publishes
// as /og.png (vite.config.ts; e2e/og-image.spec.ts makes the picture).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SITE_URL } from "@/lib/site";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(APP, "index.html"), "utf8");

/** The content of the page head's meta tag with this property or name. */
function meta(key: string): string | undefined {
  const tag = html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`));
  return tag?.[1];
}

describe("the link preview", () => {
  it("uses the page's own title and description, at the site's address", () => {
    expect(meta("og:title")).toBe(html.match(/<title>([^<]+)<\/title>/)?.[1]);
    expect(meta("og:description")).toBe(meta("description"));
    expect(meta("og:url")).toBe(`${SITE_URL}/`);
    expect(meta("og:type")).toBe("website");
    expect(meta("og:site_name")).toBe("Mesh Doctor");
    expect(meta("twitter:card")).toBe("summary_large_image");
  });

  it("points at a 1200 x 630 picture the site has, small enough for every chat app", () => {
    expect(meta("og:image")).toBe(`${SITE_URL}/og.png`);
    expect(meta("og:image:alt")).toMatch(/\w{3}/);
    const png = readFileSync(resolve(APP, "../docs/images/og-home.png"));
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)]; // the IHDR chunk
    expect([width, height]).toEqual([Number(meta("og:image:width")), Number(meta("og:image:height"))]);
    expect([width, height]).toEqual([1200, 630]);
    expect(png.length).toBeLessThan(300_000); // WhatsApp shows no picture above 300 kB
  });
});
