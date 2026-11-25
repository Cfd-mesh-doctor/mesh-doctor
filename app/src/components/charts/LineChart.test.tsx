// SPDX-License-Identifier: GPL-3.0-or-later
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LineChart, type LineSeries } from "./LineChart";
import { nearest, niceTicks, thin } from "./scale";

const line = (name: string, y: (number | null)[]): LineSeries => ({
  name, stroke: "stroke-primary", swatch: "bg-primary", x: y.map((_, i) => i + 1), y,
});

describe("line chart", () => {
  it("picks round ticks", () => {
    expect(niceTicks(0, 200, 4)).toEqual([0, 50, 100, 150, 200]);
    expect(niceTicks(1, 60, 6)).toEqual([10, 20, 30, 40, 50, 60]);
    expect(niceTicks(0.1, 0.35, 5)).toEqual([0.1, 0.15, 0.2, 0.25, 0.3, 0.35]);
    expect(niceTicks(5, 5, 4)).toEqual([5]);
  });

  it("gives two ticks or more when asked for two, as a phone's narrow axis asks: the next finer round step", () => {
    // a transient run's time steps of 20 µs to 0.0005 s: a step of 0.0005 left only 0.0005 inside
    expect(niceTicks(2e-5, 5e-4, 2)).toEqual([2e-4, 4e-4]);
    // a steady run of 300 iterations: a step of 200 left only 200
    expect(niceTicks(1, 300, 2)).toEqual([100, 200, 300]);
    expect(niceTicks(1, 9, 2)).toEqual([2, 4, 6, 8]);
    expect(niceTicks(0.6, 1.4, 2)).toEqual([0.6, 0.8, 1, 1.2, 1.4]);
    expect(niceTicks(0.95, 1.05, 2)).toEqual([0.95, 1, 1.05]);
    // where the round step leaves two already, or one is asked for, as before
    expect(niceTicks(0, 0.2088, 2)).toEqual([0, 0.2]);
    expect(niceTicks(0, 2000, 2)).toEqual([0, 1000, 2000]);
    expect(niceTicks(2e-5, 5e-4, 1)).toEqual([5e-4]);
    // at the far end of a number's precision it still ends, with a thousand at most
    for (const [lo, hi] of [[1, 1 + 2 ** -52], [1e300, 1.0000000000000002e300], [0, 1e-300]] as const) {
      const t = niceTicks(lo, hi, 2);
      expect(t.length).toBeGreaterThan(0);
      expect(t.length).toBeLessThanOrEqual(1000);
    }
  });

  it("thins long histories but keeps each column's spikes", () => {
    const pts: [number, number][] = Array.from({ length: 1000 }, (_, i) => [i, i === 503 ? 99 : 1]);
    const out = thin(pts, 100);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).toContainEqual([503, 99]);
    expect(out.map((p) => p[0])).toEqual([...out.map((p) => p[0])].sort((a, b) => a - b));
    expect(thin(pts.slice(0, 50), 100)).toHaveLength(50);
  });

  it("finds the point nearest a position", () => {
    const pts: [number, number][] = [[1, 5], [2, 6], [10, 7]];
    expect([nearest(pts, 0), nearest(pts, 2.4), nearest(pts, 7), nearest([], 1)]).toEqual([[1, 5], [2, 6], [10, 7], null]);
  });

  it("draws one line per series, on a log scale without zeros or gaps", () => {
    const { container } = render(
      <LineChart log label="residuals" series={[line("a", [1, 0.1, null, 0.01]), line("b", [1, 0, 0.5, 0.2])]} />,
    );
    expect(screen.getByRole("img", { name: "residuals" })).toBeInTheDocument();
    const paths = [...container.querySelectorAll("path")].map((p) => p.getAttribute("d") ?? "");
    expect(paths).toHaveLength(2);
    expect(paths.map((d) => d.split(/[ML]/).filter(Boolean).length)).toEqual([3, 3]);
    expect(screen.getByText("1e-2")).toBeInTheDocument();
  });

  it("writes its x axis as asked, and keeps the label at its right end inside the chart", () => {
    const s: LineSeries = {
      name: "p", stroke: "stroke-primary", swatch: "bg-primary", x: [1e-4, 2e-4, 3e-4, 4e-4, 5e-4], y: [1, 2, 3, 2, 1],
    };
    const view = render(<LineChart label="p over time" series={[s]} />);
    expect(screen.getByText("5.000e-4")).toBeInTheDocument();                 // formatNumber's
    view.unmount();
    const seconds = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 });
    render(<LineChart label="p over time" series={[s]} xFormat={(x) => seconds.format(x)} />);
    expect(screen.queryByText(/e-4$/)).toBeNull();
    // 640 px wide (no layout in tests): the first label at its tick, the last moved left of the right end's (626)
    expect(Number(screen.getByText("0.0001").getAttribute("x"))).toBe(50);
    const last = Number(screen.getByText("0.0005").getAttribute("x"));
    expect(last).toBeLessThan(626);
    expect(last + 3.3 * "0.0005".length).toBeLessThanOrEqual(639);
  });

  it("shades the part from a band's x on, with its name above it, and draws none past the end", () => {
    const view = render(<LineChart label="drag" series={[line("a", [1, 2, 3, 2, 1])]} band={{ from: 3, label: "averaged" }} />);
    // 640 px wide (no layout in tests), x from 1 to 5 over 576 px from 50: 3 is at 338, and the band ends at 626
    const name = screen.getByText("averaged");
    const rect = name.previousElementSibling!;
    expect([rect.tagName, rect.getAttribute("x"), rect.getAttribute("width")]).toEqual(["rect", "338", "288"]);
    // its name above the plot, which starts 14 px lower for it (at 24), so that no line crosses it: the top point
    // (3, at 338) is drawn at the plot's top, below the name's baseline
    expect([rect.getAttribute("y"), name.getAttribute("y")]).toEqual(["24", "20"]);
    expect(view.container.querySelector("path")!.getAttribute("d")).toContain("L338.0 24.0");
    view.unmount();
    render(<LineChart label="drag" series={[line("a", [1, 2, 3, 2, 1])]} band={{ from: 6, label: "averaged" }} />);
    expect(screen.queryByText("averaged")).toBeNull();
  });

  it("shades a band up to its end, with edges that move by the keys or the pointer and say where they were let go", () => {
    const moved: [number, number | null][] = [];
    const onChange = (from: number, to: number | null) => { moved.push([from, to]); };
    const series = [line("a", [1, 2, 3, 2, 1])];
    const chart = (from: number, to: number | null) => (
      <LineChart label="drag" series={series} band={{ from, to, label: "averaged", onChange }} />
    );
    const view = render(chart(2, 4));
    // x from 1 to 5 over 576 px from 50: 2 is at 194 and 4 at 482
    const rect = screen.getByText("averaged").previousElementSibling!;
    expect([rect.getAttribute("x"), rect.getAttribute("width")]).toEqual(["194", "288"]);
    const start = screen.getByRole("slider", { name: "Start of the averaged part" });
    const end = screen.getByRole("slider", { name: "End of the averaged part" });
    expect([start.getAttribute("aria-valuenow"), end.getAttribute("aria-valuenow")]).toEqual(["2", "4"]);

    // a key moves its edge to the next point, and letting go of it says where, once
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(start).toHaveAttribute("aria-valuenow", "3");
    expect(moved).toEqual([]);
    fireEvent.keyUp(start, { key: "ArrowRight" });
    expect(moved).toEqual([[3, 4]]);
    // never onto or past the other edge
    fireEvent.keyDown(start, { key: "ArrowRight" });
    fireEvent.keyUp(start, { key: "ArrowRight" });
    expect(start).toHaveAttribute("aria-valuenow", "3");
    expect(moved).toEqual([[3, 4]]);
    // the band given anew ends the move; End takes the end to the last point, which is up to the end: null
    view.rerender(chart(3, 4));
    fireEvent.keyDown(end, { key: "End" });
    fireEvent.keyUp(end, { key: "End" });
    expect(moved.at(-1)).toEqual([3, null]);

    // dragged: from 3 (at 338) to 2 (at 194), only while a button is down; let go, it says so
    view.rerender(chart(3, null));
    expect(end).toHaveAttribute("aria-valuenow", "5");
    fireEvent.pointerDown(start, { pointerId: 1, buttons: 1, clientX: 338 });
    fireEvent.pointerMove(start, { pointerId: 1, buttons: 1, clientX: 200 });
    expect(start).toHaveAttribute("aria-valuenow", "2");
    fireEvent.pointerMove(start, { pointerId: 1, buttons: 0, clientX: 60 });
    expect(start).toHaveAttribute("aria-valuenow", "2");
    fireEvent.pointerUp(start, { pointerId: 1 });
    expect(moved.at(-1)).toEqual([2, null]);
    // a key move is let go of by leaving the edge, too
    view.rerender(chart(2, null));
    fireEvent.keyDown(end, { key: "ArrowLeft", shiftKey: true });
    fireEvent.focusOut(end);
    expect(moved.at(-1)).toEqual([2, 4]);
    expect(moved).toHaveLength(4);

    // without onChange, no edges to move
    view.unmount();
    render(<LineChart label="drag" series={series} band={{ from: 2, label: "averaged" }} />);
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("fits its y axis to the lines from yFrom on, cutting what came before at the plot's edges", () => {
    const series = [line("a", [100, 2, 3, 2, 1])];
    const yTicks = (c: HTMLElement) => [...c.querySelectorAll('text[text-anchor="end"]')].map((t) => t.textContent);
    const view = render(<LineChart label="drag" series={series} yFrom={2} />);
    expect(yTicks(view.container).at(-1)).toBe("3");
    const cut = view.container.querySelector("g[clip-path]")!;
    expect(cut.querySelector("path")).not.toBeNull();
    expect(view.container.querySelector(`clipPath[id="${cut.getAttribute("clip-path")!.slice(5, -1)}"] rect`)).not.toBeNull();
    // past every line's end: fits them all, as without; and without, nothing is cut
    view.unmount();
    const all = render(<LineChart label="drag" series={series} yFrom={9} />);
    expect(yTicks(all.container).at(-1)).toBe("100");
    all.unmount();
    const plain = render(<LineChart label="drag" series={series} />);
    expect(plain.container.querySelector("[clip-path]")).toBeNull();
  });

  it("says when there is nothing to draw", () => {
    render(<LineChart log label="residuals" empty="No residuals" series={[line("a", [0, null])]} />);
    expect(screen.getByText("No residuals")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
