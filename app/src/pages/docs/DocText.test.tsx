// SPDX-License-Identifier: GPL-3.0-or-later
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { REPO_URL } from "@/lib/site";
import { renderScreen } from "@/test/render";
import { DocText } from "./DocText";
import { docHref } from "./entries";

describe("text as the docs write it", () => {
  it("links another doc to this site's page for it, or to GitHub while the site has none", () => {
    renderScreen(<p><DocText text="See [the fixes](troubleshooting.md#web-app) and [the design](architecture.md)." /></p>);
    expect(screen.getByRole("link", { name: "the fixes" })).toHaveAttribute("href", "/troubleshooting#web-app");
    const design = screen.getByRole("link", { name: "the design" });
    expect(design).toHaveAttribute("href", `${REPO_URL}/blob/main/docs/architecture.md`);
    expect(design).toHaveAttribute("target", "_blank");
    expect(docHref("https://openfoam.org")).toBe("https://openfoam.org");
  });

  it("shows code and bold, and bold that holds code", () => {
    renderScreen(<p><DocText text="Run **`meshdoctor serve`**, then **Try again** (no `-copyZero`)." /></p>);
    const serve = screen.getByText("meshdoctor serve");
    expect(serve.tagName).toBe("CODE");
    expect(serve.parentElement?.tagName).toBe("STRONG");
    expect(screen.getByText("Try again").tagName).toBe("STRONG");
    expect(screen.getByText("-copyZero")).toHaveClass("whitespace-nowrap");
    expect(screen.getByText(/^Run/)).toHaveTextContent("Run meshdoctor serve, then Try again (no -copyZero).");
  });
});
