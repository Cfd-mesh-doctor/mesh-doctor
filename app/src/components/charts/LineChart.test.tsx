// SPDX-License-Identifier: GPL-3.0-or-later
import { render, screen } from "@testing-library/react";
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

  it("says when there is nothing to draw", () => {
    render(<LineChart log label="residuals" empty="No residuals" series={[line("a", [0, null])]} />);
    expect(screen.getByText("No residuals")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
