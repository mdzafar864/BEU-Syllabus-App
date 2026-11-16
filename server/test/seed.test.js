"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const { seedIfEmpty, COLLECTIONS } = require("../src/seed");
const { loadConfig } = require("../src/config");
const { createFakeDb } = require("./fake-db");

const config = loadConfig({ NODE_ENV: "production" });

test("empty database: creates every collection and the default documents", async () => {
  const db = createFakeDb();
  const r = await seedIfEmpty(db, config);

  assert.equal(r.empty, true);
  assert.deepEqual([...r.createdCollections].sort(), [...COLLECTIONS].sort());
  assert.deepEqual([...db._existing].sort(), [...COLLECTIONS].sort());
  assert.deepEqual(r.seededDocuments.sort(), ["counters/downloads", "meta/schema"]);

  const dl = db.collection("counters").docs.find((d) => d._id === "downloads");
  assert.equal(dl.value, 0);
  const meta = db.collection("meta").docs.find((d) => d._id === "schema");
  assert.equal(meta.version, 1);
});

test("running it again changes nothing and never overwrites real numbers", async () => {
  const db = createFakeDb();
  await seedIfEmpty(db, config);
  db.collection("counters").docs[0].value = 4242; // real downloads accumulated

  const r = await seedIfEmpty(db, config);
  assert.equal(r.empty, false);
  assert.deepEqual(r.createdCollections, []);
  assert.deepEqual(r.seededDocuments, []);
  assert.equal(db.collection("counters").docs[0].value, 4242);
  assert.equal(db.collection("counters").docs.length, 1);
});

test("partly set-up database: fills only the gaps, keeps existing data", async () => {
  const db = createFakeDb();
  await db.createCollection("events");
  await db.collection("events").insertMany([{ type: "click" }]);
  await db.collection("counters").updateOne({ _id: "downloads" }, { $set: { value: 7 } }, { upsert: true });

  const r = await seedIfEmpty(db, config);
  assert.equal(r.empty, false);
  assert.deepEqual(r.createdCollections.sort(), ["meta", "visitors"]);
  assert.deepEqual(r.seededDocuments, ["meta/schema"]);
  assert.equal(db.collection("events").docs.length, 1);
  assert.equal(db.collection("counters").docs[0].value, 7);
});

test("two instances starting at once do not clash", async () => {
  const db = createFakeDb();
  const results = await Promise.all([seedIfEmpty(db, config), seedIfEmpty(db, config), seedIfEmpty(db, config)]);
  assert.equal(results.length, 3);
  assert.equal(db.collection("counters").docs.length, 1);
  assert.equal(db.collection("meta").docs.length, 1);
});

test("a real error (not 'already exists') is surfaced", async () => {
  const db = createFakeDb();
  db.createCollection = async () => {
    throw Object.assign(new Error("not authorized"), { code: 13 });
  };
  await assert.rejects(() => seedIfEmpty(db, config), /not authorized/);
});

// ---------------------------------------------------------------------------
// db.js wiring: stub the 'mongodb' driver (not installed here) to prove the
// seed runs once per instance, can be switched off, and is never fatal.
// ---------------------------------------------------------------------------
function loadDbWith(fakeDb) {
  const origResolve = Module._resolveFilename;
  const origLoad = Module._load;
  let connects = 0;
  Module._resolveFilename = function (request, ...rest) {
    return request === "mongodb" ? "mongodb" : origResolve.call(this, request, ...rest);
  };
  Module._load = function (request, ...rest) {
    if (request === "mongodb") {
      return {
        MongoClient: class {
          async connect() {
            connects++;
            return this;
          }
          db() {
            return fakeDb;
          }
          async close() {}
        },
      };
    }
    return origLoad.call(this, request, ...rest);
  };
  delete require.cache[require.resolve("../src/db")];
  const mod = require("../src/db");
  return { mod, connects: () => connects, restore: () => { Module._resolveFilename = origResolve; Module._load = origLoad; } };
}

test("getDb seeds an empty database on first use, once per instance", async () => {
  const fake = createFakeDb();
  const { mod, connects, restore } = loadDbWith(fake);
  try {
    const cfg = loadConfig({ MONGODB_URI: "mongodb://x", NODE_ENV: "production" });
    const [a, b] = await Promise.all([mod.getDb(cfg), mod.getDb(cfg)]);
    assert.equal(a, fake);
    assert.equal(b, fake);
    assert.equal(connects(), 1, "one shared connection");
    assert.deepEqual([...fake._existing].sort(), [...COLLECTIONS].sort());

    fake.collection("counters").docs[0].value = 9;
    await mod.getDb(cfg); // later calls do not re-seed
    assert.equal(fake.collection("counters").docs[0].value, 9);
  } finally {
    restore();
  }
});

test("AUTO_SEED=false leaves the database alone", async () => {
  const fake = createFakeDb();
  const { mod, restore } = loadDbWith(fake);
  try {
    const cfg = loadConfig({ MONGODB_URI: "mongodb://x", AUTO_SEED: "false" });
    await mod.getDb(cfg);
    assert.equal(fake._existing.size, 0);
  } finally {
    restore();
  }
});

test("a seeding failure is logged but getDb still returns the database", async () => {
  const fake = createFakeDb();
  fake.listCollections = () => ({ toArray: async () => { throw new Error("no permission"); } });
  const { mod, restore } = loadDbWith(fake);
  const origErr = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(" "));
  try {
    const cfg = loadConfig({ MONGODB_URI: "mongodb://x" });
    assert.equal(await mod.getDb(cfg), fake);
    assert.ok(logged.some((l) => l.includes("[seed] skipped")));
  } finally {
    console.error = origErr;
    restore();
  }
});
