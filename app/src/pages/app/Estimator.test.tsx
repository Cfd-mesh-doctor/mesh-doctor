// SPDX-License-Identifier: GPL-3.0-or-later
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Transport } from "@/engine/client";
import { EngineError } from "@/engine/errors";
import { demoTransport } from "@/demo/transport";
import { renderScreen } from "@/test/render";
import { Estimator } from "./Estimator";

const path = "/app/estimate";

/** An engine that answers only GET /machine, with `doc`, or with not-found like an engine before API 1.1. */
function engine(doc?: unknown): Transport {
  return {
    kind: "engine",
    scope: "test",
    request: async <T,>(_m: string, p: string) => {
      if (p === "/machine" && doc) return doc as T;
      throw new EngineError("not-found", `no route ${p}`, 404);
    },
  };
}

describe("the size estimator in the app", () => {
  it("fills in the memory and the cores of the engine's computer", async () => {
    const { router } = renderScreen(<Estimator />, {
      path, transport: engine({ cpus: 16, cores: 8, memoryMb: 26_052, ramLimitMb: null }),
    });
    expect(await screen.findByText(/From your engine's computer: 25\.4 GB of memory and 8 cores\./)).toBeInTheDocument();
    expect(screen.getByLabelText("Memory for OpenFOAM")).toHaveValue("25.4");
    expect(screen.getByLabelText("Solver ranks on this computer")).toHaveValue("8");
    expect(screen.getByLabelText("Mesh size")).toHaveValue("5");
    expect(screen.getByText("1.6 h")).toBeInTheDocument(); // 5 M cells, 1000 iterations on 8 ranks
    expect(document.title).toBe("Size estimator · Mesh Doctor");

    // Typing a field's own value back leaves the address clean; another value goes in it.
    const ranks = screen.getByLabelText("Solver ranks on this computer");
    await userEvent.clear(ranks);
    await userEvent.type(ranks, "6");
    expect(router.state.location.search).toBe("?cores=6");
    await userEvent.click(screen.getByRole("button", { name: /back to this computer/i }));
    expect(router.state.location.search).toBe("");
    expect(screen.getByLabelText("Solver ranks on this computer")).toHaveValue("8");
  });

  it("uses the RAM limit when the engine has a lower one", async () => {
    renderScreen(<Estimator />, { path, transport: engine({ cpus: 8, cores: null, memoryMb: 26_052, ramLimitMb: 20_480 }) });
    expect(await screen.findByText(/20 GB of memory \(its RAM limit\) and 8 cores/)).toBeInTheDocument();
    expect(screen.getByLabelText("Memory for OpenFOAM")).toHaveValue("20");
  });

  it("keeps the example's values for an engine too old to say, and says to update it", async () => {
    renderScreen(<Estimator />, { path, transport: engine() });
    expect(await screen.findByText(/Your engine is older than this page/)).toBeInTheDocument();
    expect(screen.getByText(/Update Mesh Doctor \(git pull\) and restart it/)).toBeInTheDocument();
    expect(screen.getByLabelText("Memory for OpenFOAM")).toHaveValue("26");
    expect(screen.getByLabelText("Solver ranks on this computer")).toHaveValue("6");
  });

  it("in the demo, uses the demo engine's computer", async () => {
    renderScreen(<Estimator />, { path: "/demo/estimate", transport: demoTransport(undefined, 0) });
    expect(await screen.findByText(/From the demo engine's computer: 25 GB of memory and 8 cores\./)).toBeInTheDocument();
    expect(screen.getByLabelText("Memory for OpenFOAM")).toHaveValue("25");
  });

  it("copies a link anyone can open: the site's estimator, with this computer's memory and cores in it", async () => {
    const user = userEvent.setup(); // its clipboard stands in for the browser's
    renderScreen(<Estimator />, {
      path, at: `${path}?cells=31.1`, transport: engine({ cpus: 16, cores: 8, memoryMb: 26_052, ramLimitMb: null }),
    });
    await user.click(await screen.findByRole("button", { name: "Copy link" }));
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/estimate?cells=31.1&ram=25.4&cores=8`);
    // The card says so, as the link isn't this screen's own address.
    expect(screen.getByText(/Copy link gives a link to this estimate that anyone can open\.$/)).toBeInTheDocument();
  });
});
