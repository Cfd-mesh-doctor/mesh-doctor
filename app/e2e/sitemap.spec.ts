// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("the built site serves its sitemap, and robots.txt points at it", async ({ request }) => {
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain("<loc>https://mesh-doctor.vercel.app/how-it-works</loc>");
  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Sitemap: https://mesh-doctor.vercel.app/sitemap.xml");
});

test("the built site serves the link preview's picture that its page names", async ({ page, request }) => {
  await page.goto("/");
  const url = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(url).toBe("https://mesh-doctor.vercel.app/og.png");
  const picture = await request.get(new URL(url!).pathname);
  expect(picture.ok()).toBe(true);
  expect(picture.headers()["content-type"]).toBe("image/png");
});
