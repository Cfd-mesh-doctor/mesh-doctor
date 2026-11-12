// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The Mesh Doctor authors
//
// The repair-map page (meshmap.html): where the mesh was repaired over where
// the flow does not settle, side and top view.  Reads GET /api/v1/maps and
// /api/v1/maps/{name} (map schema) through MD.api; tooltips and tables are
// built with MD.html, so labels, patch names and notes are always text.
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const { html, render, fmt } = MD;
  const loc = x => fmt.isNum(x) ? x.toLocaleString() : "–";
  let M = null, imgs = {};
  const HEAT = ["#f6d55c", "#f0a93a", "#e8702a", "#d23b3b"];

  function hexToRgb(h) {
    h = h.replace("#", "");
    if (h.length === 3) h = [...h].map(c => c + c).join("");
    const n = parseInt(h, 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function densityImage(v) {
    let raw = "";
    try { raw = atob(v.data); } catch (e) { /* damaged image: draw an empty surface */ }
    const nx = v.nx, ny = v.ny, img = new ImageData(nx, ny), ink = hexToRgb(css("--ink")), bg = hexToRgb(css("--card"));
    // light 3x3 blur so the projected surface reads as a solid shape
    const src = new Float32Array(nx * ny);
    for (let i = 0; i < Math.min(raw.length, src.length); i++) src[i] = raw.charCodeAt(i) / 255;
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length), R = 1;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      let s = 0, c = 0;
      for (let d = -R; d <= R; d++) { const xx = x + d; if (xx >= 0 && xx < nx) { s += src[y * nx + xx]; c++; } }
      tmp[y * nx + x] = s / c;
    }
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      let s = 0, c = 0;
      for (let d = -R; d <= R; d++) { const yy = y + d; if (yy >= 0 && yy < ny) { s += tmp[yy * nx + x]; c++; } }
      out[y * nx + x] = s / c;
    }
    // wall-face density: any surface shows, finely meshed parts (wing, edges) darker
    for (let i = 0; i < out.length; i++) {
      const a = Math.pow(Math.min(1, out[i] * 1.6), 0.6) * 0.55;
      for (let k = 0; k < 3; k++) img.data[4 * i + k] = bg[k] + (ink[k] - bg[k]) * a;
      img.data[4 * i + 3] = 255;
    }
    const c = document.createElement("canvas");
    c.width = nx; c.height = ny;
    c.getContext("2d").putImageData(img, 0, 0);
    return c;
  }

  function draw(which) {
    const v = M[which], cv = $(which === "side" ? "cSide" : "cTop"), tip = $(which === "side" ? "tSide" : "tTop");
    // projection axes come from map.json (x streamwise; up is the ground normal, e.g. y or z)
    const ax = (M.axes && M.axes[which]) || [0, which === "side" ? 1 : 2], ai = ax[0], bi = ax[1];
    const W = cv.clientWidth, H = Math.round(W * (v.hi[1] - v.lo[1]) / (v.hi[0] - v.lo[0]));
    const dpr = devicePixelRatio || 1;
    cv.style.height = H + "px"; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d");
    g.scale(dpr, dpr); g.imageSmoothingEnabled = true;
    if (!imgs[which]) imgs[which] = densityImage(v);
    g.drawImage(imgs[which], 0, 0, W, H);
    const X = x => (x - v.lo[0]) / (v.hi[0] - v.lo[0]) * W, Y = b => (1 - (b - v.lo[1]) / (v.hi[1] - v.lo[1])) * H;
    const marks = [];
    // heat layer
    const L = M.hot[+$("heatSel").value];
    if (L) {
      const n = L.cells.length;
      for (let i = n - 1; i >= 0; i--) {
        const r = L.cells[i], t = 1 - i / n, ci = t > 0.97 ? 3 : t > 0.85 ? 2 : t > 0.6 ? 1 : 0;
        g.fillStyle = HEAT[ci]; g.globalAlpha = 0.35 + 0.6 * t;
        const px = X(r[ai]), py = Y(r[bi]);
        g.beginPath(); g.arc(px, py, 1.2 + 2.2 * t, 0, 7); g.fill();
        if (i < 400) marks.push({ px, py, tip: html`<b>${L.label}</b><br>rank ${i + 1} of ${n} · change score ${fmt.fixed(r[3], 1)}× RMS<br>at ${fmt.xyz(r.slice(0, 3))} m` });
      }
      g.globalAlpha = 1;
    }
    // defects
    const ring = (lst, fill, color, label) => {
      for (const d of lst) {
        const px = X(d.c[ai]), py = Y(d.c[bi]), r = Math.max(2.5, Math.min(8, 1.6 * Math.sqrt(d.n)));
        g.beginPath(); g.arc(px, py, r, 0, 7);
        if (fill) { g.fillStyle = color; g.fill(); g.strokeStyle = css("--card"); g.lineWidth = 1; g.stroke(); }
        else { g.strokeStyle = color; g.lineWidth = 1.4; g.stroke(); }
        const patches = d.patches || [];
        marks.push({ px, py, tip: html`<b>${label}</b><br>${d.n} face(s): ${(d.kinds || []).join(", ")}<br>worst non-ortho ${d.nonOrtho}° · skew ${d.skew}${patches.length ? html`<br>on ${patches.join(", ")}` : ""}<br>at ${fmt.xyz(d.c)} m` });
      }
    };
    if ($("showBefore").checked) ring(M.defectsBefore, false, css("--def"), "Defect found before repair");
    if ($("showAfter").checked) ring(M.defectsAfter, true, css("--left"), "Defect left after repair");
    // axes ticks
    g.fillStyle = css("--muted"); g.font = "11px system-ui";
    for (let x = Math.ceil(v.lo[0] * 2) / 2; x <= v.hi[0]; x += 0.5) g.fillText(x.toFixed(1) + " m", X(x) + 2, H - 4);
    cv.onmousemove = e => {
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = null, bd = 64;
      for (const m of marks) { const d = (m.px - mx) ** 2 + (m.py - my) ** 2; if (d < bd) { bd = d; best = m; } }
      if (!best) { tip.style.display = "none"; return; }
      render(tip, best.tip);
      tip.style.display = "block";
      tip.style.left = Math.min(mx + 12, cv.clientWidth - tip.offsetWidth - 4) + "px";
      tip.style.top = (my + cv.offsetTop + 12) + "px";
    };
    cv.onmouseleave = () => { tip.style.display = "none"; };
  }

  function summary() {
    const b = M.checkMeshBefore || {}, a = M.checkMeshAfter || {};
    const rows = [["Inverted face pyramids", "nWrongPyramids"], ["Bad face tets", "nBadTets"], ["Max non-orthogonality (°)", "maxNonOrtho"],
      ["Max skewness", "maxSkewness"], ["Low-weight faces", "nLowWeight"], ["Small-determinant cells", "nSmallDeterminant"],
      ["Concave cells", "nConcaveCells"], ["Failed checkMesh checks", "failedChecks"]];
    render($("cm"), html`<table><tr><th></th><th>before</th><th>after</th></tr>
      ${rows.map(([l, k]) => html`<tr><td>${l}</td><td>${fmt.sig(b[k])}</td><td class="${b[k] != null && a[k] != null && a[k] < b[k] ? "up" : ""}">${fmt.sig(a[k])}</td></tr>`)}
      <tr><td>Problem clusters (Mesh Doctor)</td><td>${loc(M.defectsBefore.length)}</td><td class="up">${M.defectsAfter.length}</td></tr></table>`);
    const L = M.hot[+$("heatSel").value] || {}, s = L.summary || {};
    // heat legend: same rank bands as draw(): top 3 %, 15 %, 40 % of the plotted cells
    const n = (L.cells || []).length, b1 = Math.round(0.03 * n), b2 = Math.round(0.15 * n), b3 = Math.round(0.40 * n);
    render($("ramp"), n ? html`${[[3, `biggest ${loc(b1)} cells`], [2, `next ${loc(b2 - b1)}`], [1, `next ${loc(b3 - b2)}`], [0, `next ${loc(n - b3)}`]]
      .map(([c, t]) => html`<i style="--c:${HEAT[c]}">${t}</i>`)}` : html``);
    const label = String(L.label || "");
    $("heatLegend").textContent = n ? `The ${loc(n)} cells (of ${loc(+s.nCells || M.nCells || 0)}) whose pressure or velocity changed most` +
      (/400 to 600/.test(label) ? " between iterations 400 and 600 (the slow swing)" : " in one iteration") +
      '. Red = biggest change; bigger dot = bigger change. Pick "none" to hide them.' : "Heat layer hidden.";
    $("heatNote").textContent = label ? `${label}: the top 1 % of cells carry ${fmt.fixed(100 * (+s.shareTop1pct || 0), 0)} % of the change, ` +
      `the top 0.1 % carry ${fmt.fixed(100 * (+s["shareTop0.1pct"] || 0), 0)} %. A broad spread like this is flow unsteadiness; ` +
      "a mesh problem would light up a few cells." : "";
    const P = t => html`<p style="margin:0 0 6px">${t}</p>`;
    render($("read"), html`${P(`Purple rings are where Mesh Doctor found bad cells and fixed them by moving points or, where moving points could not help, ` +
      `collapsing the face (${loc(M.defectsBefore.length)} clusters; ${M.defectsAfter.length} remain, blue). Hover a ring for what was wrong and on which patch.`)}
      ${(M.notes || []).length ? M.notes.map(P) : M.hot.length ? "" :
        P("No heat layer for this mesh yet: a solver A/B run with hotspots adds one, showing where the flow still changes.")}`);
  }

  function headings() {
    const n = "xyz", a = M.axes || { side: [0, 1], top: [0, 2] };
    $("hSide").textContent = `(${n[a.side[0]]} along the flow, ${n[a.side[1]]} up; everything projected onto one plane)`;
    $("hTop").textContent = `(${n[a.top[0]]} along the flow, ${n[a.top[1]]} across)`;
  }
  function draws() {
    for (const w of ["side", "top"]) {
      try { draw(w); } catch (e) { $(w === "side" ? "hSide" : "hTop").textContent = "(this view could not be drawn: " + e.message + ")"; }
    }
  }
  function renderAll() { headings(); summary(); draws(); }

  async function load(name) {
    let d;
    try {
      d = await MD.api.get(["maps", name]);
    } catch (e) {
      $("sub").textContent = e.message;
      return;
    }
    M = d; imgs = {};
    M.hot = M.hot || []; M.defectsBefore = M.defectsBefore || []; M.defectsAfter = M.defectsAfter || [];
    $("sub").textContent = `${d.name} · mesh ${d.source} · ${loc(M.defectsBefore.length)} defect clusters before, ` +
      `${M.defectsAfter.length} after · ${M.hot.length} heat layers`;
    render($("heatSel"), html`${M.hot.map((L, i) => html`<option value="${i}"${i === M.hot.length - 1 ? html` selected` : ""}>${L.label}</option>`)}<option value="-1">none</option>`);
    renderAll();
  }

  ["showBefore", "showAfter", "heatSel"].forEach(id => { $(id).onchange = () => M && renderAll(); });
  window.addEventListener("resize", () => M && renderAll());
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { imgs = {}; if (M) renderAll(); });
  (async () => {
    let l;
    try {
      l = await MD.api.items("/maps");
    } catch (e) {
      $("sub").textContent = e.message;
      return;
    }
    const q = new URLSearchParams(location.search).get("name") || l[0];
    render($("nameSel"), html`${l.map(n => html`<option${n === q ? html` selected` : ""}>${n}</option>`)}`);
    $("nameSel").onchange = e => load(e.target.value);
    if (q) load(q);
    else $("sub").textContent = "No map yet: make one with  meshdoctor map <run>";
  })();
})();
