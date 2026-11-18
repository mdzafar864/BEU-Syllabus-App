"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { loadConfig } = require("../src/config");
const { createPaymentsHandlers, hmacHex } = require("../src/payments");

const ORIGIN = "https://mdzafar864.github.io";
const KEY_SECRET = "test_key_secret_value";
const WEBHOOK_SECRET = "test_webhook_secret_value";

// ---- in-memory stand-ins (no Atlas, no Razorpay, no network) ---------------
function fakeDb() {
  const docs = new Map();
  const matches = (doc, filter) =>
    Object.entries(filter).every(([k, v]) =>
      v && typeof v === "object" && v.$in ? v.$in.includes(doc[k]) : doc[k] === v,
    );
  const donations = {
    docs,
    async createIndex() {},
    async insertOne(doc) {
      docs.set(doc._id, { ...doc });
    },
    async findOne(filter) {
      for (const d of docs.values()) if (matches(d, filter)) return { ...d };
      return null;
    },
    async updateOne(filter, update) {
      for (const d of docs.values()) {
        if (matches(d, filter)) {
          Object.assign(d, update.$set);
          return { matchedCount: 1, modifiedCount: 1 };
        }
      }
      return { matchedCount: 0, modifiedCount: 0 };
    },
  };
  return { collection: () => donations, donations };
}

function fakeRazorpay() {
  const calls = { orders: [], fetches: [] };
  const payments = new Map();
  return {
    calls,
    payments,
    client: {
      orders: {
        async create(params) {
          calls.orders.push(params);
          return { id: "order_TEST000001", amount: params.amount, currency: params.currency };
        },
      },
      payments: {
        async fetch(id) {
          calls.fetches.push(id);
          const p = payments.get(id);
          if (!p) throw { error: { description: "not found" } };
          return p;
        },
      },
    },
  };
}

async function setup() {
  const config = loadConfig({
    RAZORPAY_KEY_ID: "rzp_test_abc",
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    NODE_ENV: "production",
  });
  const db = fakeDb();
  const rp = fakeRazorpay();
  const h = createPaymentsHandlers({ config, getDb: async () => db, getRazorpay: () => rp.client });
  const routes = {
    "/create": h.createOrder,
    "/verify": h.verifyPayment,
    "/hook": h.webhook,
  };
  const server = http.createServer((req, res) => routes[req.url](req, res));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return { db, rp, post, close: () => { server.closeAllConnections(); server.close(); } };
}

const sign = (orderId, paymentId) => hmacHex(KEY_SECRET, `${orderId}|${paymentId}`);

// ---------------------------------------------------------------------------
test("create-order: converts rupees to paise on the server and stores the order", async () => {
  const t = await setup();
  try {
  const res = await t.post("/create", { amount: 100, name: "  Asha <b>K</b>  " });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.orderId, "order_TEST000001");
  assert.equal(body.amount, 10000);
  assert.equal(body.keyId, "rzp_test_abc");
  assert.ok(!JSON.stringify(body).includes(KEY_SECRET));
  assert.equal(t.rp.calls.orders[0].amount, 10000);
  assert.ok(t.rp.calls.orders[0].receipt.length <= 40);
  const stored = t.db.donations.docs.get("order_TEST000001");
  assert.equal(stored.status, "created");
  assert.equal(stored.donorName, "Asha bK/b"); // < and > stripped, so no markup survives
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(res.headers.get("cache-control"), "no-store");
  } finally {
    t.close();
  }
});

test("create-order: rejects bad amounts", async () => {
  const t = await setup();
  try {
  for (const amount of [0, -5, 1.5, "abc", "1e3", null, 50001, [100]]) {
    const res = await t.post("/create", { amount });
    assert.equal(res.status, 400, `amount ${JSON.stringify(amount)}`);
  }
  assert.equal(t.rp.calls.orders.length, 0);
  } finally {
    t.close();
  }
});

