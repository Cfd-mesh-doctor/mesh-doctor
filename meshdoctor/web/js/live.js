// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The Mesh Doctor authors
//
// The live page (index.html): the transient case this server watches - mesh,
// check, steady start, transient run - from GET /api/v1/live, and the transient
// judge from GET /api/v1/live/judge (at most once a minute: it reads the whole
// log).  Charts are MD.chart; text is set with textContent only.
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const { fmt, ui, chart } = MD;
  const loc = fmt.loc;
  let last = null, forceKey = "ddes", resKey = "ddes", userPickedForce = false, userPickedRes = false;

  function badge(el, st) {
    const s = st.stale ? "stale" : st.state;
    el.className = "badge " + (s || "");
    el.textContent = st.stale ? "no output 10 min" : { pending: "waiting", running: "running", done: "done", error: "error" }[st.state] || st.state || "–";
  }

  function show(d) {
    last = d;
    const m = d.mesh || {}, c = d.checkMesh || {}, s = d.steady || {}, t = d.ddes || {}, pr = d.proc || {};
    if (d.case) $("caseName").textContent = "Live transient run · " + d.case;
    $("ovPct").textContent = fmt.fixed((d.overall || 0) * 100, 1) + " %";
    const fin = d.single === "steady" ? s.state === "done" : t.state === "done";
    ui.bar($("ovBar"), d.overall, fin ? "done" : "running");
    // a plain case (one foamRun) has no second solver stage: hide it
    for (const [id, st] of [["stSteady", s], ["stDdes", t]]) $(id).parentElement.style.display = st.state === "skipped" ? "none" : "";
    $("steadyCard").style.display = s.state === "skipped" ? "none" : "";
    $("ddesCard").style.display = t.state === "skipped" ? "none" : "";
    $("forceTabs").style.display = $("resTabs").style.display = d.single ? "none" : "";
    if (d.single) {
      $("stSteady").previousElementSibling.textContent = "3 · Steady solve";
      $("stDdes").previousElementSibling.textContent = "3 · Transient solve";
      $("steadyCard").querySelector("h2").firstChild.textContent = "Steady solve (foamRun) ";
      $("caseName").textContent = "Live run · " + (d.case || "");
    }
    let stage = "Waiting", eta = "";
    if (m.state === "running") stage = "Meshing · " + (m.phase || "");
    else if (m.state === "error") stage = "Meshing failed";
    else if (s.state === "running") { stage = `${d.single ? "Steady solve" : "Steady start"} · iteration ${loc(s.time)} of ${loc(s.end)}`; eta = "Stage ETA " + fmt.dur(s.eta); }
    else if (t.state === "running") {
      stage = `Transient · t = ${loc(t.time, 4)} s of ${t.end} s`;
      eta = "ETA " + fmt.dur(t.eta) + (t.eta ? " · done ≈ " + new Date(Date.now() + t.eta * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "");
    } else if (fin) stage = "Finished";
    else if (m.state === "done" && s.state === "pending") stage = "Mesh done · checking / starting solver";
    $("ovStage").textContent = stage;
    $("ovEta").textContent = eta;

    for (const [a, b, st] of [["stMesh", "bMeshS", m], ["stChk", "bChkS", c], ["stSteady", "bSteadyS", s], ["stDdes", "bDdesS", t]]) {
      $(a).textContent = st.state === "pending" ? "waiting" : st.state || "–";
      ui.bar($(b), st.state === "done" ? 1 : (st.fraction || 0), st.state);
    }
    const running = ["snappyHexMesh", "foamRun", "checkMesh"].filter(k => pr[k]).map(k => `${k} ×${pr[k]}`).join(", ");
    $("mem").textContent = pr.mem_total_mb
      ? `WSL memory ${loc(pr.mem_used_mb / 1024, 1)} / ${loc(pr.mem_total_mb / 1024, 1)} GB · processes: ${running || "none running"}` : "";

    // mesh
    badge($("meshBadge"), m); ui.bar($("meshBar"), m.fraction, m.state);
    $("meshPhase").textContent = m.phase || "";
    const mrows = [["Cells", loc(m.cells)], ["Elapsed", fmt.dur(m.elapsed)]];
    if (c.cells) mrows.push(["Final cells (checkMesh)", loc(c.cells)]);
    if (c.maxNonOrtho != null) mrows.push(["Max non-orthogonality", loc(c.maxNonOrtho, 1) + "°"]);
    if (c.maxSkewness != null) mrows.push(["Max skewness", loc(c.maxSkewness, 2)]);
    if (c.state === "done") mrows.push(["Mesh check", c.ok ? "OK" : `${(c.failed || []).join(",") || "some"} checks failed`]);
    ui.kv($("meshKv"), mrows);
    $("meshErr").textContent = m.error || "";

    // steady
    badge($("steadyBadge"), s); ui.bar($("steadyBar"), s.fraction, s.state);
    ui.kv($("steadyKv"), [["Iteration", `${loc(s.time)} / ${loc(s.end)}`], ["Wall time per iteration", s.wall_per_step ? loc(s.wall_per_step, 1) + " s" : "–"],
      ["Elapsed", fmt.dur(s.clock)], ["Remaining", fmt.dur(s.eta)]]);
    $("steadyErr").textContent = s.error || "";

    // transient
    badge($("ddesBadge"), t); ui.bar($("ddesBar"), t.fraction, t.state);
    ui.kv($("ddesKv"), [["Flow time", `${loc(t.time, 4)} / ${t.end} s`],
      ["Time steps", t.time != null && t.deltaT ? loc(t.time / t.deltaT) + " / " + loc(t.end / t.deltaT) : "–"],
      ["Wall time per step", t.wall_per_step ? loc(t.wall_per_step, 1) + " s" : "–"],
      ["Courant mean / max", t.courant_max != null ? `${loc(t.courant_mean, 3)} / ${loc(t.courant_max, 2)}` : "–"],
      ["Elapsed", fmt.dur(t.clock)], ["Remaining", fmt.dur(t.eta)],
      ["Averaging window", t.avgFrom != null ? t.avgFrom + " – " + t.end + " s" : "no fieldAverage in this case"]]);
    $("ddesErr").textContent = t.error || "";

    const tOn = !["pending", "skipped"].includes(t.state);
    if (!userPickedForce) forceKey = tOn ? "ddes" : "steady";
    if (!userPickedRes) resKey = tOn ? "ddes" : "steady";
    syncTabs(); drawForces(); drawRes();
    if (tOn &&Date.now() - judgedAt > 60000) judge(t);
  }

  // ---- the transient judge: forces stationary? each step converged? time step sane?
  let judgedAt = 0;
  async function judge(t) {
    judgedAt = Date.now();
    let j;
    try {
      j = await MD.api.get("/live/judge", t.avgFrom != null ? { avgFrom: t.avgFrom } : {});
    } catch (e) {
      if (e.code === "not-found") return;        // no transient log yet
      $("judgeCard").hidden = false;
      $("judgeVerdict").textContent = "Could not judge the run: " + e.message;
      return;
    }
    const v = j.verdict || "–", st = j.steps || {}, b = $("judgeBadge");
    b.className = "badge " + (/^converged/.test(v) ? "ok" : /^statistically stationary/.test(v) ? "warn" : /^still/.test(v) ? "running" : "");
    b.textContent = /^converged/.test(v) ? "converged" : /^statistically stationary/.test(v) ? "stationary, check steps"
      : /^still/.test(v) ? "still developing" : v === "too short" ? "too short" : "–";
    $("judgeVerdict").textContent = v.split("; also check")[0].replace(/, but check:.*$/, "");
    // labels carry the words, values stay short so they fit beside them on a phone
    const rows = [["Window (time steps)", loc(j.window)]];
    if (st.n) {
      rows.push([`Steps reaching p < 1e-3 by outer iteration ${st.outerIterations}`, fmt.pct(st.converged, 0)]);
      rows.push(["p after the last outer iteration, median", fmt.exp(st.medianLastOuterP)]);
      rows.push(["Outer loop cuts p to, median", fmt.pct(st.medianOuterDrop, 0)]);
      rows.push(["Max Courant, median / max", `${fmt.fixed(st.medianMaxCourant, 2)} / ${fmt.fixed(st.maxCourant, 2)}`]);
      rows.push(["Fields bounded (share of steps)", st.bounded ? `${(st.boundedFields || []).join(", ")} (${fmt.pct(st.bounded, 0)})` : "none"]);
    }
    for (const [k, f] of Object.entries(j.forces || {}))
      rows.push([`${k[0].toUpperCase() + k.slice(1)}, ${j.group}: mean, drift between windows`, `${fmt.fixed(f.mean, 2)} N, ${fmt.pct(f.drift)}`]);
    for (const [n, a] of Object.entries(j.average || {}))
      rows.push([`${n}, averaged ${fmt.num(a.from)}–${fmt.num(a.to)} s`, `${fmt.fixed(a.mean, 2)} ± ${fmt.fixed(a.u, 2)} N`]);
    ui.kv($("judgeKv"), rows);
    $("judgeFlags").replaceChildren(...(j.flags || []).map(f => { const li = document.createElement("li"); li.textContent = f; return li; }));
    $("judgeCard").hidden = false;
  }

  function syncTabs() {
    document.querySelectorAll("#forceTabs button").forEach(b => b.classList.toggle("on", b.dataset.k === forceKey));
    document.querySelectorAll("#resTabs button").forEach(b => b.classList.toggle("on", b.dataset.k === resKey));
  }
  document.querySelectorAll("#forceTabs button").forEach(b => { b.onclick = () => { forceKey = b.dataset.k; userPickedForce = true; syncTabs(); drawForces(); }; });
  document.querySelectorAll("#resTabs button").forEach(b => { b.onclick = () => { resKey = b.dataset.k; userPickedRes = true; syncTabs(); drawRes(); }; });

  const xopts = key => key === "ddes"
    ? { xlabel: "t =", xfmt: v => fmt.num(v) + " s" }
    : { xlabel: "iteration" };

  function drawForces() {
    if (!last) return;
    const f = forceKey === "ddes" ? last.forces_ddes : last.forces_steady;
    // every force group the case writes (largest drag first): drag, plus the main group's vertical force
    const S = (f && f.series) || {}, info = (f && f.info) || {}, gs = (info.groups || []).slice(0, 5), col = chart.palette();
    const ser = gs.map((g, i) => ({ name: g + " drag", color: col[i], pts: (S[g] || []).map(p => [p[0], p[1]]) }));
    if (info.total) ser.push({ name: info.total + " " + (info.vertical || "vertical"), color: col[5], pts: (S[info.total] || []).map(p => [p[0], p[2]]) });
    chart.legend($("fLegend"), ser);
    const src = info.source || {};
    $("axesNote").textContent = info.flow ? `Read from the case: drag is the force along the flow (${info.flow}, from ${src.flow || "?"}); ` +
      `${info.vertical || "vertical"} is along ${info.vertical === "downforce" ? "−" : "+"}${info.up} (${src.up || "?"}). Main group: ${info.total}.` : "";
    const ddes = last.ddes || {};
    chart.line($("cForce"), ser, Object.assign({ clip: 0.02, tip: $("tForce"),
      band: forceKey === "ddes" && ddes.avgFrom != null ? [ddes.avgFrom, ddes.end] : null,
      empty: forceKey === "ddes" ? "Transient has not started yet" : "Steady start has not begun yet" }, xopts(forceKey)));
  }

  function drawRes() {
    if (!last) return;
    const r = (resKey === "ddes" ? last.res_ddes : last.res_steady) || {}, col = chart.palette();
    const ser = Object.keys(r).map((n, i) => ({ name: n, color: col[i % col.length], pts: r[n] || [] }));
    chart.legend($("resLegend"), ser);
    chart.line($("cRes"), ser, Object.assign({ log: true, tip: $("tRes"), empty: "No residuals yet" }, xopts(resKey)));
  }
  window.addEventListener("resize", () => { drawForces(); drawRes(); });

  async function tick() {
    try {
      show(await MD.api.get("/live"));
      ui.status($("liveDot"), $("updated"));
    } catch (e) {
      ui.status($("liveDot"), $("updated"), e);
    }
    setTimeout(tick, 15000);
  }
  tick();
})();
