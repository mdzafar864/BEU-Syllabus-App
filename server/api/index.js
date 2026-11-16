"use strict";

// Vercel entry. vercel.json rewrites every /api/* request to this function.
const { loadConfig } = require("../src/config");
const { createHandler } = require("../src/app");
const { getDb } = require("../src/db");

const config = loadConfig();

module.exports = createHandler({ config, getDb: () => getDb(config) });
