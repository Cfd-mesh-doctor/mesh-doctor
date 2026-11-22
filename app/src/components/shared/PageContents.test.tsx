// SPDX-License-Identifier: GPL-3.0-or-later
import { act, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderScreen } from "@/test/render";
import { PageContents } from "./PageContents";

const SECTIONS = [
  { id: "one", title: "One" },
  { id: "two", title: "Two" },
  { id: "three", title: "Three" },
];

/** A page: its list, then the sections it lists. */
function Page({ sections = SECTIONS }: { sections?: { id: string; title: string }[] }) {
  return (
    <>
      <PageContents sections={sections} />
      {SECTIONS.map((s) => <section key={s.id} id={s.id}><h2>{s.title}</h2></section>)}
    </>
  );
}

const saved = {
  scrollHeight: Object.getOwnPropertyDescriptor(document.documentElement, "scrollHeight"),
  scrollY: Object.getOwnPropertyDescriptor(window, "scrollY"),
};
function restore(target: object, name: string, d?: PropertyDescriptor) {
  if (d) Object.defineProperty(target, name, d);
  else Reflect.deleteProperty(target, name);
}
afterEach(() => {
  vi.restoreAllMocks();
  restore(document.documentElement, "scrollHeight", saved.scrollHeight);
  restore(window, "scrollY", saved.scrollY);
});

/** Puts each section's top this far from the window's top (each section 400 px tall), in a page `height` tall scrolled
 *  down `scrollY` (the window is jsdom's 768 px), then lets the list look again after a scroll. */
async function layout(tops: number[], { scrollY = 1000, height = 5000 } = {}) {
  SECTIONS.forEach((s, i) => {
    const top = tops[i] ?? 0;
    vi.spyOn(document.getElementById(s.id) as HTMLElement, "getBoundingClientRect")
      .mockReturnValue({ top, bottom: top + 400 } as DOMRect);
  });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: height });
  Object.defineProperty(window, "scrollY", { configurable: true, value: scrollY });
  await act(async () => {
    window.dispatchEvent(new Event("scroll"));
    await new Promise((done) => requestAnimationFrame(() => done(undefined)));
  });
}

const marked = () => within(screen.getByRole("navigation", { name: "On this page" })).getAllByRole("link")
  .filter((a) => a.getAttribute("aria-current") === "location").map((a) => a.textContent);

describe("the On this page list", () => {
  it("marks nothing before the first section reaches the top bar, then the last section that has", async () => {
    renderScreen(<Page />, { path: "/guide" });
    await layout([300, 700, 1100], { scrollY: 0 });
    expect(marked()).toEqual([]);
    await layout([100, 500, 900]);
    expect(marked()).toEqual(["One"]);
    await layout([-500, 100, 500]);
    expect(marked()).toEqual(["Two"]);
    await layout([-900, -500, 300]);
    expect(marked()).toEqual(["Two"]);
  });

  it("at the end of the page marks the last section, which never reaches the top bar there", async () => {
    renderScreen(<Page />, { path: "/guide" });
    await layout([-900, -500, 300], { scrollY: 4232 });
    expect(marked()).toEqual(["Three"]);
  });

  it("at the end of the page marks the section the address names while it is in the window", async () => {
    renderScreen(<Page />, { path: "/guide", at: "/guide#two" });
    await layout([-900, 200, 600], { scrollY: 4232 });
    expect(marked()).toEqual(["Two"]);
    await layout([-1500, -900, 300], { scrollY: 4232 });
    expect(marked()).toEqual(["Three"]);
  });

  it("marks nothing for sections that aren't on the page", async () => {
    renderScreen(<Page sections={[{ id: "elsewhere", title: "Elsewhere" }]} />, { path: "/guide" });
    await layout([-500, 100, 500]);
    expect(marked()).toEqual([]);
  });

  it("numbers steps read in order, without the number in the link's name", () => {
    renderScreen(<PageContents sections={SECTIONS} numbered />, { path: "/guide" });
    const nav = screen.getByRole("navigation", { name: "On this page" });
    expect(within(nav).getByRole("list").tagName).toBe("OL");
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["01One", "02Two", "03Three"]);
    expect(within(nav).getByRole("link", { name: "Two" })).toHaveAttribute("href", "/guide#two");
  });

  it("keeps the page's query in its links, so following one doesn't undo a search", () => {
    renderScreen(<PageContents sections={SECTIONS} />, { path: "/guide", at: "/guide?q=mesh" });
    const nav = screen.getByRole("navigation", { name: "On this page" });
    expect(within(nav).getByRole("link", { name: "Two" })).toHaveAttribute("href", "/guide?q=mesh#two");
  });
});
