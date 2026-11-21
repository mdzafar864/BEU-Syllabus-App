"use strict";

// Manual seeding: `npm run seed`
// Safe to run any time (idempotent); it only adds what is missing.
const { loadConfig } = require("../src/config");
const { getDb, closeDb } = require("../src/db");
const { seedIfEmpty } = require("../src/seed");

(async () => {
  const config = loadConfig();
  if (!config.mongoUri) {
    console.error("MONGODB_URI is not set. Copy .env.example to .env first.");
    process.exit(1);
  }
  // autoSeed off here: this script runs the seed itself so it can report.
  const db = await getDb({ ...config, autoSeed: false });
  const result = await seedIfEmpty(db, config);

  console.log(
    `Database "${config.dbName}": ${result.empty ? "was empty" : "already had data"}`,
  );
  console.log(
    "  collections created:",
    result.createdCollections.join(", ") || "none (all existed)",
  );
  console.log(
    "  default documents  :",
    result.seededDocuments.join(", ") || "none (all existed)",
  );
  await closeDb();
})().catch((err) => {
  console.error("Seeding failed:", err.message);
  process.exit(1);
});
