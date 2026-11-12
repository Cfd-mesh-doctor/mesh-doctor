// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The Mesh Doctor authors
//
// The steady-run page (run.html): one A/B test's second run, live.  Reads
// GET /api/v1/abtests/{name}/live, or /api/v1/live/abtest (the test running
// now) when the URL names none.  Charts are MD.chart; text is textContent or MD.html.
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const { html, render, fmt, ui, chart } = MD;
  const loc = fmt.loc;
  let last = null, forceKey = "car", timer = null;
  let label = new URLSearchParams(location.search).get("label") || "";

  function show(d) {
    last = d;
    const s = d.solver || {}, st = d.stages || [], cur = d.current || st[0] || {}, pr = d.proc || {};
    const it = s.iteration || 0, endAll = Math.max(0, ...st.map(x => x.to), s.end || 0);
    const isCur = x => x.from === cur.from && x.to === cur.to;
    $("title").textContent = String(d.label).replace(/_/g, " ") + " · live";
    $("caseName").textContent = `Test copy of ${d.source || "?"} · ` +
      `${d.variant ? "solver variant " + d.variant + " on the original mesh" : "repaired mesh"} · steady k-ω SST`;
    const sel = $("labelSel"), labels = d.labels || [];
    if (sel.options.length !== labels.length) render(sel, html`${labels.map(n => html`<option>${n}</option>`)}`);
    sel.value = d.label;

    const frac = endAll ? it / endAll : 0;
    $("ovPct").textContent = (frac * 100).toFixed(1) + " %";
    ui.bar($("ovBar"), frac, s.state === "running" ? "running" : s.state === "error" ? "error" : "done");
    $("ovStage").textContent = `${cur.name || "–"} · iteration ${loc(it)} of ${loc(cur.to)}`;
    $("ovEta").textContent = s.state === "running" && s.eta != null
      ? `Stage ETA ${fmt.dur(s.eta)} · done ≈ ${new Date(Date.now() + s.eta * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : s.state === "stopped" ? `Solver idle for ${fmt.dur(s.idle_s)}` : s.state === "done" ? "Stage finished" : "";
    render($("steps"), html`${st.map((x, i) => {
      const f = Math.max(0, Math.min(1, (it - x.from) / Math.max(1, x.to - x.from)));
      const cls = it >= x.to ? "ok" : isCur(x) && s.state === "running" ? "run" : "";
      return html`<div class="step"><b>${i + 1} · ${x.name}</b>iterations ${loc(x.from)}–${loc(x.to)}
        <div class="bar thin"><i class="${cls}" style="width:${(f * 100).toFixed(1)}%"></i></div></div>`;
    })}`);
    const procs = ["foamRun", "snappyHexMesh", "checkMesh", "decomposePar"].filter(k => pr[k]).map(k => `${k} ×${pr[k]}`).join(", ") || "none running";
    $("mem").textContent = pr.mem_total_mb ? `WSL memory ${loc(pr.mem_used_mb / 1024, 1)} / ${loc(pr.mem_total_mb / 1024, 1)} GB · processes: ${procs}` : "";

    // solver card
    const b = $("solverBadge");
    b.className = "badge " + (s.state || "");
    b.textContent = { pending: "waiting", running: "running", done: "done", error: "error", stopped: "stopped" }[s.state] || s.state || "–";
    $("solverTitle").textContent = cur.name || "Solver";
    ui.bar($("solverBar"), (it - cur.from) / Math.max(1, cur.to - cur.from), s.state);
    const set = d.settings || {};
    ui.kv($("solverKv"), [["Iteration", `${loc(it)} / ${loc(s.end)}`],
      ["Wall time per iteration", s.wall_per_it ? loc(s.wall_per_it, 1) + " s" : "–"], ["Remaining", fmt.dur(s.eta)],
      ["Pressure-velocity coupling", set.ddt === "localEuler" ? "PIMPLE, local time stepping" : set.consistent === "yes" ? "SIMPLEC (consistent)" : "SIMPLE"],
      ["Relaxation", set.relaxation || "–"], ["Time scheme", set.ddt || "–"], ["Log", s.log || "–"]]);
    $("solverErr").textContent = s.error || "";

    // judge card
    const j = d.judge || {}, jb = $("judgeBadge");
    jb.className = "badge " + (j.level || "");
    jb.textContent = /^provisional/.test(j.verdict || "") ? "provisional" : j.level === "ok" ? "settled" : j.level === "warn" ? "improving"
      : j.level === "err" ? "not converged" : "collecting";
    $("judgeVerdict").textContent = j.verdict || "–";
    const rows = [["Window", j.window ? `${j.window} iterations` : "–"]];
    if (j.p) rows.push(["p residual (median)", `${fmt.exp(j.p.median)} · trend ×${fmt.fixed(j.p.trend, 2)}`]);
    const vn = String(j.verticalName || "vertical"), VN = vn[0].toUpperCase() + vn.slice(1), tot = j.total ? " (" + j.total + ")" : "";
    for (const [k, name] of [["vertical", VN + tot], ["drag", "Drag" + tot]]) {
      const v = j[k];
      if (v) rows.push([name, `${fmt.fixed(v.mean, 2)} ± ${fmt.fixed(v.std, 2)} N · osc ${fmt.pct(v.osc)} · drift ${fmt.pct(v.drift)}`]);
    }
    const av = j.average || {}, an = Object.keys(av);
    if (an.length) {
      rows.push([`Averaged since iteration ${loc(j.avgFrom)}`, `(${av[an[0]].nBatches} batches × ${av[an[0]].batchLen} it.)`]);
      for (const n of an) rows.push([n, `${fmt.fixed(av[n].mean, 2)} ± ${fmt.fixed(av[n].u, 2)} N`]);
    }
    ui.kv($("judgeKv"), rows);
    const sj = d.savedJudge;
    $("savedJudge").textContent = sj && sj.verdict ? `Last saved verdict (end of the previous stage): ${sj.verdict}.` : "";
    drawForces();
    drawRes();
  }

  const marks = () => (last.stages || []).slice(1).map(s => s.from);
  const band = () => last.current ? [last.current.from, last.current.to] : null;

  function drawForces() {
    if (!last) return;
    const F = last.forces || {}, c = chart.palette();
    // groups, flow and up axes come from the case (server: caseinfo.describe)
    const I = last.forceInfo || {}, tot = I.total, vn = I.vertical || "vertical";
    const ve = g => (F[g] || []).map(r => [r[0], r[2]]), dr = g => (F[g] || []).map(r => [r[0], r[1]]);
    const ser = forceKey === "car"
      ? (tot ? [{ name: `${tot} ${vn} (${I.up || "?"})`, color: c[0], pts: ve(tot) },
                { name: `${tot} drag (${I.flow || "?"})`, color: c[1], pts: dr(tot) }] : [])
      : (I.groups || []).filter(g => g !== tot).slice(0, 6).map((g, i) => ({ name: `${g} ${vn}`, color: c[i % c.length], pts: ve(g) }));
    chart.legend($("forceLegend"), ser);
    chart.line($("cForce"), ser, { clip: 0.01, marks: marks(), band: band(), tip: $("tForce"), xlabel: "iteration", empty: "No force data yet" });
  }

  function drawRes() {
    if (!last) return;
    const R = last.residuals || {}, cols = (R.cols || []).slice(1), rows = R.rows || [], c = chart.palette();
    const ser = cols.map((n, i) => ({ name: n, color: c[i % c.length], pts: rows.map(r => [r[0], r[i + 1]]) }));
    const B = last.baseResiduals || {};
    if (B.cols && B.cols.includes("p")) {
      const i = B.cols.indexOf("p"), pts = (B.rows || []).filter(r => r[i] > 0).map(r => [r[0], r[i]]);
      const span = pts.length ? ` (${pts[0][0]}–${pts[pts.length - 1][0]})` : "";
      ser.push({ name: `p, original-mesh run${span}`, color: getComputedStyle(document.documentElement).getPropertyValue("--muted").trim(), dash: true, pts });
    }
    chart.legend($("resLegend"), ser);
    chart.line($("cRes"), ser, { log: true, marks: marks(), band: band(), tip: $("tRes"), xlabel: "iteration", empty: "No residuals yet" });
  }

  $("labelSel").onchange = e => {
    label = e.target.value;
    history.replaceState(null, "", location.pathname + "?label=" + encodeURIComponent(label));
    tick();
  };
  document.querySelectorAll("#forceTabs button").forEach(b => {
    b.onclick = () => {
      forceKey = b.dataset.k;
      document.querySelectorAll("#forceTabs button").forEach(x => x.classList.toggle("on", x === b));
      drawForces();
    };
  });
  window.addEventListener("resize", () => { drawForces(); drawRes(); });

  async function tick() {
    clearTimeout(timer);
    try {
      show(label ? await MD.api.get(["abtests", label, "live"]) : await MD.api.get("/live/abtest"));
      ui.status($("liveDot"), $("updated"));
    } catch (e) {
      ui.status($("liveDot"), $("updated"), e);
    }
    timer = setTimeout(tick, 15000);
  }
  tick();
})();
