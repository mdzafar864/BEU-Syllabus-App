"use strict";

// Creates what the API needs in an empty database: collections, indexes and
// the default documents. It is idempotent and never overwrites existing data,
// so it is safe to run on every start-up, from several serverless instances at
// once, and against a database that is only partly set up.

const COLLECTIONS = ["events", "visitors", "counters", "meta"];
const SCHEMA_VERSION = 1;
const NAMESPACE_EXISTS = 48; // MongoDB error code: collection already exists

async function ensureIndexes(db, config) {
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
}

// Returns { empty, createdCollections, seededDocuments }.
async function seedIfEmpty(db, config, now = () => new Date()) {
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map(
      (c) => c.name,
    ),
  );
  const empty = COLLECTIONS.every((name) => !existing.has(name));

  const createdCollections = [];
  for (const name of COLLECTIONS) {
    if (existing.has(name)) {
      continue;
    }
    try {
      await db.createCollection(name);
      createdCollections.push(name);
    } catch (err) {
      // another instance created it between our check and now: fine
      if (err && err.code !== NAMESPACE_EXISTS) {
        throw err;
      }
    }
  }

  await ensureIndexes(db, config);

  // $setOnInsert: only fills in what is missing, never touches real numbers.
  const seededDocuments = [];
  const at = now();
  const counter = await db
    .collection("counters")
    .updateOne(
      { _id: "downloads" },
      { $setOnInsert: { value: 0, createdAt: at } },
      { upsert: true },
    );
  if (counter.upsertedCount) {
    seededDocuments.push("counters/downloads");
  }
  const schema = await db
    .collection("meta")
    .updateOne(
      { _id: "schema" },
      { $setOnInsert: { version: SCHEMA_VERSION, seededAt: at } },
      { upsert: true },
    );
  if (schema.upsertedCount) {
    seededDocuments.push("meta/schema");
  }

  return { empty, createdCollections, seededDocuments };
}

module.exports = { seedIfEmpty, ensureIndexes, COLLECTIONS, SCHEMA_VERSION };
