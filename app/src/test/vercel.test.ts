// SPDX-License-Identifier: GPL-3.0-or-later
// vercel.json's ignoreCommand skips a deploy when nothing the build reads has changed (git diff --quiet over the
// paths after "--"). The build reads app/ and whatever the app's code imports from outside it (the gallery's
// pictures in docs/images), so the command has to watch each of those folders, or a change there alone would
// never go live.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(APP, "src");

/** The app's own code: no tests, and not src/test/, whose helpers read the docs only for the tests. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return dir === SRC && e.name === "test" ? [] : sources(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Folders outside app/ that the code imports from, as paths from app/ (such as "../docs/images"). */
function outside(): string[] {
  const found = new Set<string>();
  for (const file of sources(SRC)) {
    for (const m of readFileSync(file, "utf8").matchAll(/(?:from\s+|import\s*\(?\s*)"(\.{1,2}\/[^"]+)"/g)) {
      const target = resolve(dirname(file), m[1] ?? "");
      if (relative(APP, target).startsWith("..")) found.add(relative(APP, dirname(target)).split(sep).join("/"));
    }
  }
  return [...found].sort();
}

describe("vercel.json", () => {
  const { ignoreCommand } = JSON.parse(readFileSync(join(APP, "vercel.json"), "utf8")) as { ignoreCommand: string };
  const watched = ignoreCommand.split(" -- ")[1]?.trim().split(/\s+/) ?? [];

  it("redeploys when anything the build reads changes: app/ and what its code imports from outside it", () => {
    expect(watched).toContain(".");
    const dirs = outside();
    expect(dirs).toContain("../docs/images"); // the gallery's pictures
    expect(dirs.filter((d) => !watched.some((w) => d === w || d.startsWith(`${w}/`)))).toEqual([]);
  });
});
