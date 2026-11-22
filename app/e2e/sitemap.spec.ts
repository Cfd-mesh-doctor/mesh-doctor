// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("the built site serves its sitemap, and robots.txt points at it", async ({ request }) => {
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain("<loc>https://mesh-doctor.vercel.app/how-it-works</loc>");
  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Sitemap: https://mesh-doctor.vercel.app/sitemap.xml");
});
