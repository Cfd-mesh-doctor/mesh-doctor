// SPDX-License-Identifier: GPL-3.0-or-later
// The Troubleshooting page states the doc's problems and fixes: they must match the doc they come from.
import { describe, expect, it } from "vitest";
import { EngineError, explain, type ErrorCode } from "@/engine/errors";
import { column } from "@/lib/docTable";
import { BROWSERS } from "@/lib/site";
import { markdownTables, readDoc } from "@/test/markdown";
import { GROUPS } from "./problems";

const DOC = readDoc("troubleshooting.md");

/** Every code the app explains, once each: one missing or unknown fails the typecheck. */
const CODES: Record<ErrorCode, true> = {
  "bad-request": true, busy: true, exists: true, finished: true, forbidden: true, internal: true,
  "method-not-allowed": true, "not-enough-memory": true, "not-found": true, "not-ready": true, "schema-version": true,
  "too-large": true, unavailable: true, unsupported: true, "unsupported-media-type": true,
  unreachable: true, "permission-denied": true, timeout: true, "bad-response": true, incompatible: true, aborted: true,
};

describe("the Troubleshooting page's problems", () => {
  it("are the tables of docs/troubleshooting.md, cell for cell, under its headings", () => {
    expect(markdownTables(DOC)).toEqual(GROUPS.map((g) => g.table));
    expect([...DOC.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(GROUPS.map((g) => g.title));
  });

  it("use the anchors GitHub gives the doc's headings, so a link to a group works on both", () => {
    const github = (title: string) => title.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s/g, "-");
    expect(GROUPS.map((g) => g.id)).toEqual(GROUPS.map((g) => github(g.title)));
  });

  it("quote the web app's messages as the app words them: the errors whose panel links here, and no others", () => {
    const web = GROUPS.find((g) => g.id === "web-app");
    const quoted = column(web!.table, "You see").flatMap((seen) => /^"(.+)"$/.exec(seen)?.slice(1) ?? []);
    expect(quoted).toHaveLength(4);
    const errors = [
      ...Object.keys(CODES).map((code) => new EngineError(code as ErrorCode, "what the engine said")),
      new EngineError("forbidden", "forbidden: missing or wrong pairing key (pair again: meshdoctor pair)", 403),
    ];
    const linked = errors.map((e) => explain(e)).filter((x) => x.troubleshooting).map((x) => x.title);
    expect(linked.sort()).toEqual(quoted.sort());
  });

  it("say where to start an engine that isn't answering, on Linux as well as in WSL", () => {
    const web = GROUPS.find((g) => g.id === "web-app");
    const down = web!.table.rows.find((row) => row[0] === "\"The engine isn't answering\"");
    expect(down?.[2]).toMatch(/^start it with `meshdoctor serve` in WSL or a Linux terminal, then \*\*Try again\*\*; /);
  });

  it("send Safari users to the browsers the site names (the pairing page, the home page)", () => {
    const web = GROUPS.find((g) => g.id === "web-app");
    const safari = web!.table.rows.find((row) => row[0] === "Safari never connects");
    expect(safari?.[2]).toBe(`use ${BROWSERS}`);
  });
});
