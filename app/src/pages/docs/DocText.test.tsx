// SPDX-License-Identifier: GPL-3.0-or-later
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { REPO_URL } from "@/lib/site";
import { renderScreen } from "@/test/render";
import { DocText } from "./DocText";
import { docHref } from "./entries";

describe("text as the docs write it", () => {
  it("links another doc to this site's page for it, or to GitHub while the site has none", () => {
    // Every doc has a page now; a future one without a page opens on GitHub.
    renderScreen(<p><DocText text="See [the fixes](troubleshooting.md#web-app) and [the plan](roadmap.md)." /></p>);
    expect(screen.getByRole("link", { name: "the fixes" })).toHaveAttribute("href", "/troubleshooting#web-app");
    const plan = screen.getByRole("link", { name: "the plan" });
    expect(plan).toHaveAttribute("href", `${REPO_URL}/blob/main/docs/roadmap.md`);
    expect(plan).toHaveAttribute("target", "_blank");
    expect(docHref("https://openfoam.org")).toBe("https://openfoam.org");
  });

  it("shows code and bold, and bold that holds code", () => {
    renderScreen(<p><DocText text="Run **`meshdoctor serve`**, then **Try again** (no `-copyZero`)." /></p>);
    const serve = screen.getByText("meshdoctor serve");
    expect(serve.tagName).toBe("CODE");
    expect(serve.parentElement?.tagName).toBe("STRONG");
    expect(screen.getByText("Try again").tagName).toBe("STRONG");
    expect(screen.getByText("-copyZero").tagName).toBe("CODE");
    expect(screen.getByText(/^Run/)).toHaveTextContent("Run meshdoctor serve, then Try again (no -copyZero).");
  });

  it("keeps what's written against code with it, so a line doesn't break between them", () => {
    renderScreen(<p><DocText text="Start it (`meshdoctor serve`), then **Try again**; or `pair`'s link. A `b` c." /></p>);
    expect(screen.getByText("meshdoctor serve").parentElement).toHaveTextContent(/^\(meshdoctor serve\),$/);
    expect(screen.getByText("meshdoctor serve").parentElement).toHaveClass("code-box");
    expect(screen.getByText("pair").parentElement).toHaveTextContent(/^pair's$/);
    expect(screen.getByText("b").parentElement?.tagName).toBe("P"); // spaces on both sides: nothing to keep
    expect(screen.getByText(/^Start it/)).toHaveTextContent("Start it (meshdoctor serve), then Try again; or pair's link. A b c.");
  });

  it("shows code written in double backticks, which may hold a backtick", () => {
    renderScreen(<p><DocText text="A tag: ``MD.html`<b>${name}</b>` ``. Then `MD.render`." /></p>);
    expect(screen.getByText("MD.html`<b>${name}</b>`").tagName).toBe("CODE");
    expect(screen.getByText("MD.render").tagName).toBe("CODE");
  });

  it("shows italics, but leaves a star in code or between spaces as it is", () => {
    renderScreen(<p><DocText text="Switch between *before* and *after*: `processor*/0` and `postProcessing/*/0/*.dat`, 2 * 3 * 4." /></p>);
    expect(screen.getByText("before").tagName).toBe("EM");
    expect(screen.getByText("after").tagName).toBe("EM");
    expect(screen.getByText("processor*/0").tagName).toBe("CODE");
    expect(screen.getByText("postProcessing/*/0/*.dat").tagName).toBe("CODE");
    expect(screen.getByText(/^Switch/)).toHaveTextContent(
      "Switch between before and after: processor*/0 and postProcessing/*/0/*.dat, 2 * 3 * 4.",
    );
  });
});
