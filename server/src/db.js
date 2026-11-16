"use strict";

// One shared connection per server instance (important on serverless, where
// warm invocations reuse the module and must not reconnect every request).
let clientPromise = null;

function getDb(config) {
  if (!clientPromise) {
    // Loaded lazily so tests can run without the driver installed.
    const { MongoClient } = require("mongodb");
    const client = new MongoClient(config.mongoUri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      appName: "beu-syllabus-api",
    });
    clientPromise = client.connect().catch((err) => {
      clientPromise = null; // allow a retry on the next request
      throw err;
    });
  }
  return clientPromise.then((client) => client.db(config.dbName));
}

module.exports = { getDb };
