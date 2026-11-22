// SPDX-License-Identifier: GPL-3.0-or-later
// The install page's commands must stay the README's, so the page can't quietly fall behind the scripts.
import { describe, expect, it } from "vitest";
import { markdownCode, readRepo } from "@/test/markdown";
import { DOCKER, LINUX, SETUP, WSL_INSTALL, type CommandGroup } from "./commands";

const readme = readRepo("README.md");
const blocks = markdownCode(readme);
/** A code line split into its command and its trailing comment ("./Allwmake   # builds ..."). */
const split = (line: string) => {
  const m = /^(.*?)\s+#\s+(.*)$/.exec(line);
  return m ? { command: (m[1] ?? "").trim(), note: m[2] } : { command: line.trim() };
};
const block = (has: string) => {
  const found = blocks.find((b) => b.some((line) => line.startsWith(has)));
  if (!found) throw new Error(`no README code block with ${has}`);
  return found.filter((line) => line.trim() !== "");
};

describe("the install commands", () => {
  it("are the README's one-command set-ups", () => {
    const lines = blocks.flat().map((line) => split(line).command);
    expect(lines).toContain(SETUP.windows);
    expect(lines).toContain(SETUP.linux);
  });

  it("are the README's Linux steps, in order, with its comments", () => {
    const groups: CommandGroup[] = [];
    for (const line of block(". /opt/openfoam14/etc/bashrc")) {
      if (line.startsWith("# ")) groups.push({ title: line.slice(2), commands: [] });
      else groups.at(-1)?.commands.push(split(line));
    }
    expect(LINUX).toEqual(groups);
  });

  it("are the README's Docker commands and WSL install", () => {
    expect(DOCKER).toEqual(block("docker build"));
    expect(readme).toContain(`\`${WSL_INSTALL}\``);
  });
});
