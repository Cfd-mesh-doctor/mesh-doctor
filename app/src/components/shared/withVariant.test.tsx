// SPDX-License-Identifier: GPL-3.0-or-later
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { withVariant } from "./withVariant";

const shown = (text: string, variant: string | null) => render(<p>{withVariant(text, variant)}</p>).container.firstElementChild!;

describe("a variant's name in running text", () => {
  it("is in the mono font wherever it stands as a word, and the text reads as before", () => {
    const p = shown("With lts settings the residuals end lower, so the lts settings helped the solver.", "lts");
    expect(p).toHaveTextContent("With lts settings the residuals end lower, so the lts settings helped the solver.");
    expect([...p.querySelectorAll("code")].map((c) => c.textContent)).toEqual(["lts", "lts"]);
    expect(shown("The case's settings vs lts", "lts").querySelector("code")).toHaveTextContent(/^lts$/);
  });

  it("leaves it alone inside a longer name, and a text without it, or without a variant, as it is", () => {
    expect(shown("wing_lts · lts-2 · xlts · ltsx", "lts").querySelector("code")).toBeNull();
    expect(shown("Solving on the repaired mesh", "lts").querySelector("code")).toBeNull();
    expect(shown("The repair helped the solver", null).querySelector("code")).toBeNull();
  });

  it("takes a name with a regular expression's characters as it is", () => {
    const p = shown("Solving with k.e+ settings, not kxe", "k.e+");
    expect([...p.querySelectorAll("code")].map((c) => c.textContent)).toEqual(["k.e+"]);
  });
});
