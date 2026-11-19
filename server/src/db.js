"use strict";

const { seedIfEmpty } = require("./seed");

// One shared connection per server instance (important on serverless, where
// warm invocations reuse the module and must not reconnect every request).
let clientPromise = null;
let seedPromise = null;

function connect(config) {
  if (!clientPromise) {
    // Loaded lazily so tests can run without the driver installed.
    const { MongoClient } = require("mongodb");
    const client = new MongoClient(config.mongoUri, {
      maxPoolSize: 2,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 5000,
      appName: "beu-syllabus-api",
    });
    clientPromise = client.connect().catch((err) => {
      clientPromise = null; // allow a retry on the next request
      throw err;
    });
  }
  return clientPromise;
}

// On the first call of each server instance, an empty database is set up
// automatically (collections, indexes, default documents). Concurrent first
// requests share one seeding run. Seeding problems are logged, never fatal:
// every write path in the API upserts, so it still works without the seed.
function getDb(config) {
  return connect(config).then(async (client) => {
    const db = client.db(config.dbName);
    if (config.autoSeed) {
      if (!seedPromise) {
        seedPromise = seedIfEmpty(db, config)
          .then((result) => {
            if (result.createdCollections.length || result.seededDocuments.length) {
              console.log(
                `[seed] ${result.empty ? "empty database" : "partial database"} set up: ` +
                  `collections=[${result.createdCollections.join(", ")}] ` +
                  `documents=[${result.seededDocuments.join(", ")}]`,
              );
            }
          })
          .catch((err) => {
            console.error("[seed] skipped, could not set up database:", err.message);
          });
      }
      await seedPromise;
    }
    return db;
  });
}

async function closeDb() {
  if (clientPromise) {
    const client = await clientPromise;
    clientPromise = null;
    seedPromise = null;
    await client.close();
  }
}

module.exports = { getDb, closeDb };
