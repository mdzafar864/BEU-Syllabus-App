"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { createHandler } = require("../src/app");
const { loadConfig } = require("../src/config");
const { parseTrackBody } = require("../src/validate");
const { createFakeDb } = require("./fake-db");

const ORIGIN = "https://mdzafar864.github.io";
const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function setup(envOverrides = {}, getDbOverride) {
  const db = createFakeDb();
  const clock = { t: Date.parse("2026-11-16T10:00:00Z") };
  const config = loadConfig({
    NODE_ENV: "production",
    ALLOWED_ORIGINS: ORIGIN,
    ...envOverrides,
  });
  const handler = createHandler({
    config,
    getDb: getDbOverride || (async () => db),
    now: () => clock.t,
  });
  const server = http.createServer(handler);
  return new Promise((resolve) =>
    server.listen(0, () =>
      resolve({
        db,
        clock,
        server,
        port: server.address().port,
        close: () => new Promise((r) => server.close(r)),
      }),
    ),
  );
}

function call(port, { method = "GET", path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode, headers: res.headers, json, text: data });
        });
      },
    );
    req.on("error", reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

const post = (port, payload, extra = {}) =>
  call(port, {
    method: "POST",
    path: "/api/track",
    // text/plain is what the browser sends (avoids a CORS preflight)
    headers: { "Content-Type": "text/plain;charset=UTF-8", Origin: ORIGIN, ...extra },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

// ---------------------------------------------------------------------------

test("health + unknown route", async () => {
  const s = await setup();
  try {
    assert.equal((await call(s.port, { path: "/api/health" })).status, 200);
    const nf = await call(s.port, { path: "/nope" });
    assert.equal(nf.status, 404);
    assert.deepEqual(nf.json, { error: "not_found", method: "GET", path: "/nope" });
    // both /api/<route> and /<route> are served; the bare base URL is not a route
    assert.equal((await call(s.port, { path: "/health" })).status, 200);
    assert.equal((await call(s.port, { path: "/api/health/" })).status, 200);
    assert.equal((await call(s.port, { path: "/api" })).status, 404);
  } finally {
    await s.close();
  }
});

test("CORS: allowed origin, blocked origin, preflight", async () => {
  const s = await setup();
  try {
    const ok = await call(s.port, { path: "/api/health", headers: { Origin: ORIGIN } });
    assert.equal(ok.headers["access-control-allow-origin"], ORIGIN);
    assert.equal(ok.headers.vary, "Origin");

    const bad = await call(s.port, { path: "/api/health", headers: { Origin: "https://evil.example" } });
    assert.equal(bad.status, 403);
    assert.equal(bad.headers["access-control-allow-origin"], undefined);

    const pre = await call(s.port, { method: "OPTIONS", path: "/api/track", headers: { Origin: ORIGIN } });
    assert.equal(pre.status, 204);
    assert.match(pre.headers["access-control-allow-methods"], /POST/);

    // localhost is only accepted outside production
    const local = await call(s.port, { path: "/api/health", headers: { Origin: "http://localhost:5500" } });
    assert.equal(local.status, 403);
  } finally {
    await s.close();
  }
  const dev = await setup({ NODE_ENV: "development" });
  try {
    const local = await call(dev.port, { path: "/api/health", headers: { Origin: "http://localhost:5500" } });
    assert.equal(local.status, 200);
  } finally {
    await dev.close();
  }
});

test("track: stores events + visitor, heartbeat only touches lastSeen", async () => {
  const s = await setup();
  try {
    const r = await post(s.port, {
      visitorId: V1,
      sessionId: S1,
      meta: { displayMode: "standalone", lang: "en-IN", screen: "390x844", path: "/BEU-Syllabus-App/?x=1#y" },
      events: [
        { type: "session_start", name: "session_start", ts: s.clock.t, data: { returning: false } },
        { type: "click", name: "open-btn", ts: s.clock.t, data: { text: "Open Syllabus", branch: "CSE" } },
      ],
    });
    assert.equal(r.status, 204);
    assert.equal(r.headers["access-control-allow-origin"], ORIGIN);

    const events = s.db.collection("events").docs;
    assert.equal(events.length, 2);
    assert.equal(events[1].name, "open-btn");
    assert.equal(events[1].data.branch, "CSE");
    assert.equal(events[1].path, "/BEU-Syllabus-App/", "query/hash stripped");
    assert.equal(events[1].displayMode, "standalone");

    const visitor = s.db.collection("visitors").docs[0];
    assert.equal(visitor._id, V1);
    assert.equal(visitor.events, 2);
    assert.equal(visitor.sessions, 1);
    const firstSeen = visitor.firstSeen;

    // heartbeat later
    s.clock.t += 60_000;
    const hb = await post(s.port, { visitorId: V1, sessionId: S1, events: [] });
    assert.equal(hb.status, 204);
    assert.equal(s.db.collection("events").docs.length, 2, "no events added by heartbeat");
    const v2 = s.db.collection("visitors").docs[0];
    assert.equal(v2.firstSeen.getTime(), firstSeen.getTime(), "firstSeen is never overwritten");
    assert.equal(v2.lastSeen.getTime(), s.clock.t);
    assert.equal(s.db.collection("visitors").docs.length, 1);
  } finally {
    await s.close();
  }
});

test("track: body already parsed by the host (Vercel style) works", async () => {
  const db = createFakeDb();
  const handler = createHandler({
    config: loadConfig({ NODE_ENV: "production" }),
    getDb: async () => db,
  });
  const chunks = [];
  const res = {
    headersSent: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(b) { chunks.push(b); },
  };
  await handler(
    {
      method: "POST",
      url: "/api/track",
      headers: {},
      socket: { remoteAddress: "1.2.3.4" },
      body: JSON.stringify({ visitorId: V1, events: [{ type: "click", name: "x-btn", data: {} }] }),
    },
    res,
  );
  assert.equal(res.status, 204);
  assert.equal(db.collection("events").docs.length, 1);
});

test("track: rejects bad input", async () => {
  const s = await setup();
  try {
    assert.equal((await post(s.port, "{not json")).status, 400);
    assert.equal((await post(s.port, { visitorId: "short", events: [] })).status, 400);
    assert.equal((await post(s.port, { visitorId: V1, events: "nope" })).status, 400);
    assert.equal((await post(s.port, "[]")).status, 400);
    const big = await post(s.port, JSON.stringify({ visitorId: V1, events: [], pad: "x".repeat(40_000) }));
    assert.equal(big.status, 413);
    assert.equal(s.db.collection("events").docs.length, 0);
  } finally {
    await s.close();
  }
});

test("validation: sanitises hostile event data", () => {
  const out = parseTrackBody({
    visitorId: V1,
    events: [
      {
        type: "click",
        name: "ok-btn",
        data: {
          text: "hello\u0000world",
          $set: "x",
          "a.b": "x",
          __proto__: "x",
          nested: { a: 1 },
          list: [1],
          num: 5,
          flag: true,
          long: "y".repeat(500),
          nan: NaN,
        },
      },
      { type: "bogus", name: "x" },
      { type: "click", name: "bad name with spaces" },
      { type: "click", name: "$where" },
      null,
    ],
  });
  assert.equal(out.ok, true);
  assert.equal(out.events.length, 1);
  const d = out.events[0].data;
  assert.deepEqual(Object.keys(d).sort(), ["flag", "long", "num", "text"]);
  assert.equal(d.text, "hello world");
  assert.equal(d.long.length, 200);
});

test("validation: caps events per request and rejects forged timestamps", () => {
  const now = Date.parse("2026-11-16T10:00:00Z");
  const events = Array.from({ length: 80 }, () => ({ type: "click", name: "b", ts: 1 }));
  const out = parseTrackBody({ visitorId: V1, events }, now);
  assert.equal(out.events.length, 25);
  assert.equal(out.events[0].clientTs, null, "implausible client time is dropped");
});

test("stats: total, active window, downloads counter", async () => {
  const s = await setup({ ACTIVE_WINDOW_MINUTES: "5" });
  try {
    await post(s.port, { visitorId: V1, sessionId: S1, events: [{ type: "page_view", name: "page_view" }] });
    s.clock.t += 10 * 60_000; // V1 goes stale
    await post(s.port, { visitorId: V2, events: [] }); // V2 active now

    let stats = (await call(s.port, { path: "/api/stats", headers: { Origin: ORIGIN } })).json;
    assert.equal(stats.totalUsers, 2);
    assert.equal(stats.activeUsers, 1);
    assert.equal(stats.totalDownloads, 0);
    assert.equal(stats.activeWindowMinutes, 5);

    // only an *action* named syllabus_download counts, a raw click does not
    await post(s.port, {
      visitorId: V2,
      events: [
        { type: "click", name: "syllabus_download" },
        { type: "action", name: "syllabus_download", data: { branch: "CSE" } },
        { type: "action", name: "syllabus_share" },
      ],
    });
    stats = (await call(s.port, { path: "/api/stats" })).json;
    assert.equal(stats.totalDownloads, 1, "counter updated and cache invalidated");
  } finally {
    await s.close();
  }
});

test("stats: heartbeats do not bust the cache", async () => {
  const s = await setup();
  try {
    await post(s.port, { visitorId: V1, events: [] });
    const a = (await call(s.port, { path: "/api/stats" })).json;
    await post(s.port, { visitorId: V2, events: [] });
    const b = (await call(s.port, { path: "/api/stats" })).json;
    assert.equal(b.updatedAt, a.updatedAt, "served from the 15s cache");
    s.clock.t += 16_000;
    const c = (await call(s.port, { path: "/api/stats" })).json;
    assert.equal(c.totalUsers, 2);
  } finally {
    await s.close();
  }
});

test("stats: a new visitor shows up immediately, a returning heartbeat does not bust the cache", async () => {
  const s = await setup();
  try {
    const a = (await call(s.port, { path: "/api/stats" })).json;
    assert.equal(a.totalUsers, 0);
    await post(s.port, { visitorId: V1, events: [] }); // brand-new visitor
    const b = (await call(s.port, { path: "/api/stats" })).json;
    assert.equal(b.totalUsers, 1, "new visitor visible without waiting for cache expiry");
    await post(s.port, { visitorId: V1, events: [] }); // same visitor, heartbeat
    const c = (await call(s.port, { path: "/api/stats" })).json;
    assert.equal(c.updatedAt, b.updatedAt, "returning heartbeat leaves the cache alone");
  } finally {
    await s.close();
  }
});

test("rate limit returns 429 with Retry-After", async () => {
  const s = await setup({ RATE_LIMIT_PER_MIN: "3" });
  try {
    for (let i = 0; i < 3; i++) {
      assert.equal((await call(s.port, { path: "/api/stats" })).status, 200);
    }
    const r = await call(s.port, { path: "/api/stats" });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers["retry-after"]) > 0);
    // health is exempt
    assert.equal((await call(s.port, { path: "/api/health" })).status, 200);
  } finally {
    await s.close();
  }
});

test("database outage returns 503, not a crash", async () => {
  const s = await setup({}, async () => { throw new Error("boom"); });
  try {
    const r = await call(s.port, { path: "/api/stats", headers: { Origin: ORIGIN } });
    assert.equal(r.status, 503);
    assert.equal(r.headers["access-control-allow-origin"], ORIGIN);
  } finally {
    await s.close();
  }
});

test("Vercel entry files exist for every route and export the handler", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  for (const route of ["health", "stats", "track"]) {
    const file = path.join(__dirname, "..", "api", `${route}.js`);
    assert.ok(fs.existsSync(file), `api/${route}.js exists`);
    assert.match(fs.readFileSync(file, "utf8"), /require\("\.\.\/src\/instance"\)/);
  }
  assert.ok(!fs.existsSync(path.join(__dirname, "..", "vercel.json")), "no rewrite config to break paths");
});

