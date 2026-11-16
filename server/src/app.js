"use strict";

const { parseTrackBody } = require("./validate");

const MAX_BODY_BYTES = 32 * 1024;
const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// Fixed-window limiter, per key. Returns 0 when allowed, otherwise the number
// of seconds to wait. In-memory: each server instance counts on its own.
function createLimiter({ windowMs, max }) {
  const hits = new Map();
  return function check(key, now = Date.now()) {
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (hits.size > 5000) {
      for (const [k, v] of hits) {
        if (v.reset <= now) {
          hits.delete(k);
        }
      }
    }
    return entry.count <= max ? 0 : Math.ceil((entry.reset - now) / 1000);
  };
}

// Reads the request body. Some hosts (e.g. Vercel) pre-parse it into req.body
// and have already consumed the stream, so that case is handled first.
function readBody(req, limit = MAX_BODY_BYTES) {
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) {
      return Promise.resolve(req.body.toString("utf8"));
    }
    return Promise.resolve(req.body); // string or already-parsed object
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true; // keep draining, but stop storing
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("payload_too_large"), { status: 413 }));
      } else {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    req.on("error", reject);
  });
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string" && fwd) {
      return fwd.split(",")[0].trim();
    }
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------
// getDb: () => Promise<Db>   (injected so tests can pass an in-memory fake)
function createHandler({ getDb, config, now = () => Date.now() }) {
  const limiter = createLimiter({
    windowMs: 60 * 1000,
    max: config.rateLimitPerMin,
  });
  let statsCache = null; // { at, value }
  let indexesReady = false;
  let lastIndexAttempt = 0;

  function originAllowed(origin) {
    return (
      config.allowedOrigins.includes(origin) ||
      (config.allowLocalhost && LOCALHOST_RE.test(origin))
    );
  }

  function send(res, status, body, headers = {}) {
    const payload = body === undefined ? "" : JSON.stringify(body);
    res.writeHead(status, {
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json; charset=utf-8" }),
      "X-Content-Type-Options": "nosniff",
      ...headers,
    });
    res.end(payload);
  }

  // Index creation is idempotent; failures are logged and retried at most
  // every 5 minutes so a bad index never takes the API down.
  async function ensureIndexes(db) {
    if (indexesReady || now() - lastIndexAttempt < 5 * 60 * 1000) {
      return;
    }
    lastIndexAttempt = now();
    try {
      const events = db.collection("events");
      const ttlSeconds = Math.round(config.eventTtlDays * 24 * 60 * 60);
      await Promise.all([
        ttlSeconds > 0
          ? events.createIndex(
              { createdAt: 1 },
              { name: "createdAt_ttl", expireAfterSeconds: ttlSeconds },
            )
          : events.createIndex({ createdAt: 1 }, { name: "createdAt_ttl" }),
        events.createIndex({ type: 1, name: 1, createdAt: -1 }),
        events.createIndex({ visitorId: 1, createdAt: -1 }),
        db.collection("visitors").createIndex({ lastSeen: -1 }),
      ]);
      indexesReady = true;
    } catch (err) {
      console.error("[api] index setup failed:", err.message);
    }
  }

  async function computeStats(db) {
    const t = now();
    if (statsCache && t - statsCache.at < config.statsCacheMs) {
      return statsCache.value;
    }
    const since = new Date(t - config.activeWindowMs);
    const visitors = db.collection("visitors");
    const [totalUsers, activeUsers, downloads] = await Promise.all([
      visitors.estimatedDocumentCount(),
      visitors.countDocuments({ lastSeen: { $gte: since } }),
      db.collection("counters").findOne({ _id: "downloads" }),
    ]);
    const value = {
      totalUsers,
      activeUsers,
      totalDownloads: downloads && downloads.value ? downloads.value : 0,
      activeWindowMinutes: config.activeWindowMinutes,
      updatedAt: new Date(t).toISOString(),
    };
    statsCache = { at: t, value };
    return value;
  }

  async function handleTrack(req, res, db, cors) {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return send(res, err.status || 400, { error: "bad_request" }, cors);
    }

    const parsed = parseTrackBody(body, now());
    if (!parsed.ok) {
      return send(res, 400, { error: parsed.error }, cors);
    }

    await ensureIndexes(db);

    const t = now();
    const createdAt = new Date(t);
    const { visitorId, sessionId, meta, events } = parsed;

    if (events.length) {
      await db.collection("events").insertMany(
        events.map((e) => ({
          visitorId,
          sessionId,
          type: e.type,
          name: e.name,
          data: e.data,
          path: meta.path || "",
          displayMode: meta.displayMode || "",
          clientTs: e.clientTs,
          createdAt,
        })),
        { ordered: false },
      );
    }

    // One document per visitor: powers "Total users" and "Active users".
    // An empty events array is a heartbeat (just refreshes lastSeen).
    const ua = String(req.headers["user-agent"] || "").slice(0, 200);
    const sessions = events.filter((e) => e.type === "session_start").length;
    const update = {
      $setOnInsert: { firstSeen: createdAt },
      $set: {
        lastSeen: createdAt,
        ua,
        ...(meta.lang ? { lang: meta.lang } : {}),
        ...(meta.screen ? { screen: meta.screen } : {}),
        ...(meta.displayMode ? { displayMode: meta.displayMode } : {}),
      },
    };
    const inc = {};
    if (events.length) {
      inc.events = events.length;
    }
    if (sessions) {
      inc.sessions = sessions;
    }
    if (Object.keys(inc).length) {
      update.$inc = inc;
    }
    const result = await db
      .collection("visitors")
      .updateOne({ _id: visitorId }, update, { upsert: true });
    if (result && result.upsertedCount) {
      statsCache = null; // a new user: show the new total right away
    }

    // Downloads are kept in an atomic counter so the total survives the
    // events TTL and costs O(1) to read.
    const downloads = events.filter(
      (e) => e.type === "action" && e.name === "syllabus_download",
    ).length;
    if (downloads) {
      await db
        .collection("counters")
        .updateOne(
          { _id: "downloads" },
          { $inc: { value: downloads } },
          { upsert: true },
        );
      statsCache = null; // show the new download total right away
    }

    return send(res, 204, undefined, cors);
  }

  return async function handler(req, res) {
    try {
      const origin = req.headers.origin;
      const cors = {};

      if (origin) {
        if (!originAllowed(origin)) {
          return send(res, 403, { error: "origin_not_allowed" });
        }
        cors["Access-Control-Allow-Origin"] = origin;
        cors.Vary = "Origin";
      }

      if (req.method === "OPTIONS") {
        return send(res, 204, undefined, {
          ...cors,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        });
      }

      const path =
        new URL(req.url, "http://localhost").pathname.replace(/\/+$/, "") ||
        "/";

      if (req.method === "GET" && path === "/api/health") {
        return send(res, 200, { ok: true }, cors);
      }

      const isStats = req.method === "GET" && path === "/api/stats";
      const isTrack = req.method === "POST" && path === "/api/track";
      if (!isStats && !isTrack) {
        return send(res, 404, { error: "not_found" }, cors);
      }

      const wait = limiter(clientIp(req, config.trustProxy), now());
      if (wait) {
        return send(res, 429, { error: "rate_limited" }, {
          ...cors,
          "Retry-After": String(wait),
        });
      }

      let db;
      try {
        db = await getDb();
      } catch (err) {
        console.error("[api] database unavailable:", err.message);
        return send(res, 503, { error: "database_unavailable" }, cors);
      }

      if (isStats) {
        const stats = await computeStats(db);
        return send(res, 200, stats, {
          ...cors,
          "Cache-Control": "public, max-age=15",
        });
      }

      return await handleTrack(req, res, db, cors);
    } catch (err) {
      console.error("[api] unhandled error:", err);
      if (!res.headersSent) {
        return send(res, 500, { error: "server_error" });
      }
      res.end();
    }
  };
}

module.exports = { createHandler, createLimiter };
