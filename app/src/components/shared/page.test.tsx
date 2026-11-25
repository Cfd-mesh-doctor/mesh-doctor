// SPDX-License-Identifier: GPL-3.0-or-later
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CamelCaseName } from "./page";

describe("a camelCase name", () => {
  it("offers a break where each of its words starts, and reads as it is", () => {
    const { container } = render(<p><CamelCaseName name="forceCoeffs2Wing" /> <CamelCaseName name="body" /></p>);
    const p = container.querySelector("p")!;
    expect(p.textContent).toBe("forceCoeffs2Wing body");
    const breaks = [...p.childNodes].map((n) => (n.nodeName === "WBR" ? "|" : n.textContent)).join("");
    expect(breaks).toBe("force|Coeffs2|Wing body");
  });
});
