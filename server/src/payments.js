"use strict";

// Razorpay donations: create an order, verify the payment, receive webhooks.
//
//   POST /api/create-order      { amount (whole rupees), name? }  -> order details for Checkout
//   POST /api/verify-payment    { razorpay_order_id, razorpay_payment_id, razorpay_signature }
//   POST /api/razorpay-webhook  (called by Razorpay; signed with the webhook secret)
//
// Security rules this file follows:
//   * The key SECRET never leaves the server and is never logged.
//   * The amount is validated and converted to paise on the server; the browser
//     only suggests a number of rupees.
//   * A payment counts as paid only after the HMAC signature is verified AND the
//     payment is fetched from Razorpay and matches our stored order.
//   * Every state change is idempotent (safe if the browser retries or Razorpay
//     re-sends a webhook).

const crypto = require("node:crypto");
const { createLimiter } = require("./app");
const { createRazorpayLite } = require("./razorpay-lite");

const MAX_JSON_BYTES = 8 * 1024;
const MAX_WEBHOOK_BYTES = 256 * 1024;
const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const ID_RE = /^[A-Za-z0-9_]{6,40}$/; // order_XXXX / pay_XXXX
const SIG_RE = /^[a-f0-9]{64}$/i; // hex HMAC-SHA256

// Razorpay (like most gateways) wants the SMALLEST currency unit: paise for INR,
// so 1 rupee = 100 paise (exponent 2). Anything stored in `amount` is in paise.
const MINOR_EXPONENT = { INR: 2 };

// Whole major units (rupees) -> minor units (paise), integer-only (no floats).
function toMinorUnits(major, currency = "INR") {
  const exp = MINOR_EXPONENT[currency];
  if (exp === undefined || !Number.isInteger(major)) {
    throw new Error("unsupported_amount");
  }
  return major * 10 ** exp;
}

// Minor units -> major units, for humans (logs, dashboards, analytics).
function fromMinorUnits(minor, currency = "INR") {
  return minor / 10 ** MINOR_EXPONENT[currency];
}

