// SPDX-License-Identifier: GPL-3.0-or-later
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { testReport } from "@/report/testReport";
import { renderScreen } from "@/test/render";
import { Report } from "./Report";

const file = (data: unknown, name = "ahmed25-fine-fix.mdreport.json") =>
  new File([typeof data === "string" ? data : JSON.stringify(data)], name, { type: "application/json" });

describe("Report viewer", () => {
  it("opens a report file and shows what the repair did", async () => {
    renderScreen(<Report />, { path: "/report" });
    expect(screen.getByRole("heading", { name: "Report viewer" })).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText("Choose a report file"), file(testReport()));

    expect(await screen.findByRole("heading", { name: "ahmed25-fine-fix" })).toBeInTheDocument();
    expect(screen.getByText(/mesh ahmed-25-fine · 1,565,115 cells · fix profile/)).toBeInTheDocument();
    expect(screen.getByText(/from ahmed25-fine-fix\.mdreport\.json$/)).toBeInTheDocument();
    expect(document.title).toBe("Report ahmed25-fine-fix · Mesh Doctor");

    const cm = screen.getByRole("row", { name: /Max non-orthogonality/ });
    expect(within(cm).getByText("71.34")).toBeInTheDocument();
    expect(within(cm).getByText("64.91")).toHaveClass("text-success");
    expect(within(screen.getByRole("row", { name: /^Max skewness/ })).getByText("4.105")).toHaveClass("text-danger");

    expect(within(screen.getByRole("row", { name: /^p / })).getByText("0.50×")).toBeInTheDocument();
    expect(screen.getByText(/so the repair helped the solver\./)).toBeInTheDocument();
    expect(screen.getByText("converged")).toBeInTheDocument();
    expect(screen.getByText("lift still drifting slowly")).toBeInTheDocument();
    expect(screen.getByText(/7 folder paths on the worker were replaced/)).toBeInTheDocument();

    // The residual chart starts on p and switches field. It draws once it has measured its width, a render after
    // the report itself: wait for it.
    expect(await screen.findByRole("img", { name: /Initial residual of p per iteration/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Ux" }));
    expect(screen.getByRole("img", { name: /Initial residual of Ux per iteration/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /open another report/i }));
    expect(screen.getByRole("heading", { name: "Report viewer" })).toBeInTheDocument();
  });

  it("shows the repair map when the report has one", async () => {
    // jsdom has no canvas: the card, its controls and its description are what can be checked here
    // (the drawing itself is checked in a real browser, e2e/report.spec.ts).
    const noCanvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    renderScreen(<Report />, { path: "/report" });
    await userEvent.upload(screen.getByLabelText("Choose a report file"), file(testReport({ map: true })));
    expect(await screen.findByText("Where the mesh was repaired")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Side view of the model's wall faces \(x along the flow, z up\), with 4 defects found and repaired and 1 defect left, and the 60 strongest cells/ })).toBeInTheDocument();
    expect(screen.getByText("found and repaired (4)")).toBeInTheDocument();
    expect(screen.getByText("left after the repair (1)")).toBeInTheDocument();
    expect(screen.getByText("Made-up map for the tests.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Top" }));
    expect(screen.getByRole("img", { name: /^Top view of the model's wall faces \(x along the flow, y across\)/ })).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Heat layer" })).getByRole("radio", { name: "None" }));
    expect(screen.getByRole("img", { name: /^Top view/ })).not.toHaveAccessibleName(/heat layer/);
    expect(screen.queryByText(/cells whose residual swung most/)).not.toBeInTheDocument();
    noCanvas.mockRestore();
  });

  it("opens a sample report made from the public Ahmed-body example, named in the address", async () => {
    const { router } = renderScreen(<Report />, { path: "/report" });
    await userEvent.click(screen.getByRole("link", { name: /25° slant, with an A\/B test/ }));
    expect(await screen.findByRole("heading", { name: "ahmed25-medium-fix" })).toBeInTheDocument();
    expect(router.state.location.search).toBe("?sample=ahmed25-medium-fix");
    expect(screen.getByText(/from the public Ahmed-body example \(a sample\)$/)).toBeInTheDocument();
    expect(document.title).toBe("Report ahmed25-medium-fix · Mesh Doctor");
    expect(await screen.findByRole("img", { name: /Initial residual of p per iteration/ })).toBeInTheDocument();

    // "Open another report" leaves the sample, and so does Back.
    await userEvent.click(screen.getByRole("link", { name: "Open another report" }));
    expect(await screen.findByRole("heading", { name: "Report viewer" })).toBeInTheDocument();
    expect(router.state.location.search).toBe("");
    await userEvent.click(screen.getByRole("link", { name: /35° slant, with a repair map/ }));
    expect(await screen.findByRole("heading", { name: "ahmed35-medium-fix" })).toBeInTheDocument();
    await act(() => router.navigate(-1));
    expect(await screen.findByRole("heading", { name: "Report viewer" })).toBeInTheDocument();
  });

  it("draws the original mesh's residuals in dark ink, dashed, apart from the repaired mesh's teal", async () => {
    renderScreen(<Report />, { path: "/report", at: "/report?sample=ahmed25-medium-fix" });
    const chart = await screen.findByRole("img", { name: /Initial residual of p per iteration/ });
    expect(chart.querySelector("path.stroke-foreground")).toHaveAttribute("stroke-dasharray");
    expect(chart.querySelector("path.stroke-primary")).not.toHaveAttribute("stroke-dasharray");
    const legend = screen.getByText("original mesh", { selector: "span" }).querySelector("line");
    expect(legend).toHaveClass("stroke-foreground");
  });

  it("opens a sample straight from a link", async () => {
    renderScreen(<Report />, { path: "/report", at: "/report?sample=ahmed35-medium-fix" });
    expect(await screen.findByRole("heading", { name: "ahmed35-medium-fix" })).toBeInTheDocument();
  });

  it("says when the address names no sample, and offers the ones there are", async () => {
    renderScreen(<Report />, { path: "/report", at: "/report?sample=nope" });
    expect(await screen.findByRole("alert"))
      .toHaveTextContent('There\'s no sample called "nope": the samples are ahmed25-medium-fix and ahmed35-medium-fix.');
    expect(screen.getByRole("link", { name: /35° slant, with a repair map/ })).toHaveAttribute("href", "/report?sample=ahmed35-medium-fix");
  });

  it("opens a dropped file in place of the sample on show", async () => {
    const { router } = renderScreen(<Report />, { path: "/report", at: "/report?sample=ahmed35-medium-fix" });
    expect(await screen.findByRole("heading", { name: "ahmed35-medium-fix" })).toBeInTheDocument();
    const dropped = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropped, "dataTransfer", { value: { types: ["Files"], files: [file(testReport())] } });
    document.dispatchEvent(dropped);
    expect(await screen.findByRole("heading", { name: "ahmed25-fine-fix" })).toBeInTheDocument();
    expect(router.state.location.search).toBe("");
  });

  it("explains a file that isn't a report, and stays ready for another", async () => {
    renderScreen(<Report />, { path: "/report" });
    await userEvent.upload(screen.getByLabelText("Choose a report file"), file({ hello: "world" }, "notes.json"));
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't a Mesh Doctor report");
    await userEvent.upload(screen.getByLabelText("Choose a report file"), file(testReport()));
    expect(await screen.findByRole("heading", { name: "ahmed25-fine-fix" })).toBeInTheDocument();
  });

  it("shows a report without an A/B test", async () => {
    const r = testReport() as { documents: Record<string, unknown>; contents: Record<string, unknown> };
    delete r.documents.abtest;
    delete r.contents.abtest;
    renderScreen(<Report />, { path: "/report" });
    await userEvent.upload(screen.getByLabelText("Choose a report file"), file(r));
    expect(await screen.findByText(/There is no solver A\/B test in this report\./)).toBeInTheDocument();
    expect(screen.queryByText("Did it help the solver?")).not.toBeInTheDocument();
    expect(screen.queryByText("Is the repaired-mesh run converged?")).not.toBeInTheDocument();
    expect(screen.queryByText("Residuals, original vs repaired mesh")).not.toBeInTheDocument();
  });
});