test("create-order: unknown origin is refused, malformed JSON is 400", async () => {
  const t = await setup();
  try {
  assert.equal((await t.post("/create", { amount: 10 }, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await t.post("/create", "{not json")).status, 400);
  } finally {
    t.close();
  }
});

test("verify-payment: valid signature + matching payment marks the donation paid (idempotent)", async () => {
  const t = await setup();
  try {
  await t.post("/create", { amount: 100 });
  t.rp.payments.set("pay_TEST000001", {
    id: "pay_TEST000001", order_id: "order_TEST000001", amount: 10000,
    currency: "INR", status: "captured", method: "upi",
  });
  const payload = {
    razorpay_order_id: "order_TEST000001",
    razorpay_payment_id: "pay_TEST000001",
    razorpay_signature: sign("order_TEST000001", "pay_TEST000001"),
  };
  const first = await t.post("/verify", payload);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { verified: true, status: "paid" });
  assert.equal(t.db.donations.docs.get("order_TEST000001").status, "paid");

  const again = await t.post("/verify", payload);
  assert.equal(again.status, 200);
  assert.equal(t.rp.calls.fetches.length, 1, "second call must not hit Razorpay again");
  } finally {
    t.close();
  }
});

test("verify-payment: forged signature, unknown order and amount mismatch are rejected", async () => {
  const t = await setup();
  try {
  await t.post("/create", { amount: 100 });

  const forged = await t.post("/verify", {
    razorpay_order_id: "order_TEST000001",
    razorpay_payment_id: "pay_TEST000001",
    razorpay_signature: "0".repeat(64),
  });
  assert.equal(forged.status, 400);
  assert.equal(t.db.donations.docs.get("order_TEST000001").status, "created");

  const unknown = await t.post("/verify", {
    razorpay_order_id: "order_NOPE000001",
    razorpay_payment_id: "pay_TEST000001",
    razorpay_signature: sign("order_NOPE000001", "pay_TEST000001"),
  });
  assert.equal(unknown.status, 404);

  // validly signed, but Razorpay says the payment was for a different amount
  t.rp.payments.set("pay_TEST000002", {
    id: "pay_TEST000002", order_id: "order_TEST000001", amount: 100,
    currency: "INR", status: "captured",
  });
  const mismatch = await t.post("/verify", {
    razorpay_order_id: "order_TEST000001",
    razorpay_payment_id: "pay_TEST000002",
    razorpay_signature: sign("order_TEST000001", "pay_TEST000002"),
  });
  assert.equal(mismatch.status, 400);
  assert.equal(t.db.donations.docs.get("order_TEST000001").status, "created");

  // validly signed, but not captured/authorized
  t.rp.payments.set("pay_TEST000003", {
    id: "pay_TEST000003", order_id: "order_TEST000001", amount: 10000,
    currency: "INR", status: "failed",
  });
  const failed = await t.post("/verify", {
    razorpay_order_id: "order_TEST000001",
    razorpay_payment_id: "pay_TEST000003",
    razorpay_signature: sign("order_TEST000001", "pay_TEST000003"),
  });
  assert.equal(failed.status, 402);
  } finally {
    t.close();
  }
});

test("webhook: signed payment.captured marks paid; bad signature and foreign orders are handled", async () => {
  const t = await setup();
  try {
  await t.post("/create", { amount: 100 });
  const event = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: {
      id: "pay_TEST000009", order_id: "order_TEST000001", amount: 10000,
      currency: "INR", status: "captured", method: "card",
    } } },
  });
  const hdr = (s) => ({ "x-razorpay-signature": s, Origin: "" });

  const bad = await t.post("/hook", event, hdr("f".repeat(64)));
  assert.equal(bad.status, 400);
  assert.equal(t.db.donations.docs.get("order_TEST000001").status, "created");

  const ok = await t.post("/hook", event, hdr(hmacHex(WEBHOOK_SECRET, event)));
  assert.equal(ok.status, 200);
  assert.equal(t.db.donations.docs.get("order_TEST000001").status, "paid");
  assert.equal(t.db.donations.docs.get("order_TEST000001").paymentId, "pay_TEST000009");

  const foreign = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_X", order_id: "order_OTHER", amount: 1, currency: "INR", status: "captured" } } },
  });
  const res = await t.post("/hook", foreign, hdr(hmacHex(WEBHOOK_SECRET, foreign)));
  assert.equal(res.status, 200);
  } finally {
    t.close();
  }
});
