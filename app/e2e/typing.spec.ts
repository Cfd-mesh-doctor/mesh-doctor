// SPDX-License-Identifier: GPL-3.0-or-later
// The fields whose words live in the address (the Docs and Troubleshooting searches' ?q=, the estimator's fields, the
// app's Cases filter) keep every letter however fast it is typed: a field drawn from the address must not fall behind
// what's typed.
import { expect, test } from "@playwright/test";

test("fast typing keeps every letter in the fields the address holds", async ({ page }) => {
  await page.goto("/docs");
  const docs = page.getByRole("searchbox", { name: "Search all the docs" });
  await docs.pressSequentially("SIGKILL patchField"); // one key after another, with no pause
  await expect(docs).toHaveValue("SIGKILL patchField");
  await expect(page).toHaveURL(/\/docs\?q=SIGKILL\+patchField$/);

  await page.goto("/troubleshooting");
  const problems = page.getByRole("searchbox");
  await problems.pressSequentially("decomposePar");
  await expect(problems).toHaveValue("decomposePar");
  await expect(page).toHaveURL(/\/troubleshooting\?q=decomposePar$/);

  await page.goto("/estimate");
  const cells = page.getByLabel("Mesh size");
  await cells.fill("");
  await cells.pressSequentially("31.25");
  await expect(cells).toHaveValue("31.25");
  await expect(page).toHaveURL(/\/estimate\?cells=31\.25$/);

  await page.goto("/demo/cases");
  const filter = page.getByLabel("Filter cases");
  await filter.pressSequentially("ahmed-25-fine");
  await expect(filter).toHaveValue("ahmed-25-fine");
  await expect(page).toHaveURL(/\/demo\/cases\?q=ahmed-25-fine$/);
});
