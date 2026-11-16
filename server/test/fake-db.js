"use strict";

// Minimal in-memory stand-in for the few MongoDB calls the API makes.
// It is for tests only; it is NOT a general Mongo emulator.
function makeCollection() {
  const docs = [];
  let nextId = 1;
  return {
    docs,
    async createIndex() {
      return "ok";
    },
    async insertMany(arr) {
      for (const d of arr) {
        docs.push({ _id: nextId++, ...structuredClone(d) });
      }
      return { insertedCount: arr.length };
    },
    async updateOne(filter, update, opts = {}) {
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
      return docs.filter((d) => !gte || d.lastSeen >= gte).length;
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
  return {
    collection(name) {
      if (!cols.has(name)) {
        cols.set(name, makeCollection());
      }
      return cols.get(name);
    },
  };
}

module.exports = { createFakeDb };
