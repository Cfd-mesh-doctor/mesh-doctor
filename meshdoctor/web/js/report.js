// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The Mesh Doctor authors
//
// The report viewer (web/report.html): shows a Mesh Doctor report bundle
// (meshdoctor report <name>).  Load after md.js and chart.js.
//
// The report comes from one of three places:
//   * inside the page: `meshdoctor report <name> --html` (or `--viewer`) inlines
//     md.js, chart.js and this file, so the export is one file;
//   * the dashboard: /report?name=<run> reads GET /api/v1/repairs/{name}/report;
//   * a file the viewer picks or drops: .mdreport.json, .json.gz or an exported .html.
// It never sends the report anywhere.  Everything from the file is shown as text:
// markup is made only by MD.html, which escapes every value.
(function () {
  "use strict";
  const { html, render, fmt, chart } = MD;
  const $ = id => document.getElementById(id);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const isNum = fmt.isNum, num = fmt.num;
  const base = p => typeof p === "string" ? p.split("/").pop() : "";
  const obj = x => x && typeof x === "object" && !Array.isArray(x) ? x : {};
  const arr = x => Array.isArray(x) ? x : [];
  const cls = (r, good, bad) => r < good ? "up" : r > bad ? "down" : "";

  let R = null, map = null, mapImgs = {}, FROM = "";

  // ---------------------------------------------------------------- loading
  function fail(msg) { $("err").textContent = msg; $("drop").hidden = false; }
  function show(rep, from) {
    if (!rep || rep.kind !== "meshdoctor-report") throw new Error("This is not a Mesh Doctor report.");
    const major = String(rep.schemaVersion || "").split(".")[0];
    if (major !== "1") throw new Error(`This report was made by a newer Mesh Doctor (report version ${rep.schemaVersion}); this viewer reads version 1.`);
    if (!rep.documents || !rep.documents.repair) throw new Error("The report has no repair result.");
    R = rep; map = rep.documents.map || null; mapImgs = {}; FROM = from || "";
    $("err").textContent = ""; $("drop").hidden = true; $("report").hidden = false; $("another").hidden = false;
    draw();
  }
  async function readFile(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let text;
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      if (!("DecompressionStream" in window)) throw new Error("This browser cannot open .gz files; open the .json report instead.");
      text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    } else text = new TextDecoder().decode(buf);
    if (/^\s*</.test(text)) {
      // an exported .html report: take the data inside.  DOMParser makes an inert
      // document (its scripts never run); only the slot's text is read.
      const doc = new DOMParser().parseFromString(text, "text/html"), slot = doc.getElementById("md-report");
      if (!slot || !slot.textContent.trim()) throw new Error("This HTML file has no report inside.");
      text = slot.textContent;
    }
    let rep;
    try { rep = JSON.parse(text); } catch (e) { throw new Error("The file is not valid JSON."); }
    show(rep, file.name);
  }
  const openFile = file => readFile(file).catch(e => fail(e.message));
  $("file").addEventListener("change", e => e.target.files[0] && openFile(e.target.files[0]));
  $("another").addEventListener("click", () => { $("report").hidden = true; $("drop").hidden = false; $("file").value = ""; });
  for (const t of ["dragenter", "dragover"]) document.addEventListener(t, e => { e.preventDefault(); $("drop").classList.add("over"); });
  for (const t of ["dragleave", "drop"]) document.addEventListener(t, e => { e.preventDefault(); $("drop").classList.remove("over"); });
  document.addEventListener("drop", e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) openFile(f); });

  // ---------------------------------------------------------------- summary
  const CM = [["nWrongPyramids", "Inverted face pyramids"], ["nBadTets", "Bad face tets"],
    ["maxNonOrtho", "Max non-orthogonality (°)"], ["avgNonOrtho", "Mean non-orthogonality (°)"],
    ["nSevereNonOrtho", "Severely non-orthogonal faces"], ["maxSkewness", "Max skewness"], ["nSkew", "Highly skewed faces"],
    ["nLowWeight", "Low-weight faces"], ["minWeight", "Min face weight"], ["nSmallDeterminant", "Small-determinant cells"],
    ["minDeterminant", "Min cell determinant"], ["nConcaveCells", "Concave cells"], ["nLowVolRatio", "Low volume-ratio faces"],
    ["minVolRatio", "Min volume ratio"], ["failedChecks", "Failed checkMesh checks"]];
  const label = k => (CM.find(r => r[0] === k) || [k, k])[1];

  const ratios = ab => Object.entries(obj(ab && ab.residualRatioFixedOverBase)).filter(([, v]) => isNum(v) && v > 0);
  const geomean = xs => xs.length ? Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length) : null;
  const tile = (name, value, note, c) =>
    html`<div class="tile"><div class="n">${name}</div><div class="v ${c || ""}">${value}</div>${note ? html`<div class="n">${note}</div>` : ""}</div>`;

  function draw() {
    const d = R.documents, rep = d.repair, ab = d.abtest || null, v = obj(rep.verdict);
    const imp = arr(v.improved), reg = arr(v.regressions), same = arr(v.unchanged);
    const cb = arr(rep.clustersBefore).length, ca = arr(rep.clustersAfter).length;
    document.title = `Mesh Doctor report: ${R.name}`;
    $("title").textContent = `Mesh Doctor report: ${R.name}`;
    const lay = obj(rep.layout);
    $("sub").textContent = [base(rep.source) && `mesh ${base(rep.source)}`, isNum(lay.nCells) && `${lay.nCells.toLocaleString()} cells`,
      rep.profile && `${rep.profile} profile`, rep.finished && `repaired ${rep.finished}`, FROM && `from ${FROM}`].filter(Boolean).join(" · ");

    const rs = ratios(ab), g = geomean(rs.map(x => x[1])), sc = obj(rep.sourceCheck);
    render($("tiles"), html`${[
      tile("checkMesh measures improved", String(imp.length), `${same.length} unchanged`, imp.length ? "good" : ""),
      tile("Measures made worse", String(reg.length), reg.length ? reg.join(", ") : "none", reg.length ? "bad" : "good"),
      tile("Problem clusters", `${cb.toLocaleString()} → ${ca.toLocaleString()}`, "before → after the repair", ca < cb ? "good" : ""),
      tile("Largest point move", isNum(rep.maxDisplacement_m) ? `${num(rep.maxDisplacement_m * 1000, 3)} mm` : "–", "inside the mesh; CAD untouched"),
      ab && tile("Residuals, repaired ÷ original", g ? `${g.toFixed(2)}×` : "–", "geometric mean over fields; below 1 is better",
        g ? (g < 0.98 ? "good" : g > 1.02 ? "bad" : "") : ""),
      tile("Source case", sc.unchanged === true ? "unchanged" : sc.unchanged === false ? "CHANGED" : "–", "checked by fingerprint",
        sc.unchanged === true ? "good" : sc.unchanged === false ? "bad" : "")]}`);

    let txt = reg.length ? `The repair improved ${imp.length} checkMesh measure(s) but made ${reg.length} worse (${reg.join(", ")}).`
                         : `The repair improved ${imp.length} checkMesh measure(s) and made none worse.`;
    txt += ` Problem clusters went from ${cb.toLocaleString()} to ${ca.toLocaleString()}.`;
    if (ab && rs.length) {
      const lo = Math.min(...rs.map(x => x[1])), hi = Math.max(...rs.map(x => x[1]));
      txt += ` In the solver test, the repaired mesh's residuals are ${lo.toFixed(2)}–${hi.toFixed(2)}× those of the original mesh` +
        (g < 0.98 ? ", so the repair helped the solver." : g > 1.02 ? ", so the solver did not benefit." : ", about the same.");
    } else if (!ab) txt += " There is no solver A/B test in this report.";
    $("verdict").textContent = txt;
    render($("chips"), html`${imp.map(k => html`<span class="chip up">▲ ${label(k)}</span>`)}${
      reg.map(k => html`<span class="chip down">▼ ${label(k)}</span>`)}${same.map(k => html`<span class="chip">${label(k)}</span>`)}`);

    // each section on its own: a damaged part of the file costs that card, not the page
    section("cm", () => checkMesh(rep, imp, reg));
    section("ab", () => abTable(ab));
    section("hist", () => history(ab));
    section("judge", () => judge(ab));
    $("mapCard").hidden = !map;
    if (map) section("mapHead", setupMap);
    section("about", about);
  }
  function section(id, fn) {
    try { fn(); } catch (e) {
      const card = $(id).closest(".card"), msg = document.createElement("div");
      card.hidden = false;
      msg.className = "err";
      msg.textContent = "This part of the report could not be shown: " + e.message;
      card.append(msg);
    }
  }

  function checkMesh(rep, imp, reg) {
    const b = obj(rep.checkMeshBefore), a = obj(rep.checkMeshAfter);
    const keys = [...CM.map(r => r[0]).filter(k => k in b || k in a), ...Object.keys({ ...b, ...a }).filter(k => !CM.some(r => r[0] === k))];
    const rows = keys.filter(k => isNum(b[k]) || isNum(a[k])).map(k =>
      html`<tr><td>${label(k)}</td><td>${num(b[k])}</td><td class="${imp.includes(k) ? "up" : reg.includes(k) ? "down" : ""}">${num(a[k])}</td></tr>`);
    render($("cm"), html`<table><tr><th></th><th>before</th><th>after</th></tr>${rows}</table>`);
    $("cmNote").textContent = "Green: better after the repair; red: worse. Counts and maxima should go down, minima up.";
  }

  function abTable(ab) {
    $("abCard").hidden = !ab;
    if (!ab) return;
    const b = obj(ab.base), f = obj(ab.fixed), rs = ratios(ab);
    $("abMeta").textContent = [`${num(ab.iters)} iterations`, ab.init != null && `from ${ab.init}`, isNum(ab.nProcs) && `${ab.nProcs} ranks`,
      ab.variant ? `second run with ${ab.variant} settings` : "same settings on both meshes",
      arr(ab.extensions).length && `continued ${arr(ab.extensions).length}×`, ab.finished && `finished ${ab.finished}`].filter(Boolean).join(" · ");
    const rows = rs.map(([k, r]) => {
      const w = Math.min(50, Math.abs(r - 1) * 100), col = r < 0.98 ? "var(--ok)" : r > 1.02 ? "var(--err)" : "var(--muted)";
      const mb = obj(obj(b.residuals)[k]).mean, mf = obj(obj(f.residuals)[k]).mean;
      return html`<tr><td>${k}</td><td>${num(mb, 3)}</td><td>${num(mf, 3)}</td><td class="${cls(r, 0.98, 1.02)}">${r.toFixed(2)}×<span class="bar"><i style="background:${col};left:${r < 1 ? 50 - w : 50}%;width:${w}%"></i><b></b></span></td></tr>`;
    });
    render($("ab"), html`<table><tr><th>field</th><th>original</th><th>repaired</th><th>repaired ÷ original</th></tr>${rows}</table>`);
    const w = ab.window ? `the last ${ab.window} iterations` : "the end of each run";
    $("abNote").textContent = `Mean initial residual over ${w}; the same case, settings and start on both meshes. Below 1× (green) the repaired mesh converges further.` +
      (isNum(b.secondsPerIteration) && isNum(f.secondsPerIteration) ? ` Time per iteration: ${b.secondsPerIteration.toFixed(2)} s original, ${f.secondsPerIteration.toFixed(2)} s repaired.` : "");
  }

  // ---------------------------------------------------------------- residual history chart (MD.chart)
  const hist = run => { const h = obj(run && run.residualHistory); return Array.isArray(h.Time) ? h : null; };
  const pts = (h, k) => h ? h.Time.map((x, i) => [x, arr(h[k])[i]]) : [];
  function history(ab) {
    const hb = ab && hist(ab.base), hf = ab && (hist(ab.fixedFull) || hist(ab.fixed));
    $("histCard").hidden = !(hb || hf);
    if (!(hb || hf)) return;
    const fields = [...new Set([...Object.keys(hb || {}), ...Object.keys(hf || {})])].filter(k => k !== "Time");
    const sel = $("field"), keep = sel.value;
    render(sel, html`${fields.map(k => html`<option value="${k}">${k}</option>`)}`);
    sel.value = fields.includes(keep) ? keep : fields.includes("p") ? "p" : fields[0];
    const plot = () => chart.line($("hist"), [
      { name: "original mesh", color: css("--base"), dash: true, pts: pts(hb, sel.value) },
      { name: "repaired mesh", color: css("--accent"), pts: pts(hf, sel.value) }],
      { log: true, height: 260, tip: $("histTip"), xlabel: "iteration", empty: "No residual history" });
    sel.onchange = plot;
    plot();
  }

  // ---------------------------------------------------------------- judge
  function judge(ab) {
    const j = ab && ab.fixedJudge;
    $("judgeCard").hidden = !j;
    if (!j) return;
    const rows = Object.entries(obj(j.average)).filter(([, v]) => v && typeof v === "object" && isNum(v.mean))
      .map(([k, v]) => html`<tr><td>${k}</td><td>${num(v.mean)}</td><td>${isNum(v.u) ? "± " + num(v.u, 2) : "–"}</td></tr>`);
    const flags = arr(j.flags), ax = obj(j.axes);
    render($("judge"), html`<p class="verdict">${String(j.verdict || "–")}</p>${rows.length ? html`<div class="scroll" style="margin-top:8px"><table>
      <tr><th>average (${String(j.group || "all")})</th><th>mean</th><th>uncertainty</th></tr>${rows}</table></div>` : ""}${
      flags.length ? html`<ul class="flags">${flags.map(f => html`<li>${String(f)}</li>`)}</ul>` : ""}
      <div class="sub" style="margin-top:6px">Judged over ${num(j.window)} ${j.transient ? "time steps" : "iterations"}${
      ax.flow ? `; flow ${ax.flow}, up ${ax.up}` : ""}.</div>`);
  }

  // ---------------------------------------------------------------- repair map
  function hexToRgb(h) { h = h.replace("#", ""); if (h.length === 3) h = [...h].map(c => c + c).join(""); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function density(v) {
    const nx = v.nx, ny = v.ny;
    let raw;
    try { raw = atob(v.data || ""); } catch (e) { return null; }          // the surface is left out, marks still drawn
    if (!(nx > 0 && ny > 0) || raw.length !== nx * ny) return null;
    const img = new ImageData(nx, ny), ink = hexToRgb(css("--ink")), bg = hexToRgb(css("--card"));
    const src = new Float32Array(raw.length); for (let i = 0; i < raw.length; i++) src[i] = raw.charCodeAt(i) / 255;
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { let s = 0, c = 0; for (let d = -1; d <= 1; d++) { const xx = x + d; if (xx >= 0 && xx < nx) { s += src[y * nx + xx]; c++; } } tmp[y * nx + x] = s / c; }
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { let s = 0, c = 0; for (let d = -1; d <= 1; d++) { const yy = y + d; if (yy >= 0 && yy < ny) { s += tmp[yy * nx + x]; c++; } } out[y * nx + x] = s / c; }
    for (let i = 0; i < out.length; i++) { const a = Math.pow(Math.min(1, out[i] * 1.6), 0.6) * 0.55; for (let k = 0; k < 3; k++) img.data[4 * i + k] = bg[k] + (ink[k] - bg[k]) * a; img.data[4 * i + 3] = 255; }
    const c = document.createElement("canvas"); c.width = nx; c.height = ny; c.getContext("2d").putImageData(img, 0, 0); return c;
  }
  const HEAT = ["#f6d55c", "#f0a93a", "#e8702a", "#d23b3b"];
  function setupMap() {
    const hot = arr(map.hot);
    render($("heat"), html`${hot.map((L, i) => html`<option value="${i}">${String(obj(L).label || `layer ${i + 1}`)}</option>`)}<option value="-1">none</option>`);
    $("heat").value = String(hot.length - 1);
    $("heat").onchange = $("mapView").onchange = drawMap;
    drawMap();
  }
  function drawMap() {
    const which = $("mapView").value, v = obj(map[which]), cv = $("map"), tip = $("tip");
    const ax = arr(obj(map.axes)[which]).length === 2 ? map.axes[which] : [0, which === "side" ? 2 : 1], n = "xyz";
    $("mapHead").textContent = which === "side" ? `(${n[ax[0]]} along the flow, ${n[ax[1]]} up)` : `(${n[ax[0]]} along the flow, ${n[ax[1]]} across)`;
    const lo = arr(v.lo), hi = arr(v.hi);
    if (lo.length !== 2 || hi.length !== 2) { cv.hidden = true; return; }
    cv.hidden = false;
    const W = cv.clientWidth, H = Math.round(W * (hi[1] - lo[1]) / (hi[0] - lo[0])), dpr = devicePixelRatio || 1;
    cv.style.height = H + "px"; cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d"); g.scale(dpr, dpr);
    if (!(which in mapImgs)) mapImgs[which] = density(v);
    if (mapImgs[which]) g.drawImage(mapImgs[which], 0, 0, W, H);
    const X = x => (x - lo[0]) / (hi[0] - lo[0]) * W, Y = y => (1 - (y - lo[1]) / (hi[1] - lo[1])) * H, marks = [];
    const L = arr(map.hot)[+$("heat").value];
    if (L) {
      const cells = arr(L.cells), k = cells.length;
      for (let i = k - 1; i >= 0; i--) {
        const r = arr(cells[i]); if (!isNum(r[ax[0]]) || !isNum(r[ax[1]])) continue;
        const t = 1 - i / k, ci = t > 0.97 ? 3 : t > 0.85 ? 2 : t > 0.6 ? 1 : 0, px = X(r[ax[0]]), py = Y(r[ax[1]]);
        g.fillStyle = HEAT[ci]; g.globalAlpha = 0.35 + 0.6 * t; g.beginPath(); g.arc(px, py, 1.2 + 2.2 * t, 0, 7); g.fill();
        if (i < 400) marks.push({ px, py, text: `${L.label}\nrank ${i + 1} of ${k}` + (isNum(r[3]) ? ` · change ${r[3].toFixed(1)}× RMS` : "") });
      }
      g.globalAlpha = 1;
    }
    const ring = (list, fill, color, what) => { for (const d of arr(list)) {
      const c = arr(d.c); if (!isNum(c[ax[0]]) || !isNum(c[ax[1]])) continue;
      const px = X(c[ax[0]]), py = Y(c[ax[1]]), rad = Math.max(2.5, Math.min(8, 1.6 * Math.sqrt(+d.n || 1)));
      g.beginPath(); g.arc(px, py, rad, 0, 7);
      if (fill) { g.fillStyle = color; g.fill(); } else { g.strokeStyle = color; g.lineWidth = 1.4; g.stroke(); }
      marks.push({ px, py, text: `${what}\n${d.n} face(s): ${arr(d.kinds).join(", ")}\nnon-ortho ${d.nonOrtho}° · skew ${d.skew}` +
        (arr(d.patches).length ? `\non ${arr(d.patches).join(", ")}` : "") + `\nat (${c.map(x => (+x).toFixed(3)).join(", ")}) m` });
    } };
    ring(map.defectsBefore, false, css("--def"), "Defect found and repaired");
    ring(map.defectsAfter, true, css("--left"), "Defect left after the repair");
    cv.onmousemove = e => {
      const b = cv.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top; let best = null, bd = 64;
      for (const m of marks) { const dd = (m.px - mx) ** 2 + (m.py - my) ** 2; if (dd < bd) { bd = dd; best = m; } }
      if (!best) { tip.style.display = "none"; return; }
      tip.textContent = best.text; tip.style.display = "block";
      tip.style.left = Math.max(0, Math.min(mx + 12, cv.clientWidth - tip.offsetWidth - 4)) + "px"; tip.style.top = (my + cv.offsetTop + 12) + "px";
    };
    cv.onmouseleave = () => { tip.style.display = "none"; };
  }

  // ---------------------------------------------------------------- about
  function about() {
    const gen = obj(R.generator), red = obj(R.redacted), c = obj(R.contents);
    const names = { repair: "Repair result", map: "Repair map", abtest: "Solver A/B test" };
    const rows = Object.entries(c).map(([k, x]) => {
      const o = obj(x), sha = String(o.sha256 || "");
      return html`<tr><td>${names[k] || k}</td><td>${String(o.schemaVersion || "–")}</td><td>${isNum(o.bytes) ? `${(o.bytes / 1e3).toFixed(0)} kB` : "–"}</td><td class="mono" title="${sha}">${sha.slice(0, 12)}</td></tr>`;
    });
    render($("about"), html`<div class="sub">Made ${R.created || "–"} by Mesh Doctor ${gen.meshdoctor || "?"}${gen.openfoam ? ` (OpenFOAM ${gen.openfoam})` : ""}.
      ${isNum(red.paths) ? red.paths : "?"} paths on the worker were replaced before it was written.
      It still holds the case's geometry coordinates, patch and force-group names and numbers: share it like the case itself.</div>
      <div class="scroll" style="margin-top:8px"><table><tr><th>document</th><th>version</th><th>size</th><th>sha256</th></tr>${rows}</table></div>`);
  }

  let resizeT;
  window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => R && (history(R.documents.abtest), map && drawMap()), 120); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { mapImgs = {}; if (R) draw(); });

  // ---------------------------------------------------------------- start: the report in this page, ?name= on the dashboard, or wait for a file
  (async () => {
    const slot = $("md-report");
    try {
      if (slot && slot.textContent.trim()) return show(JSON.parse(slot.textContent), "this file");
      const name = new URLSearchParams(location.search).get("name");
      if (!name || !/^https?:$/.test(location.protocol)) return;
      let rep;
      try {
        rep = await MD.api.get(["repairs", name, "report"]);
      } catch (e) {
        if (e instanceof MD.ApiError && !e.api)       // a static host or proxy answered, not Mesh Doctor
          throw new Error("This page is not served by a Mesh Doctor dashboard, so it cannot load a run by name. Open a report file instead.");
        throw e;
      }
      show(rep, "this dashboard");
    } catch (e) { fail(e.message); }
  })();
})();
