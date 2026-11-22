// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

test("the docs page: from the header, each of the site's pages opens, the rest are on GitHub, and nothing is sent", async ({ page }) => {
  const sent: string[] = [];
  const origins = new Set<string>();
  page.on("request", (r) => {
    origins.add(new URL(r.url()).origin);
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto("/");
  const description = page.locator('meta[name="description"]');
  const site = await description.getAttribute("content");
  expect(site).toMatch(/^Mesh Doctor finds bad cells in OpenFOAM meshes/);
  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Docs" }).click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
  await expect(page).toHaveTitle("Docs · Mesh Doctor");
  await expect(page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");

  const readme = page.getByRole("region", { name: "On GitHub" }).getByRole("link", { name: "README" });
  await expect(readme).toHaveAttribute("href", "https://github.com/Cfd-mesh-doctor/mesh-doctor#readme");
  await expect(readme).toHaveAttribute("target", "_blank");

  for (const [name, heading] of [
    ["How it works", "How Mesh Doctor works"], ["Accuracy check", "Accuracy check"], ["Gallery", "Gallery"],
    ["Install", "Install"], ["Troubleshooting", "Troubleshooting"], ["Limits", "Limits"],
    ["Safety model", "Safety model"], ["Architecture", "Architecture"],
    ["Report viewer", "Report viewer"], ["Size estimator", "Size estimator"],
  ] as const) {
    // Each page describes itself to search engines as its card here does; the Docs page has its own description.
    const card = page.getByRole("region", { name: "On this site" }).getByRole("listitem").filter({ has: page.getByRole("link", { name, exact: true }) });
    const about = (await card.locator("p").textContent()) ?? "";
    await card.getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(description).toHaveAttribute("content", about);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
    await expect(description).toHaveAttribute("content", /^Everything written about Mesh Doctor/);
  }
  // A page without a description of its own (the home page) has the site's again.
  await page.getByRole("link", { name: "Mesh Doctor", exact: true }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(description).toHaveAttribute("content", site ?? "");
  expect([...origins]).toEqual(["http://localhost:4173"]);
  expect(sent).toEqual([]);
});

test("the app's Documentation link opens the Docs page in a new tab, leaving the app as it is", async ({ page }) => {
  await page.goto("/demo/jobs");
  const [docs] = await Promise.all([page.waitForEvent("popup"), page.getByRole("link", { name: "Documentation" }).click()]);
  await expect(docs).toHaveURL(/\/docs$/);
  await expect(docs.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
  await expect(page).toHaveURL(/\/demo\/jobs$/);
});

test("the docs search loads its texts only when used, opens the section found, and coming back keeps the search", async ({ page }) => {
  const texts: string[] = [];
  page.on("request", (r) => { if (/searchIndex/.test(r.url())) texts.push(r.url()); });
  await page.goto("/docs");
  await page.locator("h1").first().waitFor();
  await page.waitForLoadState("networkidle");
  expect(texts).toEqual([]);

  const box = page.getByRole("searchbox", { name: "Search all the docs" });
  await box.fill("SIGKILL");
  await expect(page).toHaveURL(/\/docs\?q=SIGKILL$/);
  const results = page.getByRole("region", { name: "Search results" });
  const jobs = results.getByRole("link", { name: "Jobs" });
  await expect(jobs).toBeVisible();
  expect(texts).toHaveLength(1);
  await expect(results.locator("mark").first()).toHaveText("SIGKILL");

  await jobs.click();
  await expect(page).toHaveURL(/\/architecture#jobs$/);
  await expect(page.getByRole("heading", { level: 2, name: "Jobs" })).toBeInViewport();
  await page.goBack();
  await expect(box).toHaveValue("SIGKILL");
  await expect(jobs).toBeVisible();

  // A Troubleshooting group opens searched for the same words, at the problems that hold them.
  await box.fill("patchField");
  await results.getByRole("link", { name: "OpenFOAM runs" }).click();
  await expect(page).toHaveURL(/\/troubleshooting\?q=patchField#openfoam-runs$/);
  await expect(page.getByRole("searchbox")).toHaveValue("patchField");
  await expect(page.getByText(/^1 of \d+ problems matches\. Enter goes to it\.$/)).toBeVisible();
});

test("the docs search from the keyboard: “/”, a word and Enter open the first match", async ({ page }) => {
  await page.goto("/docs");
  await page.locator("h1").first().waitFor();
  await page.keyboard.press("/");
  await page.keyboard.type("SIGKILL");
  const href = await page.getByRole("region", { name: "Search results" }).getByRole("link").first().getAttribute("href");
  await expect(page.getByText(/ Enter opens (it|the first)\.$/)).toBeVisible();
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => u.pathname + u.search + u.hash === href);
  await expect(page.locator("h1").first()).toBeVisible();
});