// ---------------------------------------------------------------------------
// Active-user count must go DOWN when users disconnect
// ---------------------------------------------------------------------------

const activeNow = async (port) =>
  (await call(port, { path: "/api/stats" })).json.activeUsers;

test("active users: default window is 1 minute (was 5)", () => {
  assert.equal(loadConfig({}).activeWindowMinutes, 1);
  assert.equal(loadConfig({ ACTIVE_WINDOW_MINUTES: "0.5" }).activeWindowMs, 30_000);
});

test("active users: an explicit leave drops the count immediately", async () => {
  const s = await setup();
  try {
    await post(s.port, { visitorId: V1, events: [] });
    await post(s.port, { visitorId: V2, events: [] });
    assert.equal(await activeNow(s.port), 2);

    // V1 closes the page: no clock movement, no waiting for the window
    const r = await post(s.port, { visitorId: V1, leave: true, events: [] });
    assert.equal(r.status, 204);
    assert.equal(await activeNow(s.port), 1, "count fell right away (cache busted)");
    assert.equal((await call(s.port, { path: "/api/stats" })).json.totalUsers, 2, "total unaffected");
  } finally {
    await s.close();
  }
});

test("active users: leave still stores the queued events, and a heartbeat brings the user back", async () => {
  const s = await setup();
  try {
    await post(s.port, { visitorId: V1, events: [] });
    await post(s.port, {
      visitorId: V1,
      leave: true,
      events: [{ type: "click", name: "last_click" }],
    });
    assert.equal(s.db.collection("events").docs.length, 1);
    assert.equal(await activeNow(s.port), 0);

    s.clock.t += 6_000; // tab becomes visible again -> heartbeat
    await post(s.port, { visitorId: V1, events: [] });
    s.clock.t += 6_000; // past the 5 s stats cache
    assert.equal(await activeNow(s.port), 1);
  } finally {
    await s.close();
  }
});

test("active users: no leave (crash / dead connection) -> drops after the window", async () => {
  const s = await setup();
  try {
    await post(s.port, { visitorId: V1, events: [] });
    s.clock.t += 50_000;
    assert.equal(await activeNow(s.port), 1, "still inside the 1 minute window");
    s.clock.t += 20_000; // 70 s of silence
    assert.equal(await activeNow(s.port), 0, "timed out without any leave signal");
  } finally {
    await s.close();
  }
});

test("active users: legacy visitor documents without `online` still count", async () => {
  const s = await setup();
  try {
    await post(s.port, { visitorId: V1, events: [] });
    delete s.db.collection("visitors").docs[0].online; // pre-fix document shape
    s.clock.t += 6_000;
    assert.equal(await activeNow(s.port), 1);
  } finally {
    await s.close();
  }
});

test("validate: leave is only true for a real boolean true", () => {
  const now = Date.parse("2026-11-16T10:00:00Z");
  assert.equal(parseTrackBody({ visitorId: V1, leave: true }, now).leave, true);
  for (const bad of ["true", 1, null, undefined, {}]) {
    assert.equal(parseTrackBody({ visitorId: V1, leave: bad }, now).leave, false);
  }
});
