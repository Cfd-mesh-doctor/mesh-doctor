// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The Mesh Doctor authors
//
// Tests for the shared front-end core (meshdoctor/web/js/md.js).   node --test "tests/js/*.test.js"
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const MD = require(path.join(__dirname, "..", "..", "meshdoctor", "web", "js", "md.js"));

test("html escapes every value, keeps nested templates", () => {
  const name = `<img src=x onerror="alert(1)">'&`;
  const h = MD.html`<b title="${name}">${name}</b>${MD.html`<i>${1}</i>`}`;
  assert.equal(String(h), '<b title="&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;">' +
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;</b><i>1</i>");
  assert.equal(String(MD.html`${[MD.html`<li>${"a<"}</li>`, "<li>"]}`), "<li>a&lt;</li>&lt;li&gt;");
  assert.equal(String(MD.html`${null}${undefined}${false}${0}`), "0");
  assert.equal(String(MD.join(["<a>", MD.html`<b></b>`], MD.html`<br>`)), "&lt;a&gt;<br><b></b>");
});

test("render refuses plain strings", () => {
  const el = {};
  assert.throws(() => MD.render(el, "<b>x</b>"), TypeError);
  MD.render(el, MD.html`<b>${"x"}</b>`);
  assert.equal(el.innerHTML, "<b>x</b>");
});

function fakeServer(routes) {
  const calls = [];
  MD.api.fetch = async (url, o) => {
    calls.push({ url, ...o });
    const [status, doc, ctype] = routes(url, o);
    return {
      ok: status < 300, status,
      headers: { get: k => (k === "Content-Type" ? ctype || "application/json" : null) },
      json: async () => doc,
    };
  };
  return calls;
}

test("api: v1 paths, encoded segments, query, token on POST", async () => {
  const calls = fakeServer(() => [200, { items: ["a"] }]);
  assert.deepEqual(await MD.api.items(["repairs", "a b/..", "log"], { tag: "after", x: "", y: null }), ["a"]);
  assert.equal(calls[0].url, "/api/v1/repairs/a%20b%2F../log?tag=after");
  assert.equal(calls[0].headers["X-MD-Token"], undefined);
  await MD.api.post("/jobs", { kind: "repair" });
  assert.equal(calls[1].method, "POST");
  assert.equal(calls[1].headers["Content-Type"], "application/json");
  assert.equal(calls[1].body, '{"kind":"repair"}');
  assert.ok("X-MD-Token" in calls[1].headers);
});

test("api: errors carry the API's code; find turns not-found into null", async () => {
  fakeServer(url => url.includes("nope") ? [404, { error: { code: "not-found", message: "no run nope" } }]
    : url.includes("busy") ? [409, { error: { code: "busy", message: "a job runs" } }]
      : [200, "<html>", "text/html"]);
  assert.equal(await MD.api.find(["repairs", "nope"]), null);
  await assert.rejects(MD.api.get("/busy"), e => e instanceof MD.ApiError && e.code === "busy" && e.status === 409);
  await assert.rejects(MD.api.get("/page"), e => e.code === "internal" && /JSON/.test(e.message));
  MD.api.fetch = async () => { throw new TypeError("network"); };
  await assert.rejects(MD.api.get("/x"), e => e.code === "unavailable" && e.status === 0);
});

test("jobs.submit replaces an existing run only when the user says yes", async () => {
  const bodies = [];
  fakeServer((url, o) => {
    const b = JSON.parse(o.body);
    bodies.push(b);
    return b.params.replace ? [202, { id: "j1", state: "queued" }]
      : [409, { error: { code: "exists", message: "run r1 already exists; pick another name or replace it" } }];
  });
  let asked = "";
  assert.equal(await MD.jobs.submit("repair", { source: "c", name: "r1" }, m => { asked = m; return false; }), null);
  assert.equal(asked, "run r1 already exists.\n\nReplace it? Its results will be deleted.");
  assert.equal(bodies.length, 1);
  const job = await MD.jobs.submit("repair", { source: "c", name: "r1" }, () => true);
  assert.equal(job.id, "j1");
  assert.deepEqual(bodies[2].params, { source: "c", name: "r1", replace: true });
});

test("jobs.follow reports each state until the job ends", async () => {
  const states = ["running", "running", "done"];
  fakeServer(() => [200, { id: "j1", state: states.shift(), progress: { step: "grouping" } }]);
  const seen = [];
  const end = await MD.jobs.follow({ id: "j1", state: "queued" }, j => seen.push(MD.jobs.describe(j)), 1);
  assert.equal(end.state, "done");
  assert.deepEqual(seen, ["queued", "running · grouping", "running · grouping", "done"]);
  assert.equal(MD.jobs.describe({ state: "failed", error: "exit code 1: boom" }), "failed: exit code 1: boom");
});

test("formats", () => {
  const f = MD.fmt;
  assert.equal(f.num(0.0031234), "0.003123");
  assert.equal(f.num(1.23e-5), "1.230e-5");
  assert.equal(f.num(12), (12).toLocaleString());
  assert.equal(f.num("12"), "–");
  assert.equal(f.sig(3.99997), "4.000");
  assert.equal(f.sig(9.47193), "9.472");
  assert.equal(f.sig("9.4"), "–");
  assert.equal(f.fixed("1.5", 2), "1.50");
  assert.equal(f.fixed(null, 2), "–");
  assert.equal(f.fixed("", 2), "–");
  assert.equal(f.fixed("<b>", 2), "–");
  assert.equal(f.exp(0.000123), "1.23e-4");
  assert.equal(f.pct(0.1234), "12.3 %");
  assert.equal(f.dur(3725), "1 h 2 min");
  assert.equal(f.xyz([1, 2.5, "x"], 1), "(1.0, 2.5, –)");
  assert.equal(f.xyz("bad"), "–");
});
