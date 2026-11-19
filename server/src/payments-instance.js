"use strict";

// Shared payment handlers for the Vercel function files in api/ (built once per
// warm instance so the MongoDB connection and the Razorpay client are reused).
const { loadConfig } = require("./config");
const { createPaymentsHandlers } = require("./payments");
const { getDb } = require("./db");

const config = loadConfig();

module.exports = createPaymentsHandlers({ config, getDb: () => getDb(config) });
