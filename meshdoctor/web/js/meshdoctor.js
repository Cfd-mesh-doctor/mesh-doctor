// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The Mesh Doctor authors
//
// The Mesh Doctor page (meshdoctor.html): repair runs with their checkMesh
// tables and problem regions, the solver A/B test, and a WebGL view of one
// region.  It talks only to /api/v1, through MD.api and MD.jobs (md.js), and
// builds markup only with MD.html, which escapes every value from a run.
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const { html, render, fmt } = MD;
  let cur = null, tag = "before", res = null;
  const say = (el, e) => { el.textContent = e && e.message ? e.message : String(e); };
  // ---------------- runs ----------------
  async function loadSources() {
    const s = await MD.api.items("/cases");
    render($("src"), html`${s.map(n => html`<option>${n}</option>`)}`);
  }

  async function loadRuns() {
    const rs = await MD.api.items("/repairs");
    render($("runs"), rs.length ? html`${rs.map(r => {
      const v = r.verdict, st = r.status || {};
      const badge = !v ? "" : v.regressions.length
        ? html`<span class="tag sev3">${v.regressions.length} regressions</span>`
        : html`<span class="tag good">no regressions</span>`;
      return html`<div class="item${cur === r.name ? " on" : ""}" data-n="${r.name}"><b>${r.name}</b> ${badge}
        <div class="sub">${st.step || ""} · ${r.profile || ""} ${r.nCells ? fmt.fixed(r.nCells / 1e6, 2) + "M cells" : ""}</div></div>`;
    })}` : html`<div class="sub">No runs yet.</div>`);
    document.querySelectorAll("#runs .item").forEach(e => { e.onclick = () => open(e.dataset.n); });
  }

  const ROWS = [["Face pyramids inverted", "nWrongPyramids"], ["Bad face tets", "nBadTets"],
    ["Skewness > 4 (faces)", "nSkew"], ["Max skewness", "maxSkewness"], ["Non-ortho > 70 (faces)", "nSevereNonOrtho"],
    ["Max non-orthogonality", "maxNonOrtho"], ["Small determinant (cells)", "nSmallDeterminant"],
    ["Low weight < 0.05 (faces)", "nLowWeight"], ["Min face weight", "minWeight"],
    ["Low volume ratio (faces)", "nLowVolRatio"], ["Concave cells", "nConcaveCells"],
    ["Failed checkMesh checks", "failedChecks"]];

  function collapseText(c) {
    if (!c) return "No topology repair needed.";
    if (c.accepted) return `Topology repair: collapsed ${c.facesCollapsed} face(s) that point moves could not fix ` +
      "(collapseEdges), then smoothed again; kept because checkMesh did not regress.";
    const worse = c.verdict && c.verdict.regressions && c.verdict.regressions.length
      ? ` (it would have worsened: ${c.verdict.regressions.join(", ")})` : "";
    return `Topology repair tried on ${c.facesCollapsed} face(s) and rolled back${worse}.`;
  }

  async function openRun(name) {
    cur = name;
    loadRuns().catch(() => {});
    let lg;
    [res, lg] = await Promise.all([MD.api.find(["repairs", name]), MD.api.find(["repairs", name, "log"])]);
    $("log").textContent = (lg && lg.text) || "";
    if (!res) {
      $("summary").textContent = "Still running…";
      render($("clusters"), html``);
      return;
    }
    const b = res.checkMeshBefore, a = res.checkMeshAfter;
    const better = k => k === "minWeight" ? a[k] > b[k] : a[k] < b[k];
    const worse = k => k === "minWeight" ? a[k] < b[k] : a[k] > b[k];
    const reg = res.verdict.regressions;
    $("resTitle").textContent = `Result: ${name}`;
    render($("summary"), html`<div class="sub" style="margin-bottom:6px">${res.source} · ${fmt.fixed(res.layout.nCells / 1e6, 2)}M cells
      · profile ${res.profile} · max point move ${res.maxDisplacement_m != null ? fmt.fixed(res.maxDisplacement_m * 1000, 2) + " mm" : "–"}</div>
      <table><tr><th>checkMesh (OpenFOAM's own verdict)</th><th>before</th><th>after</th></tr>
      ${ROWS.map(([l, k]) => html`<tr><td>${l}</td><td>${fmt.sig(b[k])}</td><td class="${better(k) ? "up" : worse(k) ? "down" : ""}">${fmt.sig(a[k])}</td></tr>`)}</table>
      <div class="sub" style="margin-top:6px">${reg.length ? html`<b class="down">Regressions: ${reg.join(", ")}</b>` : "No checkMesh metric got worse."}
        Mesh OK after: ${a.meshOK ? "yes" : "no"}</div>
      <div class="sub">Point-move passes: ${res.passes || 1}. ${collapseText(res.collapse)}</div>`);
    showClusters();
    loadAB(name).catch(abFail);
  }
  const open = name => openRun(name).catch(e => say($("summary"), e));

  // ---------------- jobs: one line each, with Cancel while it runs ----------------
  function follow(job, el, onUpdate) {
    const txt = document.createElement("span"), stop = document.createElement("button");
    stop.textContent = "Cancel";
    el.replaceChildren(txt, " ", stop);
    stop.onclick = async () => {
      stop.disabled = true;
      try { await MD.jobs.cancel(job.id); } catch (e) { say(txt, e); }
    };
    return MD.jobs.follow(job, j => {
      txt.textContent = MD.jobs.describe(j);
      stop.hidden = !MD.jobs.ACTIVE.has(j.state);
      if (onUpdate) onUpdate(j);
    }, 3000).catch(e => { say(txt, e); stop.hidden = true; });
  }

  async function submit(kind, params, el) {
    try {
      const job = await MD.jobs.submit(kind, params);
      if (!job) el.textContent = "Not started.";
      return job;
    } catch (e) {
      say(el, e);
      return null;
    }
  }

  $("go").onclick = async () => {
    const src = $("src").value;
    if (!src) return;
    const name = $("rname").value.trim() || src + "_" + Date.now().toString(36);
    const job = await submit("repair", { source: src, name, profile: $("prof").value }, $("goState"));
    if (!job) return;
    cur = name;
    res = null;
    const end = await follow(job, $("goState"), () => loadRuns().catch(() => {}));
    if (end && end.state === "done") open(name);
  };

  // ---------------- solver A/B ----------------
  let abTimer = null;
  const abFail = e => say($("abState"), e);
  const FCOL = ["#2563eb", "#d9468f", "#15803d", "#b45309", "#7c3aed", "#0891b2"];
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function drawAB(live) {
    const c = $("abChart"), r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    c.width = r.width * dpr; c.height = r.height * dpr;
    const g = c.getContext("2d"); g.scale(dpr, dpr);
    const W = r.width, H = r.height, L = 48, B = 22, T = 6, R = 8;
    g.clearRect(0, 0, W, H); g.font = "11px system-ui"; g.fillStyle = css("--muted"); g.strokeStyle = css("--line");
    const runs = ["base", "fixed"].filter(t => live[t] && Array.isArray(live[t].rows));
    if (!runs.length) {
      g.fillText("No residuals yet.", L, H / 2);
      $("abLegend").textContent = "";
      return;
    }
    const cols = live[runs[0]].cols.slice(1);
    let xmax = 1, ymin = 1e9, ymax = 1e-12;
    runs.forEach(t => live[t].rows.forEach(rw => {
      xmax = Math.max(xmax, rw[0]);
      rw.slice(1).forEach(v => { if (v > 0) { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); } });
    }));
    const ly0 = Math.floor(Math.log10(ymin)), ly1 = Math.ceil(Math.log10(ymax));
    const X = x => L + (W - L - R) * x / xmax, Y = v => T + (H - T - B) * (ly1 - Math.log10(v)) / Math.max(1, ly1 - ly0);
    for (let e = ly0; e <= ly1; e++) {
      const y = Y(10 ** e);
      g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.fillText("1e" + e, 4, y + 4);
    }
    g.fillText("iteration", L + (W - L - R) / 2 - 20, H - 6); g.fillText("0", L, H - 6);
    g.textAlign = "right"; g.fillText(String(Math.round(xmax)), W - R, H - 6); g.textAlign = "left";
    cols.forEach((cn, i) => runs.forEach(t => {
      g.strokeStyle = FCOL[i % FCOL.length]; g.lineWidth = t === "fixed" ? 1.8 : 1.2; g.setLineDash(t === "fixed" ? [] : [5, 4]);
      g.beginPath();
      let first = true;
      live[t].rows.forEach(rw => {
        const v = rw[i + 1];
        if (!(v > 0)) return;
        const x = X(rw[0]), y = Y(v);
        if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y);
      });
      g.stroke();
    }));
    g.setLineDash([]);
    render($("abLegend"), html`${MD.join(cols.map((cn, i) => html`<span class="sw" style="background:${FCOL[i % FCOL.length]}"></span>${cn}`), html` &nbsp; `)}
      &nbsp; · dashed = original run, solid = second run (repaired mesh or solver variant)`);
  }

  const ms = s => s ? `${fmt.num(+s.mean)} ± ${(+s.std).toPrecision(2)}` : "–";

  async function fillABList(sel) {
    const l = await MD.api.items("/abtests");
    render($("abSel"), html`${l.map(n => html`<option${n === sel ? html` selected` : ""}>${n}</option>`)}`);
  }
  $("abSel").onchange = () => loadAB($("abSel").value, true).catch(abFail);

  function abTables(r) {
    const out = [];
    const lbl = r.variant ? { b: "original", f: r.variant + (r.fixedName ? " + repaired" : "") } : { b: "original", f: "repaired" };
    if (r.variant) out.push(html`<div class="sub" style="margin-bottom:4px">Second run = solver variant <b>${r.variant}</b>${r.fixedName ? " on the repaired mesh" : " on the original mesh"}:
      ${(r.variantSettings || []).map(x => x[1] + " = " + x[2]).join(" · ")}</div>`);
    out.push(html`<table><tr><th>Initial residual, median of last ${r.window} iterations</th><th>${lbl.b}</th><th>${lbl.f}</th><th>ratio</th></tr>
      ${Object.keys(r.base.residuals).map(k => {
        const b = r.base.residuals[k], f = r.fixed && r.fixed.residuals ? r.fixed.residuals[k] : null;
        const q = b && f && b.median ? f.median / b.median : null;
        return html`<tr><td>${k}</td><td>${b ? fmt.exp(b.median) : "–"}</td><td>${f ? fmt.exp(f.median) : "running…"}</td>
          <td class="${q == null ? "" : q < 0.95 ? "up" : q > 1.05 ? "down" : ""}">${q == null ? "–" : fmt.fixed(q, 3)}</td></tr>`;
      })}</table>`);
    const gs = Object.keys(r.base.forces || {}).slice(0, 12), B = lbl.b, F = lbl.f, ax = r.fixedJudge && r.fixedJudge.axes;
    if (gs.length) out.push(html`<table style="margin-top:8px"><tr><th>Force (N), mean ± oscillation, last ${r.window} it.</th>
      <th>${B} Fx</th><th>${F} Fx</th><th>${B} Fy</th><th>${F} Fy</th><th>${B} Fz</th><th>${F} Fz</th></tr>
      ${gs.map(g => {
        const b = r.base.forces[g] || {}, f = r.fixed && r.fixed.forces ? r.fixed.forces[g] : null;
        return html`<tr><td>${g}</td>${["Fx", "Fy", "Fz"].map(k => html`<td>${ms(b[k])}</td><td>${f ? ms(f[k]) : "–"}</td>`)}</tr>`;
      })}</table>
      <div class="sub">Oscillation = standard deviation over the window: lower means more settled. Fx, Fy, Fz are along the case axes${ax ? ` (flow ${ax.flow}, up ${ax.up})` : ""}.</div>`);
    out.push(html`<div class="sub" style="margin-top:6px">Seconds per iteration: original ${r.base.secondsPerIteration ? fmt.fixed(r.base.secondsPerIteration, 1) : "–"},
      repaired ${r.fixed && r.fixed.secondsPerIteration ? fmt.fixed(r.fixed.secondsPerIteration, 1) : "–"}.
      Bounding messages: ${r.base.bounding} / ${r.fixed ? r.fixed.bounding : "–"}.</div>`);
    return out;
  }

  function hotspots(r) {
    return ["base", "fixed"].filter(t => r[t + "Hotspots"]).map(t => {
      const hs = r[t + "Hotspots"], s = hs.summary || {};
      return html`<div style="margin-top:8px"><b>${t === "base" ? "Original" : "Repaired"} mesh: where the solution still moves</b>
        <span class="sub">(change between the last two iterations)</span>
        <div class="sub">Top 0.1 % of cells carry ${fmt.fixed((s["shareTop0.1pct"] || 0) * 100, 1)} % of the squared change,
          top 1 % carry ${fmt.fixed((s.shareTop1pct || 0) * 100, 1)} %. ${fmt.fixed((hs.shareOfTopChangeNearMeshDefects || 0) * 100, 1)} %
          of the hotspot change sits next to a Mesh Doctor problem region. A few concentrated hotspots point to local (mesh) trouble;
          a broad spread points to unsteady flow.</div>
        ${(hs.top || []).slice(0, 8).map((c, i) => html`<div class="sub">#${i + 1} ${c.nCells} cells at ${fmt.xyz(c.centroid)} m
          · max score ${fmt.fixed(c.maxScoreAll, 1)} · max non-ortho ${fmt.fixed(c.maxNonOrtho, 1)}°
          ${c.nearMeshDefect ? html`<span class="tag sev3">next to mesh defect</span>` : ""}</div>`)}</div>`;
    });
  }

  function judgeCard(jd) {
    const p = jd.residuals.p || {}, f = jd.forces || {}, v = String(jd.verdict);
    const kind = /^converged/.test(v) ? "good" : /statistically|still/.test(v) ? "warn" : "bad";
    const forces = ["vertical", "drag", "Fx", "Fy"].filter(k => f[k]).map(k =>
      ` · ${jd.group} ${k === "vertical" ? (jd.axes || {}).vertical || k : k} ${fmt.fixed(f[k].mean, 2)} N, ` +
      `oscillation ${fmt.fixed(100 * f[k].osc, 1)} %, drift ${fmt.fixed(100 * (f[k].drift || 0), 1)} %`);
    const avg = Object.entries(jd.average || {});
    return html`<div class="judge"><b>Convergence judge</b> <span class="tag ${kind}">${v}</span>
      <div class="sub">Second run, last ${jd.window} vs previous ${jd.window} iterations: p residual ${fmt.exp(p.median)}
        (trend ×${fmt.fixed(p.trend, 2)})${forces}.</div>
      ${avg.length ? html`<div class="sub">Averages (N): ${avg.map(([k, a]) => `${k} ${fmt.fixed(a.mean, 2)} ± ${fmt.fixed(a.u, 2)}`).join(" · ")}</div>` : ""}
      <div class="sub">Converged = p below 1e-4 and forces within 0.5 %. Statistically steady = forces stationary within 1–2 %,
        so window means are usable even if residuals plateau.</div></div>`;
  }

  function modes(d) {
    return (d.modes || []).map(m => {
      const s = m.summary || {};
      return html`<div style="margin-top:8px"><b>Slow oscillation, iterations ${m.from} → ${m.to}</b>
        <div class="sub">Where the solution swings over hundreds of iterations. Top 1 % of cells carry ${fmt.fixed((s.shareTop1pct || 0) * 100, 0)} %
          of the change; ${fmt.fixed((m.nearDefects || 0) * 100, 1)} % sits next to a Mesh Doctor problem region (low = flow unsteadiness, not mesh).</div>
        ${(m.top || []).map((c, i) => html`<div class="sub">#${i + 1} ${fmt.fixed(100 * c.share, 0)} % · ${c.nCells} cells at ${fmt.xyz(c.centroid)} m
          · cell size ${c.h ? fmt.fixed(c.h * 1000, 1) + " mm" : "–"} · max non-ortho ${c.maxNonOrtho != null ? fmt.fixed(c.maxNonOrtho, 0) + "°" : "–"}</div>`)}</div>`;
    });
  }

  async function loadAB(name, keep) {
    clearTimeout(abTimer);
    if (!keep) await fillABList(name);
    const d = name ? await MD.api.find(["abtests", name]) : null;
    if (!d) {
      $("abState").textContent = "Not run yet for this repair run.";
      drawAB({});
      render($("abTable"), html``);
      return;
    }
    const st = d.status || {}, r = d.result || {};
    $("abState").textContent = (st.step || "") + " · " + (st.time || "");
    drawAB(d.live || {});
    const parts = [];
    if (r.fixedJudge && r.fixedJudge.residuals) parts.push(judgeCard(r.fixedJudge));
    if (r.base && r.base.residuals) parts.push(...abTables(r));
    parts.push(...hotspots(r), ...modes(d));
    render($("abTable"), parts.length ? html`${parts}` : html`<div class="sub">Running; the table fills in when the first run finishes.</div>`);
    if (st.step && st.step !== "done") abTimer = setTimeout(() => loadAB(name, true).catch(abFail), 20000);
  }

  MD.api.items("/variants").then(vs => {
    for (const v of vs) {
      const o = document.createElement("option");
      o.value = v.name;
      o.textContent = "2nd run: " + v.label + " (original mesh)";
      $("abVar").appendChild(o);
    }
  }).catch(() => {});

  $("abGo").onclick = async () => {
    if (!cur) return;
    const job = await submit("abtest", { name: cur, iters: +$("abIters").value, init: $("abInit").value,
                                         variant: $("abVar").value }, $("abJob"));
    if (!job) return;
    setTimeout(() => loadAB(job.name).catch(abFail), 3000);
    await follow(job, $("abJob"));
    loadAB(job.name).catch(abFail);
  };
  $("abExt").onclick = async () => {
    const label = $("abSel").value;
    if (!label) return;
    const job = await submit("abextend", { name: label, to: +$("abExtTo").value }, $("abJob"));
    if (!job) return;
    setTimeout(() => loadAB(label, true).catch(abFail), 3000);
    await follow(job, $("abJob"));
    loadAB(label, true).catch(abFail);
  };

  // ---------------- problem regions ----------------
  const clusters = () => (tag === "before" ? res.clustersBefore : res.clustersAfter) || [];
  function showClusters() {
    if (!res) return;
    const cl = clusters();
    $("tBefore").classList.toggle("on", tag === "before");
    $("tAfter").classList.toggle("on", tag === "after");
    render($("clusters"), cl.length ? html`${cl.slice(0, 300).map(c => html`<div class="item" data-i="${c.id}"><b>#${+c.id + 1}</b>
      ${(c.kinds || []).map(k => html`<span class="tag sev${c.severity}">${k}</span>`)}
      <div class="sub">${c.nFaces} face(s) · worst badness ${fmt.fixed(c.worst.badness, 2)} · ${c.patches.length ? c.patches.join(", ") : "interior"}<br>
        at ${fmt.xyz(c.centroid)} m · non-ortho ${fmt.fixed(c.worst.nonOrtho, 1)}° · skew ${fmt.fixed(c.worst.skew, 2)}</div></div>`)}`
      : html`<div class="sub">No faces above target.</div>`);
    document.querySelectorAll("#clusters .item").forEach(e => {
      e.onclick = () => {
        document.querySelectorAll("#clusters .item").forEach(x => x.classList.remove("on"));
        e.classList.add("on");
        loadCluster(+e.dataset.i).catch(err => say($("pick"), err));
      };
    });
  }
  $("tBefore").onclick = () => { tag = "before"; showClusters(); };
  $("tAfter").onclick = () => { tag = "after"; showClusters(); };

  // ---------------- WebGL viewer ----------------
  const cv = $("cv"), gl = cv.getContext("webgl", { antialias: true, premultipliedAlpha: false });
  const VS = "attribute vec3 p;attribute vec4 c;attribute vec3 n;uniform mat4 M;varying vec4 vc;varying float l;" +
    "void main(){gl_Position=M*vec4(p,1.);vc=c;l=.45+.55*abs(normalize(n).z*.6+normalize(n).y*.3+normalize(n).x*.1);}";
  const FS = "precision mediump float;varying vec4 vc;varying float l;uniform float edge;" +
    "void main(){gl_FragColor=edge>.5?vec4(.08,.09,.11,.55):vec4(vc.rgb*l,vc.a);}";
  let L = null;
  if (gl) {
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr); gl.useProgram(pr);
    L = { p: gl.getAttribLocation(pr, "p"), c: gl.getAttribLocation(pr, "c"), n: gl.getAttribLocation(pr, "n"),
          M: gl.getUniformLocation(pr, "M"), edge: gl.getUniformLocation(pr, "edge") };
  } else {
    $("pick").textContent = "This browser has no WebGL, so the 3D view is off.";
  }
  let mesh = null, cam = { yaw: .7, pitch: .5, dist: 1, target: [0, 0, 0] }, origin = [0, 0, 0];
  function col(f) {
    if (f.ctx) return [.6, .64, .7, .28];
    if (f.hot) return [.85, .27, .56, 1];
    if (f.bad > 1) return [.89, .34, .18, .95];
    if (f.bad > .8) return [.95, .76, .31, .9];
    return [.29, .64, .64, .5];
  }
  function build(g) {
    const P = [], C = [], N = [], E = [], tris = [];
    const add = (xyz, c, info) => {
      const m = xyz.length / 3;
      if (m < 3) return;
      const v = i => [xyz[3 * i] - origin[0], xyz[3 * i + 1] - origin[1], xyz[3 * i + 2] - origin[2]];
      const a = v(0), nn = [0, 0, 0];
      for (let i = 1; i < m - 1; i++) {
        const b = v(i), d = v(i + 1), u = sub(b, a), w = sub(d, a);
        nn[0] += u[1] * w[2] - u[2] * w[1]; nn[1] += u[2] * w[0] - u[0] * w[2]; nn[2] += u[0] * w[1] - u[1] * w[0];
      }
      for (let i = 1; i < m - 1; i++) {
        for (const q of [a, v(i), v(i + 1)]) { P.push(...q); C.push(...c); N.push(...nn); }
        tris.push([a, v(i), v(i + 1), info]);
      }
      for (let i = 0; i < m; i++) E.push(...v(i), ...v((i + 1) % m));
    };
    // opaque/near-opaque first, translucent context last
    const cells = g.cells.slice().sort((x, y) => (x.hot - y.hot) || (x.bad - y.bad));
    for (const f of cells) add(f.xyz, col(f), f);
    const nOpaque = P.length / 3;
    for (const f of g.ctx) add(f.xyz, col({ ctx: 1 }), { ctx: 1, patch: f.patch });
    const mk = a => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(a), gl.STATIC_DRAW); return b; };
    return { p: mk(P), c: mk(C), n: mk(N), e: mk(E), nv: P.length / 3, nOpaque, ne: E.length / 3, tris };
  }
  async function loadCluster(id) {
    const c = clusters()[id];
    const g = await MD.api.find(["repairs", cur, "clusters", id], { tag });
    if (!g || !c || !gl) return;
    origin = c.centroid.slice();
    const ext = Math.max(...[0, 1, 2].map(k => c.bbox[1][k] - c.bbox[0][k]), c.h * 6);
    cam = { yaw: .7, pitch: .5, dist: ext * 2.2, target: [0, 0, 0] };
    mesh = build(g);
    $("pick").textContent = `Region #${id + 1}: ${g.cells.length} cell faces, ${g.ctx.length} nearby wall faces. Click a face for its values.`;
    draw();
  }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); };
  function mul(a, b) {
    const o = new Array(16).fill(0);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k];
    return o;
  }
  function mat() {
    const w = cv.clientWidth, h = cv.clientHeight, asp = w / h, f = 1 / Math.tan(.45), near = cam.dist / 200, far = cam.dist * 50;
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const eye = [cam.target[0] + cam.dist * cp * cy, cam.target[1] + cam.dist * cp * sy, cam.target[2] + cam.dist * sp];
    const z = norm(sub(eye, cam.target)), x = norm(cross([0, 0, 1], z)), y = cross(z, x);
    const V = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
    const Pm = [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
    return { M: mul(Pm, V), eye, x, y, z, f, asp };
  }
  function draw() {
    if (!gl) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!mesh) return;
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(L.M, false, new Float32Array(mat().M));
    const bind = (b, loc, n) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0); };
    bind(mesh.p, L.p, 3); bind(mesh.c, L.c, 4); bind(mesh.n, L.n, 3); gl.uniform1f(L.edge, 0);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.nOpaque);
    gl.depthMask(false); gl.drawArrays(gl.TRIANGLES, mesh.nOpaque, mesh.nv - mesh.nOpaque); gl.depthMask(true);
    bind(mesh.e, L.p, 3); gl.disableVertexAttribArray(L.c); gl.disableVertexAttribArray(L.n);
    gl.vertexAttrib4f(L.c, 0, 0, 0, 1); gl.vertexAttrib3f(L.n, 0, 0, 1);
    gl.uniform1f(L.edge, 1); gl.drawArrays(gl.LINES, 0, mesh.ne);
  }
  let drag = null;
  cv.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2, moved: 0 }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener("pointermove", e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.pan) {
      const m = mat(), s = cam.dist / cv.clientHeight;
      for (let k = 0; k < 3; k++) cam.target[k] += (-dx * m.x[k] + dy * m.y[k]) * s;
    } else {
      cam.yaw -= dx * .01;
      cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch + dy * .01));
    }
    draw();
  });
  cv.addEventListener("pointerup", e => { if (drag && drag.moved < 4) pick(e); drag = null; });
  cv.addEventListener("contextmenu", e => e.preventDefault());
  cv.addEventListener("wheel", e => { e.preventDefault(); cam.dist *= Math.exp(e.deltaY * .001); draw(); }, { passive: false });
  function pick(e) {
    if (!mesh) return;
    const m = mat(), r = cv.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((e.clientY - r.top) / r.height) * 2;
    const d = norm([0, 1, 2].map(k => -m.z[k] + m.x[k] * nx * m.asp / m.f + m.y[k] * ny / m.f));
    let best = null, bt = 1e30;
    for (const [a, b, c, info] of mesh.tris) {
      const e1 = sub(b, a), e2 = sub(c, a), pv = cross(d, e2), det = dot(e1, pv);
      if (Math.abs(det) < 1e-18) continue;
      const tv = sub(m.eye, a), u = dot(tv, pv) / det;
      if (u < 0 || u > 1) continue;
      const qv = cross(tv, e1), v = dot(d, qv) / det;
      if (v < 0 || u + v > 1) continue;
      const t = dot(e2, qv) / det;
      if (t > 0 && t < bt && !(info.ctx && best && !best.ctx)) { bt = t; best = info; }
    }
    if (!best) return;
    render($("pick"), best.ctx ? html`Wall face on patch <b>${best.patch}</b>`
      : html`Cell ${best.cell} · face ${best.face} · badness <b>${fmt.fixed(best.bad, 3)}</b>${best.hot ? html` · <b>failing face</b>` : ""}
        (badness = worst metric ÷ its target; above 1 fails the target)`);
  }
  window.addEventListener("resize", draw);

  // deep link: /meshdoctor?run=<name>[&cluster=<number as listed>] opens that run (and cluster)
  (async () => {
    const q = new URLSearchParams(location.search), n = q.get("run"), k = parseInt(q.get("cluster"), 10);
    if (!n) return;
    await open(n);
    if (res && k > 0 && clusters()[k - 1]) loadCluster(k - 1).catch(err => say($("pick"), err));
  })();
  loadSources().catch(e => say($("goState"), e));
  loadRuns().catch(e => render($("runs"), html`<div class="sub">${e.message}</div>`));
  setInterval(() => {
    loadRuns().catch(() => {});
    if (cur && !res) open(cur);
  }, 8000);
})();
