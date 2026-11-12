// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The Mesh Doctor authors
//
// Tests for the shared chart's tick and range maths (meshdoctor/web/js/chart.js).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const chart = require(path.join(__dirname, "..", "..", "meshdoctor", "web", "js", "chart.js"));

test("ticks are 1, 2 or 5 x 10^n and inside the range", () => {
  assert.deepEqual(chart.ticks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(chart.ticks(-3.2, 47.7, 5), [0, 20, 40]);
  assert.deepEqual(chart.ticks(0, 1325, 6), [0, 500, 1000]);
  assert.deepEqual(chart.ticks(0.1, 0.13, 3), [0.1, 0.11, 0.12, 0.13]);        // no 0.30000000000000004
  assert.deepEqual(chart.ticks(-5, -1, 4), [-5, -4, -3, -2, -1]);              // log decades
  assert.ok(chart.ticks(-1, 0, 1).every(v => !Object.is(v, -0)));              // never a "-0" label
  for (const [lo, hi, n] of [[59.1, 60.3, 5], [-68.9, -68.1, 4], [1e-6, 3e-6, 4], [0, 5000, 7]]) {
    const t = chart.ticks(lo, hi, n), s = chart.step(lo, hi, n);
    assert.ok(t.length >= 1 && t.length <= 2 * n + 1, `${lo}..${hi}: ${t}`);
    assert.ok(t.every(v => v >= lo - 1e-12 && v <= hi + 1e-12), `${lo}..${hi}: ${t}`);
    assert.match(String(s / 10 ** Math.floor(Math.log10(s))), /^(1|2|5)$/);
  }
});

test("decimals tell the ticks apart", () => {
  assert.equal(chart.decimals(5), 0);
  assert.equal(chart.decimals(100), 0);
  assert.equal(chart.decimals(0.5), 1);
  assert.equal(chart.decimals(0.2), 1);
  assert.equal(chart.decimals(0.05), 2);
  assert.equal(chart.decimals(0.001), 3);
});

test("range: padded, outliers clipped, log in whole decades, never empty", () => {
  const [lo, hi] = chart.range([1, 2, 3]);
  assert.ok(Math.abs(lo - 0.88) < 1e-12 && Math.abs(hi - 3.12) < 1e-12);
  assert.deepEqual(chart.range([1e-3, 5e-2, 0, -1, NaN], { log: true }), [-3, -1]);
  assert.deepEqual(chart.range([0.5, 0.7], { log: true }), [-1, 0]);
  assert.deepEqual(chart.range([1e-4], { log: true }), [-4, -3]);
  const [a, b] = chart.range([7, 7]);
  assert.ok(a < 7 && b > 7);
  assert.deepEqual(chart.range([0, 0]).map(v => Math.round(v * 100) / 100), [-1.12, 1.12]);
  assert.equal(chart.range([]), null);
  assert.equal(chart.range([null, "x", Infinity]), null);
  // one spike in 100 points does not set the scale when clipping
  const v = Array.from({ length: 100 }, (_, i) => 60 + (i % 5) * 0.1);
  v[50] = 5000;
  const [c0, c1] = chart.range(v, { clip: 0.01 });
  assert.ok(c1 < 61, `clipped top ${c1}`);
  assert.ok(chart.range(v)[1] > 5000);
});

test("settle: a start-up spike does not set the y scale", () => {
  // a steady run: drag starts near 1500 N for 6 of 100 points, then sits near 60 N
  const pts = Array.from({ length: 100 }, (_, i) => [10 * i, i < 6 ? 1500 - 200 * i : 60 + (i % 5) * 0.1]);
  const [lo, hi] = chart.range(chart.settled(pts, 0.1));
  assert.ok(lo > 55 && hi < 65, `settled ${lo}..${hi}`);
  assert.ok(chart.range(chart.settled(pts, 0))[1] > 1500);                    // off: every point counts
  assert.ok(chart.range(pts.map(p => p[1]), { clip: 0.01 })[1] > 1000);      // why clipping alone is not enough
  assert.deepEqual(chart.settled([[0, 5]], 0.1), [5]);                        // too few points: all of them
  assert.deepEqual(chart.settled([[0, 1], [0, 2]], 0.5), [1, 2]);             // no x range: all of them
});
