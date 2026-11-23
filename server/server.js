"use strict";

// Long-running server entry (local development, Render, Railway, Fly, a VPS).
// For Vercel see api/index.js.
const http = require("node:http");
const { loadConfig } = require("./src/config");
const { createHandler } = require("./src/app");
const { getDb } = require("./src/db");
const { createPaymentsHandlers } = require("./src/payments");

const config = loadConfig();

if (!config.mongoUri) {
  console.error("MONGODB_URI is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const handler = createHandler({ config, getDb: () => getDb(config) });
const payments = createPaymentsHandlers({ config, getDb: () => getDb(config) });

// Payment routes first; everything else goes to the analytics handler.
const PAYMENT_ROUTES = {
  "/api/create-order": payments.createOrder,
  "/api/verify-payment": payments.verifyPayment,
  "/api/razorpay-webhook": payments.webhook,
};

function dispatch(req, res) {
  const path = new URL(req.url, "http://localhost").pathname.replace(
    /\/+$/,
    "",
  );
  const route = PAYMENT_ROUTES[path];
  return route ? route(req, res) : handler(req, res);
}

http.createServer(dispatch).listen(config.port, () => {
  console.log(`BEU API listening on http://localhost:${config.port}`);
  // Connect eagerly so a wrong URI / blocked IP shows up at start-up.
  getDb(config)
    .then(() => console.log(`MongoDB connected (db: ${config.dbName})`))
    .catch((err) => console.error("MongoDB connection failed:", err.message));
});
