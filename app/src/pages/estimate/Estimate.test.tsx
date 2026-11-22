// SPDX-License-Identifier: GPL-3.0-or-later
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderScreen } from "@/test/render";
import { Estimate } from "./Estimate";

describe("Size estimator", () => {
  it("works out the example, follows the fields and keeps them in the address", async () => {
    const { router } = renderScreen(<Estimate />, { path: "/estimate" });
    expect(screen.getByRole("heading", { name: "Size estimator" })).toBeInTheDocument();
    expect(document.title).toBe("Size estimator · Mesh Doctor");
    // The example: 5 M cells, 1000 iterations, 26 GB, 6 ranks, $0.84 an hour.
    expect(screen.getByLabelText("Mesh size")).toHaveValue("5");
    expect(screen.getAllByText("10.5 GB")).toHaveLength(2); // the tile and snappyHexMesh's row
    expect(screen.getByText("2.2 h")).toBeInTheDocument();
    expect(screen.getByText("about 3.3 h, $2.74")).toBeInTheDocument();
    expect(screen.queryAllByText("too big")).toHaveLength(0);

    const cells = screen.getByLabelText("Mesh size");
    await userEvent.clear(cells);
    await userEvent.type(cells, "31.1");
    expect(router.state.location.search).toBe("?cells=31.1");
    expect(screen.getAllByText("too big")).toHaveLength(4);
    expect(screen.getByText(/The solver needs 54\.4 GB, more than 90 % of 26 GB/)).toBeInTheDocument();
    expect(screen.getByText(/ran out of memory: trim the mesh/)).toBeInTheDocument();
    expect(screen.getByText("about 19.0 h, $16")).toBeInTheDocument();

    const ranks = screen.getByLabelText("Solver ranks on this computer");
    await userEvent.clear(ranks);
    await userEvent.type(ranks, "6.5");
    expect(ranks).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter a whole number from 1 to 4,096.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Fill in every field with a number in range");

    await userEvent.click(screen.getByRole("button", { name: /back to the example/i }));
    expect(router.state.location.search).toBe("");
    expect(screen.getByLabelText("Mesh size")).toHaveValue("5");
  });

  it("opens an estimate from a link", () => {
    renderScreen(<Estimate />, { path: "/estimate", at: "/estimate?cells=0.84&iters=300&cores=4" });
    expect(screen.getByLabelText("Mesh size")).toHaveValue("0.84");
    expect(screen.getByLabelText("Iterations")).toHaveValue("300");
    expect(screen.getByText("10 min")).toBeInTheDocument();
    expect(screen.getByText("about 24 min, $0.34")).toBeInTheDocument();
    expect(screen.getByText("0.9 core h")).toBeInTheDocument();
  });

  it("copies a link to the estimate, with the fields that aren't the example's", async () => {
    const user = userEvent.setup(); // its clipboard stands in for the browser's
    renderScreen(<Estimate />, { path: "/estimate", at: "/estimate?iters=1000&cells=31.1" });
    const button = screen.getByRole("button", { name: "Copy link" });
    await user.click(button);
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/estimate?cells=31.1`);
    expect(button).toHaveAccessibleName("Copied");
  });
});
