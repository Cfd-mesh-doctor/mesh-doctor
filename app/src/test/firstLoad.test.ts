// SPDX-License-Identifier: GPL-3.0-or-later
// What every visit loads before its first page shows: the modules src/main.tsx imports, and theirs, without the pages
// and layouts the router loads when first opened (import() is left out, as is `import type`). The home page is the
// first page of most visits, so this keeps the engine's client, the query library and the demo's recorded data off
// it: they load with the app, the demo, Connect and the report viewer (engine/QueryLayout.tsx).
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** `import … from "x"`, `import "x"` and `export … from "x"` at the start of a line, but not `import type`. */
const IMPORTS = /^(?:import|export)\s+(?!type\b)(?:[^;"']*?\sfrom\s+)?["']([^"']+)["']/gm;

const isFile = (f: string) => existsSync(f) && statSync(f).isFile();

/** The file a module of this app names, or undefined for a package. */
function fileOf(spec: string, from: string): string | undefined {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return undefined;
  const base = spec.startsWith("@/") ? resolve(SRC, spec.slice(2)) : resolve(dirname(from), spec);
  const found = [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")].find(isFile);
  if (!found) throw new Error(`${relative(SRC, from)} imports ${spec}, which isn't there`);
  return found;
}

/** The app's files and the packages loaded with this one. */
function loadedWith(entry: string) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    if (!/\.tsx?$/.test(file)) return;
    for (const [, spec = ""] of readFileSync(file, "utf8").matchAll(IMPORTS)) {
      const next = fileOf(spec, file);
      if (next) visit(next);
      else packages.add(spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/"));
    }
  };
  visit(entry);
  return { files: [...files].map((f) => relative(SRC, f).replace(/\\/g, "/")), packages: [...packages] };
}

describe("what every visit loads first", () => {
  const { files, packages } = loadedWith(resolve(SRC, "main.tsx"));

  it("is the home page and what is around every page, not the pages the router loads when opened", () => {
    expect(files).toEqual(expect.arrayContaining(["App.tsx", "router.tsx", "pages/landing/Landing.tsx", "pages/NotFound.tsx"]));
    expect(packages).toEqual(expect.arrayContaining(["react", "react-dom", "react-router"]));
    for (const page of ["pages/report/Report.tsx", "pages/Connect.tsx", "pages/app/shell.tsx", "pages/docs/Docs.tsx"])
      expect(files).not.toContain(page);
  });

  it("leaves out the query library, the engine's client and the demo's recorded data", () => {
    expect(packages).not.toContain("@tanstack/react-query");
    for (const file of ["engine/hooks.ts", "engine/client.ts", "engine/EngineScope.tsx", "demo/transport.ts", "report/samples/index.ts"])
      expect(files).not.toContain(file);
  });
});
