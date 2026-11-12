// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The Mesh Doctor authors
//
// Mesh Doctor front-end core, shared by every page.  No framework, no build step:
//
//     load js/md.js first on every page, then use MD.api, MD.jobs, MD.html, MD.render, MD.fmt
//
// (No closing script tag or HTML comment opener anywhere in web/js/: the report export
// inlines these files into one page, and either would end the script early.)
//
//  * MD.api    the /api/v1 client: one error type (MD.ApiError with .code from
//              the API's error list), the launch token on every POST, JSON only.
//  * MD.jobs   start, follow and cancel jobs (POST /jobs ...).
//  * MD.html   a template tag that escapes every value:  MD.html`<b>${name}</b>`.
//              Nested MD.html results and arrays of them are kept as HTML.
//  * MD.render puts an MD.html result into an element.  It refuses plain strings,
//              so data from a run can never become markup by accident.  Pages
//              use it (or textContent) and never innerHTML.
//  * MD.fmt    number formats used across the pages.
(function (root) {
  "use strict";

  // ---- safe HTML -----------------------------------------------------------
  class Html {
    constructor(s) { this.s = s; }
    toString() { return this.s; }
  }
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = v => String(v).replace(/[&<>"']/g, c => ESC[c]);
  function part(v) {
    if (v == null || v === false) return "";
    if (v instanceof Html) return v.s;
    if (Array.isArray(v)) return v.map(part).join("");
    return esc(v);
  }
  function html(strings, ...values) {
    let s = strings[0];
    for (let i = 0; i < values.length; i++) s += part(values[i]) + strings[i + 1];
    return new Html(s);
  }
  function render(el, h) {
    if (!(h instanceof Html)) throw new TypeError("MD.render takes MD.html`...` only");
    el.innerHTML = h.s;
  }
  const join = (items, sep) => new Html(items.map(part).join(part(sep)));

  // ---- /api/v1 client ------------------------------------------------------
  const BASE = "/api/v1";
  class ApiError extends Error {
    constructor(status, code, message, api) {
      super(message);
      this.name = "ApiError";
      this.status = status;     // HTTP status, 0 if the server could not be reached
      this.code = code;         // the API's error code: not-found, busy, exists, ...
      this.api = !!api;         // false: no Mesh Doctor API answered (offline, a static host, a proxy page)
    }
  }
  function token() {
    const m = typeof document !== "undefined" && document.querySelector('meta[name="md-token"]');
    return m ? m.content : "";
  }
  // a path is a string ("/cases") or a list of segments, each encoded: ["repairs", name, "log"]
  const path = p => typeof p === "string" ? p : "/" + p.map(x => encodeURIComponent(String(x))).join("/");
  function url(p, query) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query || {})) if (v != null && v !== "") q.set(k, String(v));
    const s = q.toString();
    return BASE + path(p) + (s ? "?" + s : "");
  }
  async function call(method, p, query, body) {
    const o = { method, cache: "no-store", headers: { Accept: "application/json" } };
    if (method !== "GET") {
      o.headers["X-MD-Token"] = token();
      if (body !== undefined) {
        o.headers["Content-Type"] = "application/json";
        o.body = JSON.stringify(body);
      }
    }
    let r;
    try {
      r = await api.fetch(url(p, query), o);
    } catch (e) {
      throw new ApiError(0, "unavailable", "cannot reach the Mesh Doctor server");
    }
    const json = /^application\/json\b/.test(r.headers.get("Content-Type") || "");
    const doc = json ? await r.json().catch(() => null) : null;
    if (!r.ok) {
      const e = doc && typeof doc.error === "object" && doc.error;
      throw new ApiError(r.status, (e && e.code) || "internal", (e && e.message) || "HTTP " + r.status, !!e);
    }
    if (doc === null) throw new ApiError(r.status, "internal", "the server did not answer with JSON");
    return doc;
  }
  const api = {
    fetch: (...a) => fetch(...a),              // replaceable in tests
    url,
    get: (p, query) => call("GET", p, query),
    post: (p, body) => call("POST", p, undefined, body),
    // like get, but null when the thing does not exist (yet): an unfinished run, no A/B test
    find: (p, query) => call("GET", p, query).catch(e => {
      if (e.code === "not-found") return null;
      throw e;
    }),
    items: (p, query) => call("GET", p, query).then(d => d.items),
  };

  // ---- jobs ----------------------------------------------------------------
  const ACTIVE = new Set(["queued", "running"]);
  const jobs = {
    ACTIVE,
    start: (kind, params) => api.post("/jobs", { kind, params }),
    get: id => api.get(["jobs", id]),
    cancel: id => api.post(["jobs", id, "cancel"]),
    // start; if a run of that name exists, ask (confirm by default) and replace it only on yes
    async submit(kind, params, ask) {
      try {
        return await jobs.start(kind, params);
      } catch (e) {
        if (e.code !== "exists") throw e;
        // "run r1 already exists; pick another name or replace it" -> "run r1 already exists."
        const what = e.message.split(";")[0];
        const yes = (ask || (m => root.confirm(m)))(what + ".\n\nReplace it? Its results will be deleted.");
        if (!yes) return null;
        return jobs.start(kind, Object.assign({}, params, { replace: true }));
      }
    },
    // calls onUpdate(job) until the job ends; resolves with the finished job
    follow(job, onUpdate, every) {
      return new Promise((resolve, reject) => {
        const tick = async () => {
          try {
            job = await jobs.get(job.id);
          } catch (e) {
            return reject(e);
          }
          if (onUpdate) onUpdate(job);
          if (ACTIVE.has(job.state)) setTimeout(tick, every || 2000);
          else resolve(job);
        };
        if (onUpdate) onUpdate(job);
        setTimeout(tick, every || 2000);
      });
    },
    // "running · correcting (foamMeshDoctor -fix)"
    describe(job) {
      const step = job.progress && job.progress.step;
      return job.state + (step && ACTIVE.has(job.state) ? " · " + step : "") +
        (job.state === "failed" && job.error ? ": " + job.error : "");
    },
  };

  // ---- number formats ------------------------------------------------------
  const isNum = x => typeof x === "number" && isFinite(x);
  // numbers and numeric strings ("1.5", as some solver outputs are stored); anything else is NaN
  const toNum = x => typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  const fmt = {
    isNum,
    // 4 significant digits; integers with separators; exponent for very small or big
    num(x, digits) {
      digits = digits || 4;
      if (!isNum(x)) return "–";
      if (Number.isInteger(x)) return x.toLocaleString();
      const a = Math.abs(x);
      if (a !== 0 && (a < 1e-3 || a >= 1e6)) return x.toExponential(digits - 1);
      const r = +x.toPrecision(digits);     // toLocaleString alone would cut 0.00312 to 0.003
      return a >= 1000 ? r.toLocaleString(undefined, { maximumFractionDigits: 20 }) : String(r);
    },
    // d significant digits with trailing zeros, as checkMesh prints them (4.000, not 4); integers in full
    sig: (x, d) => !isNum(x) ? "–" : Number.isInteger(x) ? x.toLocaleString() : x.toPrecision(d || 4),
    fixed: (x, d) => isNum(x = toNum(x)) ? x.toFixed(d) : "–",
    exp: (x, d) => isNum(x = toNum(x)) ? x.toExponential(d == null ? 2 : d) : "–",
    pct: (x, d) => isNum(x = toNum(x)) ? (100 * x).toFixed(d == null ? 1 : d) + " %" : "–",
    int: x => isNum(x = toNum(x)) ? Math.round(x).toLocaleString() : "–",
    // with separators and exactly d decimals: 1,234.5
    loc: (x, d) => isNum(x = toNum(x)) ? x.toLocaleString(undefined, { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }) : "–",
    dur(s) {
      if (s == null || !isFinite(s)) return "–";
      s = Math.max(0, s);
      const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = Math.floor(s % 60);
      return h ? `${h} h ${m} min` : m ? `${m} min ${sec} s` : `${sec} s`;
    },
    xyz: (c, d) => Array.isArray(c) ? "(" + c.map(v => fmt.fixed(v, d == null ? 3 : d)).join(", ") + ")" : "–",
  };

  // ---- small DOM helpers (text only) -----------------------------------------
  const ui = {
    // a <dl> of [label, value] rows
    kv(el, rows) {
      el.replaceChildren(...rows.flatMap(([k, v]) => {
        const dt = document.createElement("dt"), dd = document.createElement("dd");
        dt.textContent = k; dd.textContent = v;
        return [dt, dd];
      }));
    },
    // a progress bar's <i>: width from frac (0..1), colour from the state
    bar(el, frac, state) {
      el.style.width = (Math.max(0, Math.min(1, frac || 0)) * 100).toFixed(1) + "%";
      el.className = state === "done" ? "ok" : state === "error" ? "err" : state === "running" ? "run" : "";
    },
    // the header's "live · 22:41:07" / "monitor offline (...)" line
    status(dot, text, err) {
      dot.className = err ? "dot" : "dot live";
      text.textContent = err ? "monitor offline (" + (err.message || err) + ")" : "live · " + new Date().toLocaleTimeString();
    },
  };

  const MD = { html, render, join, esc, Html, api, ApiError, jobs, fmt, ui, version: "1" };
  root.MD = MD;
  if (typeof module === "object" && module.exports) module.exports = MD;
})(typeof window !== "undefined" ? window : globalThis);
