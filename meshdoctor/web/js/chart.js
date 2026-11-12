// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The Mesh Doctor authors
//
// MD.chart: the one line chart every page uses (residuals, forces).  Canvas
// only, no library; load it after md.js.
//
//     MD.chart.line(canvas, series, opts)
//         series  [{name, color, pts: [[x, y], ...], dash: true|false}]
//         opts    log      y on a log scale (points with y <= 0 are left out)
//                 clip     drop this fraction of y outliers at each end (0.01 = 1 %)
//                 settle   the first fraction of the x range does not set the y scale (0.1:
//                          a steady run's start-up spike is drawn off the top, not flattening the rest)
//                 band     [x0, x1]  shaded span (the current stage, an averaging window)
//                 marks    [x, ...]  dashed vertical lines (where settings changed)
//                 tip      element   hover tooltip (text only), placed inside the canvas's parent
//                 xlabel   "iteration"   tooltip heading;  xfmt  v => "0.12 s"   x label format
//                 empty    text when there is nothing to draw;  height  CSS px, else the CSS height
//     MD.chart.legend(el, series)    coloured names, dashed for dashed series
//     MD.chart.palette()             the page's --s1..--s6 colours (defaults if a page has none)
//
// The tick and range maths (ticks, decimals, range) are plain functions, tested in tests/js.
(function (root) {
  "use strict";
  const MD = root.MD || (typeof require === "function" ? require("./md.js") : {});
  const fin = v => typeof v === "number" && isFinite(v);

  // "nice" steps: 1, 2 or 5 x 10^n, about n of them across [lo, hi]
  function step(lo, hi, n) {
    const raw = (hi - lo) / Math.max(1, n);
    if (!(raw > 0) || !isFinite(raw)) return 1;
    const mag = 10 ** Math.floor(Math.log10(raw));
    return mag * ([1, 2, 5, 10].find(m => m * mag >= raw * (1 - 1e-9)) || 10);
  }
  function ticks(lo, hi, n) {
    const s = step(lo, hi, n), out = [];
    for (let v = Math.ceil(lo / s - 1e-9) * s; v <= hi + s * 1e-9; v += s) out.push(+v.toPrecision(12) + 0);
    return out;
  }
  // decimals needed to tell ticks `s` apart (s is 1, 2 or 5 x 10^n): 0.05 -> 2, 0.5 -> 1, 5 -> 0
  const decimals = s => Math.max(0, Math.min(10, -Math.floor(Math.log10(s) + 1e-9)));

  // [lo, hi] of the values, outliers clipped, never empty; log: whole decades
  function range(vals, opts) {
    opts = opts || {};
    let v = vals.filter(fin);
    if (opts.log) v = v.filter(x => x > 0).map(Math.log10);
    if (!v.length) return null;
    v.sort((a, b) => a - b);
    let lo = v[0], hi = v[v.length - 1];
    if (opts.clip && v.length > 20) {
      lo = v[Math.floor(v.length * opts.clip)];
      hi = v[Math.ceil(v.length * (1 - opts.clip)) - 1];
    }
    if (opts.log) {
      lo = Math.floor(lo) + 0; hi = Math.ceil(hi) + 0;          // + 0: never -0 (a "1e-0" label)
      if (hi === lo) hi = lo + 1;
      return [lo, hi];
    }
    if (hi === lo) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1; }
    const pad = (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
  }

  // the y values that set the scale: with settle, only those after the first `frac` of the x range
  function settled(pts, frac) {
    const all = pts.map(p => p[1]);
    if (!(frac > 0) || pts.length < 2) return all;
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { lo = Math.min(lo, p[0]); hi = Math.max(hi, p[0]); }
    const cut = lo + frac * (hi - lo), v = pts.filter(p => p[0] >= cut).map(p => p[1]);
    return v.length ? v : all;
  }

  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const DEFAULT = ["#2f6fde", "#e07a1f", "#16a085", "#8e44ad", "#c0392b", "#7f8c8d"];
  const palette = () => DEFAULT.map((d, i) => css("--s" + (i + 1)) || d);

  function line(canvas, series, opts) {
    opts = opts || {};
    if (opts.height) canvas.style.height = opts.height + "px";
    const dpr = root.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext("2d");
    g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
    const muted = css("--muted") || "#888", grid = css("--line") || "#ddd";
    g.font = "11px system-ui, sans-serif"; g.fillStyle = muted;
    const ser = series.map(s => Object.assign({}, s, {
      pts: (s.pts || []).filter(p => Array.isArray(p) && fin(p[0]) && fin(p[1]) && (!opts.log || p[1] > 0)) }));
    const all = ser.flatMap(s => s.pts);
    if (opts.tip) opts.tip.style.display = "none";
    canvas._md = null;
    if (!all.length) {
      g.fillText(opts.empty || "No data yet", 52, H / 2);
      return;
    }
    const xr = range(all.map(p => p[0]));
    let x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0]));
    if (x1 === x0) { x0 = xr[0]; x1 = xr[1]; }
    const [y0, y1] = range(settled(all, opts.settle), { log: opts.log, clip: opts.clip });
    const pad = { l: 52, r: 10, t: 8, b: 24 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const X = x => pad.l + (x - x0) / (x1 - x0) * iw;
    const Y = y => pad.t + (1 - ((opts.log ? Math.log10(y) : y) - y0) / (y1 - y0)) * ih;
    if (opts.band) {
      const a = Math.max(opts.band[0], x0), b = Math.min(opts.band[1], x1);
      if (b > a) { g.fillStyle = css("--track") || "#eee"; g.globalAlpha = .55; g.fillRect(X(a), pad.t, X(b) - X(a), ih); g.globalAlpha = 1; }
    }
    // y grid and labels: whole decades on a log scale, else 1-2-5 steps
    g.strokeStyle = grid; g.lineWidth = 1; g.fillStyle = muted; g.textAlign = "right";
    const yn = Math.max(3, Math.floor(ih / 30));                       // a label about every 30 px
    const yt = opts.log ? ticks(y0, y1, Math.min(y1 - y0, yn)) : ticks(y0, y1, yn);
    const yd = opts.log ? 0 : decimals(step(y0, y1, yn));
    for (const v of yt) {
      const yy = opts.log ? Y(10 ** v) : Y(v);
      g.beginPath(); g.moveTo(pad.l, yy); g.lineTo(W - pad.r, yy); g.stroke();
      g.fillText(opts.log ? "1e" + v : v.toFixed(yd), pad.l - 6, yy + 4);
    }
    // x labels about 70 px apart
    g.textAlign = "left";
    const xn = Math.max(2, Math.floor(iw / 70)), xd = decimals(step(x0, x1, xn));
    for (const v of ticks(x0, x1, xn)) {
      const s = opts.xfmt ? opts.xfmt(v) : v.toFixed(xd), w = g.measureText(s).width;
      g.fillText(s, Math.max(0, Math.min(W - w - 1, X(v) - w / 2)), H - 7);       // edge labels stay inside
    }
    for (const m of opts.marks || []) {
      if (!(m > x0 && m < x1)) continue;
      g.strokeStyle = muted; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(m), pad.t); g.lineTo(X(m), pad.t + ih); g.stroke();
    }
    g.setLineDash([]);
    g.save(); g.beginPath(); g.rect(pad.l, pad.t, iw, ih); g.clip();
    for (const s of ser) {
      if (!s.pts.length) continue;
      g.strokeStyle = s.color; g.lineWidth = s.dash ? 1.3 : 1.6; g.setLineDash(s.dash ? [5, 4] : []);
      g.beginPath();
      s.pts.forEach((p, i) => i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])));
      g.stroke();
    }
    g.setLineDash([]); g.restore();
    canvas._md = { ser, pad, iw, x0, x1, opts };
    if (opts.tip && !canvas._mdHover) {
      canvas._mdHover = true;
      canvas.addEventListener("mousemove", e => hover(canvas, e));
      canvas.addEventListener("mouseleave", () => { const t = canvas._md && canvas._md.opts.tip; if (t) t.style.display = "none"; });
    }
  }

  // tooltip: each series' point nearest the mouse, if within 2 % of the x range
  function hover(canvas, e) {
    const h = canvas._md;
    if (!h || !h.opts.tip) return;
    const tip = h.opts.tip, r = canvas.getBoundingClientRect(), mx = e.clientX - r.left;
    const xv = h.x0 + (mx - h.pad.l) / h.iw * (h.x1 - h.x0), lines = [];
    for (const s of h.ser) {
      let best = null;
      for (const p of s.pts) if (!best || Math.abs(p[0] - xv) < Math.abs(best[0] - xv)) best = p;
      if (best && Math.abs(best[0] - xv) <= (h.x1 - h.x0) * 0.02) lines.push([s.name, best]);
    }
    if (!lines.length) { tip.style.display = "none"; return; }
    const head = document.createElement("div");
    head.style.color = css("--muted");
    const x = lines[0][1][0];
    head.textContent = (h.opts.xlabel || "x") + " " + (h.opts.xfmt ? h.opts.xfmt(x) : MD.fmt.num(x));
    tip.replaceChildren(head, ...lines.map(([n, p]) => {
      const d = document.createElement("div");
      d.textContent = `${n}: ${h.opts.log ? MD.fmt.exp(p[1]) : MD.fmt.num(p[1])}`;
      return d;
    }));
    tip.style.display = "block";
    tip.style.left = Math.max(0, Math.min(mx + 12, canvas.clientWidth - tip.offsetWidth - 4)) + "px";
    tip.style.top = (e.clientY - r.top + canvas.offsetTop - 10) + "px";
  }

  function legend(el, series) {
    el.replaceChildren(...series.map(s => {
      const sp = document.createElement("span");
      sp.style.setProperty("--c", s.color);
      if (s.dash) sp.className = "dash";
      sp.textContent = s.name;
      return sp;
    }));
  }

  const chart = { line, legend, palette, ticks, step, decimals, range, settled };
  MD.chart = chart;
  if (typeof module === "object" && module.exports) module.exports = chart;
})(typeof window !== "undefined" ? window : globalThis);
