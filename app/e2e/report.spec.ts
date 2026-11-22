// SPDX-License-Identifier: GPL-3.0-or-later
import { gzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { testReport } from "../src/report/testReport";

const SITE = "http://localhost:4173";
const json = () => JSON.stringify(testReport());

/** Every origin the page asks for anything, and any request that sends data. */
function watchRequests(page: Page) {
  const origins = new Set<string>();
  const sent: string[] = [];
  page.on("request", (r) => {
    origins.add(new URL(r.url()).origin);
    if (r.method() !== "GET") sent.push(`${r.method()} ${r.url()}`);
  });
  return { origins, sent };
}

async function pick(page: Page, name: string, buffer: Buffer, mimeType = "application/json") {
  await page.getByLabel("Choose a report file").setInputFiles({ name, mimeType, buffer });
}

test("a report file opens in the browser, and nothing is sent anywhere", async ({ page }) => {
  const seen = watchRequests(page);
  await page.goto("/report");
  await expect(page.getByRole("heading", { name: "Report viewer" })).toBeVisible();
  await pick(page, "ahmed25-fine-fix.mdreport.json", Buffer.from(json()));
  await expect(page.getByRole("heading", { name: "ahmed25-fine-fix" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Max non-orthogonality/ })).toContainText("64.91");
  await expect(page.getByRole("row", { name: /^p / })).toContainText("0.50×");
  await expect(page.getByText("so the repair helped the solver.", { exact: false })).toBeVisible();
  await expect(page).toHaveTitle("Report ahmed25-fine-fix · Mesh Doctor");
  // The residual chart: two lines, and a read-out where the pointer is.
  const chart = page.getByRole("img", { name: /Initial residual of p per iteration/ });
  await expect(chart.locator("path")).toHaveCount(2);
  await chart.hover({ position: { x: 300, y: 100 } });
  await expect(page.getByText(/^iteration \d+$/)).toBeVisible();
  await page.getByRole("radio", { name: "Ux" }).click();
  await expect(page.getByRole("img", { name: /Initial residual of Ux per iteration/ })).toBeVisible();
  expect([...seen.origins]).toEqual([SITE]);
  expect(seen.sent).toEqual([]);
});

test("gzipped reports and exported pages open too, and a page's scripts never run", async ({ page }) => {
  await page.goto("/report");
  await pick(page, "r.mdreport.json.gz", gzipSync(json()), "application/gzip");
  await expect(page.getByRole("heading", { name: "ahmed25-fine-fix" })).toBeVisible();

  await page.getByRole("button", { name: "Open another report" }).click();
  const exported = `<!doctype html><html><body><script>window.ran = true</script>` +
    `<script type="application/json" id="md-report">${json().replace(/</g, "\\u003c")}</script></body></html>`;
  await pick(page, "r.html", Buffer.from(exported), "text/html");
  await expect(page.getByRole("heading", { name: "ahmed25-fine-fix" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { ran?: boolean }).ran)).toBeUndefined();
});

test("a dropped file opens, and a wrong one is explained", async ({ page }) => {
  await page.goto("/report");
  const drop = async (name: string, text: string) => {
    const dt = await page.evaluateHandle(([n, t]) => {
      const d = new DataTransfer();
      d.items.add(new File([t], n, { type: "application/json" }));
      return d;
    }, [name, text] as const);
    await page.dispatchEvent("main", "drop", { dataTransfer: dt });
  };
  await drop("notes.json", '{"hello":"world"}');
  await expect(page.getByRole("alert")).toContainText("isn't a Mesh Doctor report");
  await drop("ahmed25-fine-fix.mdreport.json", json());
  await expect(page.getByRole("heading", { name: "ahmed25-fine-fix" })).toBeVisible();
});

test("the home page links to the report viewer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Report viewer" }).click();
  await expect(page).toHaveURL(/\/report$/);
  await expect(page.getByRole("heading", { name: "Report viewer" })).toBeVisible();
  // Section links on other pages go back to the right part of the home page.
  await page.getByRole("navigation", { name: "Site" }).getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/#privacy$/);
  await expect(page.getByRole("heading", { name: "Your meshes never leave your computer" })).toBeInViewport();
});
