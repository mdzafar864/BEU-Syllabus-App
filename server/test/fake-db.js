"use strict";

// Minimal in-memory stand-in for the few MongoDB calls the API makes.
// It is for tests only; it is NOT a general Mongo emulator.
function makeCollection(onCreate) {
  const docs = [];
  let nextId = 1;
  return {
    docs,
    async createIndex() {
      onCreate();
      return "ok";
    },
    async insertMany(arr) {
      onCreate();
      for (const d of arr) {
        docs.push({ _id: nextId++, ...structuredClone(d) });
      }
      return { insertedCount: arr.length };
    },
    async updateOne(filter, update, opts = {}) {
      if (opts.upsert) {
        onCreate();
      }
      let doc = docs.find((d) => d._id === filter._id);
      let upserted = 0;
      if (!doc) {
        if (!opts.upsert) {
          return { matchedCount: 0, upsertedCount: 0 };
        }
        doc = { _id: filter._id, ...structuredClone(update.$setOnInsert || {}) };
        docs.push(doc);
        upserted = 1;
      }
      Object.assign(doc, structuredClone(update.$set || {}));
      for (const [k, v] of Object.entries(update.$inc || {})) {
        doc[k] = (doc[k] || 0) + v;
      }
      return { matchedCount: 1 - upserted, upsertedCount: upserted };
    },
    async countDocuments(filter = {}) {
      const gte = filter.lastSeen && filter.lastSeen.$gte;
      const notEqual = filter.online && "$ne" in filter.online;
      return docs.filter(
        (d) =>
          (!gte || d.lastSeen >= gte) &&
          (!notEqual || d.online !== filter.online.$ne),
      ).length;
    },
    async estimatedDocumentCount() {
      return docs.length;
    },
    async findOne(filter) {
      return docs.find((d) => d._id === filter._id) || null;
    },
  };
}

function createFakeDb() {
  const cols = new Map();
  const existing = new Set();
  const get = (name) => {
    if (!cols.has(name)) {
      cols.set(name, makeCollection(() => existing.add(name)));
    }
    return cols.get(name);
  };
  return {
    collection: get,
    listCollections() {
      return { toArray: async () => [...existing].map((name) => ({ name })) };
    },
    async createCollection(name) {
      if (existing.has(name)) {
        throw Object.assign(new Error("Collection already exists"), { code: 48 });
      }
      existing.add(name);
      get(name);
    },
    // test helper
    _existing: existing,
  };
}

module.exports = { createFakeDb };
