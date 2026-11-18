"use strict";

// One shared handler for every Vercel function file in api/ (built once per
// warm instance so the database connection and caches are reused).
const { loadConfig } = require("./config");
const { createHandler } = require("./app");
const { getDb } = require("./db");

const config = loadConfig();

module.exports = createHandler({ config, getDb: () => getDb(config) });