// ---------------------------------------------------------------------------
// Crypto helpers (exported for tests)
// ---------------------------------------------------------------------------
function hmacHex(secret, data) {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

// Constant-time comparison; never throws on length mismatch.
function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), "utf8");
  const y = Buffer.from(String(b), "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Checkout signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
function verifyCheckoutSignature({ orderId, paymentId, signature }, keySecret) {
  if (!keySecret || !SIG_RE.test(String(signature))) {
    return false;
  }
  return safeEqualHex(hmacHex(keySecret, `${orderId}|${paymentId}`), signature);
}

// Webhook signature: HMAC_SHA256(raw_body, webhook_secret)
function verifyWebhookSignature(rawBody, signature, webhookSecret) {
  if (!webhookSecret || !SIG_RE.test(String(signature))) {
    return false;
  }
  return safeEqualHex(hmacHex(webhookSecret, rawBody), signature);
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------
function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) {
    return fwd.split(",")[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function readStream(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
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

// JSON body. Vercel may already have parsed it into req.body.
async function readJson(req) {
  let raw = req.body;
  if (raw === undefined || raw === null) {
    raw = await readStream(req, MAX_JSON_BYTES);
  }
  if (Buffer.isBuffer(raw)) {
    raw = raw.toString("utf8");
  }
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("bad_json"), { status: 400 });
  }
  return parsed;
}

// RAW body for webhooks. The signature is over the exact bytes Razorpay sent,
// so a re-serialized JSON object would NOT match. Returns null if the raw body
// is unavailable (the caller then fails closed with 400).
async function readRawBody(req) {
  if (typeof req.rawBody === "string") {
    return req.rawBody;
  }
  if (Buffer.isBuffer(req.rawBody)) {
    return req.rawBody.toString("utf8");
  }
  if (req.readableEnded) {
    return null; // stream already consumed by a body parser
  }
  return readStream(req, MAX_WEBHOOK_BYTES);
}

function cleanName(value) {
  // Optional donor name: strip control chars, collapse spaces, cap length.
  return String(value || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------
// getDb: () => Promise<Db>; getRazorpay: () => Razorpay client (injectable for tests)
function createPaymentsHandlers({
  config,
  getDb,
  getRazorpay = defaultRazorpayFactory(config),
  now = () => Date.now(),
}) {
  const limiter = createLimiter({
    windowMs: 60 * 1000,
    max: config.donationRateLimitPerMin,
  });
  let indexesReady = false;

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
      // Payment responses must never be cached by a browser or CDN.
      "Cache-Control": "no-store",
      ...headers,
    });
    res.end(payload);
  }

  // Shared preamble for browser-called routes: CORS, preflight, method, rate limit.
  // Returns the CORS headers to use, or null if the response was already sent.
  function browserPreamble(req, res) {
    const origin = req.headers.origin;
    const cors = {};
    if (origin) {
      if (!originAllowed(origin)) {
        send(res, 403, { error: "origin_not_allowed" });
        return null;
      }
      cors["Access-Control-Allow-Origin"] = origin;
      cors.Vary = "Origin";
    }
    if (req.method === "OPTIONS") {
      send(res, 204, undefined, {
        ...cors,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      });
      return null;
    }
    if (req.method !== "POST") {
      send(res, 405, { error: "method_not_allowed" }, { ...cors, Allow: "POST, OPTIONS" });
      return null;
    }
    const wait = limiter(clientIp(req), now());
    if (wait) {
      send(res, 429, { error: "rate_limited" }, { ...cors, "Retry-After": String(wait) });
      return null;
    }
    if (!config.razorpayKeyId || !config.razorpayKeySecret) {
      console.error("[payments] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set");
      send(res, 503, { error: "payments_not_configured" }, cors);
      return null;
    }
    return cors;
  }

  async function ensureIndexes(db) {
    if (indexesReady) {
      return;
    }
    try {
      const donations = db.collection("donations");
      await Promise.all([
        // one Razorpay payment can only ever be recorded against one order
        donations.createIndex(
          { paymentId: 1 },
          {
            name: "paymentId_unique",
            unique: true,
            partialFilterExpression: { paymentId: { $type: "string" } },
          },
        ),
        donations.createIndex({ createdAt: -1 }),
      ]);
      indexesReady = true; // only after success, so a transient failure is retried
    } catch (err) {
      console.error("[payments] index setup failed:", err.message);
    }
  }

  // ----- POST /api/create-order -------------------------------------------
  // ----- GET /api/create-order?warm=1 -------------------------------------
  // Called by the page (fire-and-forget, no-cors) when a visitor shows
  // interest in donating, so the function instance and the Atlas connection
  // are already warm when they press Donate. It touches no payment data,
  // returns nothing, and shares the donation rate limit.
  async function warm(req, res) {
    const wait = limiter(clientIp(req), now());
    if (!wait) {
      try {
        await getDb();
      } catch {
        // ignored: a failed warm-up must never matter to anyone
      }
    }
    send(res, 204, undefined);
  }

  async function createOrder(req, res) {
    if (req.method === "GET") {
      return warm(req, res);
    }
    const cors = browserPreamble(req, res);
    if (!cors) {
      return;
    }
    try {
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        return send(res, err.status || 400, { error: "bad_request" }, cors);
      }

      // Whole rupees only; reject strings like "1e3", NaN, negatives, decimals.
      // Only a JSON number or a plain digit string is accepted (no "1e3", no arrays).
      const rupees =
        typeof body.amount === "number"
          ? body.amount
          : typeof body.amount === "string" && /^\d{1,6}$/.test(body.amount)
            ? Number(body.amount)
            : NaN;
      if (
        !Number.isInteger(rupees) ||
        rupees < config.donationMinInr ||
        rupees > config.donationMaxInr
      ) {
        return send(
          res,
          400,
          {
            error: "invalid_amount",
            min: config.donationMinInr,
            max: config.donationMaxInr,
          },
          cors,
        );
      }
      const donorName = cleanName(body.name);

      const receipt = `don_${now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`; // <= 40 chars

      // The two slow, independent steps run at the same time: connecting to
      // Atlas (+ the once-per-instance index check) and creating the order at
      // Razorpay. Sequentially their latencies add up; this way the request
      // takes as long as the slower of the two. The order is only returned to
      // the browser after it has been stored (below), exactly as before.
      const dbReady = getDb().then(async (database) => {
        await ensureIndexes(database);
        return database;
      });
      const orderReady = getRazorpay().orders.create({
        amount: toMinorUnits(rupees), // paise, computed here, never taken from the client
        currency: "INR",
        receipt,
        notes: { purpose: "donation", app: "beu-syllabus", donor: donorName },
      });
      const [db, order] = await Promise.all([dbReady, orderReady]);

      await db.collection("donations").insertOne({
        _id: order.id,
        receipt,
        amount: order.amount, // PAISE (1 rupee = 100), the unit Razorpay uses
        amountInr: fromMinorUnits(order.amount, order.currency), // same value in rupees, for reading the DB
        currency: order.currency,
        donorName,
        status: "created",
        createdAt: new Date(now()),
      });

      return send(
        res,
        200,
        {
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          keyId: config.razorpayKeyId, // public key id only
        },
        cors,
      );
    } catch (err) {
      // Razorpay SDK errors carry statusCode + error.description; never echo them.
      console.error("[payments] create-order failed:", err && (err.error || err.message));
      return send(res, 502, { error: "order_creation_failed" }, cors);
    }
  }

  // ----- POST /api/verify-payment -----------------------------------------
  async function verifyPayment(req, res) {
    const cors = browserPreamble(req, res);
    if (!cors) {
      return;
    }
    try {
      let body;
      try {
        body = await readJson(req);
      } catch (err) {
        return send(res, err.status || 400, { error: "bad_request" }, cors);
      }

      const orderId = body.razorpay_order_id;
      const paymentId = body.razorpay_payment_id;
      const signature = body.razorpay_signature;
      if (
        typeof orderId !== "string" ||
        typeof paymentId !== "string" ||
        typeof signature !== "string" ||
        !ID_RE.test(orderId) ||
        !ID_RE.test(paymentId)
      ) {
        return send(res, 400, { error: "bad_request" }, cors);
      }

      // 1. Signature: proves Razorpay (not the browser) issued this payment.
      if (!verifyCheckoutSignature({ orderId, paymentId, signature }, config.razorpayKeySecret)) {
        console.warn("[payments] bad signature for order", orderId);
        return send(res, 400, { verified: false, error: "invalid_signature" }, cors);
      }

      // 2. The order must be one WE created.
      const db = await getDb();
      const donations = db.collection("donations");
      const doc = await donations.findOne({ _id: orderId });
      if (!doc) {
        return send(res, 404, { verified: false, error: "unknown_order" }, cors);
      }
      if (doc.status === "paid") {
        // Idempotent: the same payment verified twice is fine; a different one is not.
        return doc.paymentId === paymentId
          ? send(res, 200, { verified: true, status: "paid" }, cors)
          : send(res, 409, { verified: false, error: "order_already_paid" }, cors);
      }

      // 3. Ask Razorpay directly: amount, currency, order and status must match.
      let payment;
      try {
        payment = await getRazorpay().payments.fetch(paymentId);
      } catch (err) {
        console.error("[payments] payment fetch failed:", err && (err.error || err.message));
        // Signature is valid; the webhook will settle this order. Tell the client to retry.
        return send(res, 502, { verified: false, error: "verification_unavailable" }, cors);
      }
      if (
        !payment ||
        payment.order_id !== orderId ||
        payment.amount !== doc.amount ||
        payment.currency !== doc.currency
      ) {
        console.error("[payments] payment/order mismatch for", orderId);
        return send(res, 400, { verified: false, error: "payment_mismatch" }, cors);
      }
      if (payment.status !== "captured" && payment.status !== "authorized") {
        return send(res, 402, { verified: false, error: "payment_not_successful", status: payment.status }, cors);
      }

      const status = payment.status === "captured" ? "paid" : "authorized";
      const result = await markPayment(donations, doc, payment, status);
      if (result && result.matchedCount === 0) {
        const fresh = await donations.findOne({ _id: doc._id });
        if (!fresh || fresh.paymentId !== payment.id) {
          console.error("[payments] verify could not record payment for", doc._id);
          return send(res, 409, { verified: false, error: "order_already_paid" }, cors);
        }
        return send(res, 200, { verified: true, status: fresh.status }, cors);
      }
      return send(res, 200, { verified: true, status }, cors);
    } catch (err) {
      console.error("[payments] verify-payment failed:", err && (err.error || err.message));
      return send(res, 500, { verified: false, error: "server_error" }, cors);
    }
  }

  // Moves created/authorized -> paid/authorized exactly once.
  async function markPayment(donations, doc, payment, status) {
    const result = await donations.updateOne(
      { _id: doc._id, status: { $in: ["created", "authorized"] } },
      {
        $set: {
          status,
          paymentId: payment.id,
          method: payment.method || "",
          verifiedAt: new Date(now()),
        },
      },
    );
    if (!result || result.matchedCount === 0) {
      // Not an error (a webhook and /verify-payment can race), but never silent.
      console.warn("[payments] markPayment changed nothing for", doc._id, "->", status);
    } else {
      console.log("[payments] order", doc._id, "marked", status);
    }
    return result;
  }

  // ----- POST /api/razorpay-webhook ---------------------------------------
  // Safety net for "paid, but the browser closed before /verify-payment ran".
  // Dashboard: Settings -> Webhooks -> URL .../api/razorpay-webhook,
  // events: payment.captured, order.paid, payment.failed; set the same secret
  // as RAZORPAY_WEBHOOK_SECRET.
  async function webhook(req, res) {
    try {
      if (req.method !== "POST") {
        return send(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
      }
      if (!config.razorpayWebhookSecret) {
        console.error("[payments] RAZORPAY_WEBHOOK_SECRET is not set");
        return send(res, 503, { error: "webhook_not_configured" });
      }

      const raw = await readRawBody(req);
      if (raw === null) {
        // Fail closed: never "fix" this by re-serializing parsed JSON.
        console.error("[payments] webhook raw body unavailable");
        return send(res, 400, { error: "raw_body_unavailable" });
      }
      const signature = req.headers["x-razorpay-signature"];
      if (!verifyWebhookSignature(raw, signature, config.razorpayWebhookSecret)) {
        return send(res, 400, { error: "invalid_signature" });
      }

      let event;
      try {
        event = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: "bad_request" });
      }

      const payment =
        event && event.payload && event.payload.payment && event.payload.payment.entity;
      if (!payment || typeof payment.order_id !== "string") {
        return send(res, 200, { ok: true, ignored: true });
      }

      const db = await getDb();
      const donations = db.collection("donations");
      const doc = await donations.findOne({ _id: payment.order_id });
      if (!doc) {
        // Not one of our orders (the Razorpay account may serve other products).
        // Answer 200 so Razorpay does not keep retrying.
        console.warn("[payments] webhook for unknown order", payment.order_id, "event", event.event);
        return send(res, 200, { ok: true, ignored: true });
      }

      if (event.event === "payment.authorized") {
        if (
          payment.amount === doc.amount &&
          payment.currency === doc.currency &&
          payment.status === "authorized"
        ) {
          await markPayment(donations, doc, payment, "authorized");
        }
      } else if (event.event === "payment.captured" || event.event === "order.paid") {
        if (
          payment.amount === doc.amount &&
          payment.currency === doc.currency &&
          payment.status === "captured"
        ) {
          await markPayment(donations, doc, payment, "paid");
        } else {
          console.error(
            "[payments] webhook payment/order mismatch for",
            doc._id,
            JSON.stringify({
              payAmount: payment.amount,
              docAmount: doc.amount,
              payCurrency: payment.currency,
              docCurrency: doc.currency,
              payStatus: payment.status,
            }),
          );
        }
      } else if (event.event === "payment.failed" && doc.status === "created") {
        await donations.updateOne(
          { _id: doc._id, status: "created" },
          {
            $set: {
              lastFailure: {
                code: String((payment.error_code || "")).slice(0, 80),
                at: new Date(now()),
              },
            },
          },
        );
      }
      return send(res, 200, { ok: true });
    } catch (err) {
      console.error("[payments] webhook failed:", err && (err.error || err.message));
      // 500 makes Razorpay retry, which is what we want for transient DB errors.
      return send(res, 500, { error: "server_error" });
    }
  }

  return { createOrder, verifyPayment, webhook };
}

// Lazily builds ONE Razorpay client per warm serverless instance.
function defaultRazorpayFactory(config) {
  let client = null;
  return function getRazorpay() {
    if (!client) {
      client = createRazorpayLite({
        keyId: config.razorpayKeyId,
        keySecret: config.razorpayKeySecret,
      });
    }
    return client;
  };
}

module.exports = {
  createPaymentsHandlers,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  hmacHex,
  toMinorUnits,
  fromMinorUnits,
};
