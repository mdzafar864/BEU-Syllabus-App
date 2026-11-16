"use strict";

// Long-running server entry (local development, Render, Railway, Fly, a VPS).
// For Vercel see api/index.js.
const http = require("node:http");
const { loadConfig } = require("./src/config");
const { createHandler } = require("./src/app");
const { getDb } = require("./src/db");

const config = loadConfig();

if (!config.mongoUri) {
  console.error("MONGODB_URI is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const handler = createHandler({ config, getDb: () => getDb(config) });

http.createServer(handler).listen(config.port, () => {
  console.log(`BEU API listening on http://localhost:${config.port}`);
  // Connect eagerly so a wrong URI / blocked IP shows up at start-up.
  getDb(config)
    .then(() => console.log(`MongoDB connected (db: ${config.dbName})`))
    .catch((err) => console.error("MongoDB connection failed:", err.message));
});
