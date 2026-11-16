"use strict";

// Everything the browser sends is untrusted. This module turns a raw request
// body into clean, size-limited documents (or rejects it). No dependencies.

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const NAME_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const KEY_RE = /^[A-Za-z0-9_]{1,40}$/;
const SCREEN_RE = /^\d{2,5}x\d{2,5}$/;
const LANG_RE = /^[A-Za-z0-9-]{2,20}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const EVENT_TYPES = new Set([
  "page_view",
  "session_start",
  "click",
  "change",
  "action",
]);
const DISPLAY_MODES = new Set([
  "browser",
  "standalone",
  "fullscreen",
  "minimal-ui",
]);

const MAX_EVENTS = 25;
const MAX_DATA_KEYS = 20;
const MAX_STRING = 200;
const ONE_DAY = 24 * 60 * 60 * 1000;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function cleanString(value, max = MAX_STRING) {
  return String(value).replace(CONTROL_CHARS, " ").trim().slice(0, max);
}

// Flat { key: string | number | boolean } only. Keys are restricted so a
// client can never inject Mongo operators ("$set") or dotted paths ("a.b").
function cleanData(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return out;
  }
  let count = 0;
  for (const key of Object.keys(input)) {
    if (count >= MAX_DATA_KEYS) {
      break;
    }
    if (!KEY_RE.test(key) || FORBIDDEN_KEYS.has(key)) {
      continue;
    }
    const value = input[key];
    if (typeof value === "string") {
      out[key] = cleanString(value);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else {
      continue;
    }
    count++;
  }
  return out;
}

function cleanMeta(input) {
  const meta = {};
  if (!input || typeof input !== "object") {
    return meta;
  }
  if (DISPLAY_MODES.has(input.displayMode)) {
    meta.displayMode = input.displayMode;
  }
  if (typeof input.lang === "string" && LANG_RE.test(input.lang)) {
    meta.lang = input.lang;
  }
  if (typeof input.screen === "string" && SCREEN_RE.test(input.screen)) {
    meta.screen = input.screen;
  }
  if (typeof input.path === "string") {
    meta.path = cleanString(input.path.split(/[?#]/)[0], 120);
  }
  return meta;
}

function cleanEvent(raw, now) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  if (!EVENT_TYPES.has(raw.type)) {
    return null;
  }
  if (typeof raw.name !== "string" || !NAME_RE.test(raw.name)) {
    return null;
  }
  let clientTs = null;
  if (
    typeof raw.ts === "number" &&
    Number.isFinite(raw.ts) &&
    raw.ts > now - 7 * ONE_DAY &&
    raw.ts < now + ONE_DAY
  ) {
    clientTs = new Date(raw.ts);
  }
  return {
    type: raw.type,
    name: raw.name,
    data: cleanData(raw.data),
    clientTs,
  };
}

// body: already-parsed object OR a JSON string.
function parseTrackBody(body, now = Date.now()) {
  let obj = body;
  if (typeof body === "string") {
    try {
      obj = JSON.parse(body);
    } catch {
      return { ok: false, error: "invalid_json" };
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, error: "invalid_body" };
  }
  if (typeof obj.visitorId !== "string" || !ID_RE.test(obj.visitorId)) {
    return { ok: false, error: "invalid_visitor_id" };
  }

  let rawEvents = obj.events === undefined ? [] : obj.events;
  if (!Array.isArray(rawEvents)) {
    return { ok: false, error: "invalid_events" };
  }
  rawEvents = rawEvents.slice(0, MAX_EVENTS);

  const events = [];
  for (const raw of rawEvents) {
    const evt = cleanEvent(raw, now);
    if (evt) {
      events.push(evt);
    }
  }

  return {
    ok: true,
    visitorId: obj.visitorId,
    sessionId:
      typeof obj.sessionId === "string" && ID_RE.test(obj.sessionId)
        ? obj.sessionId
        : "",
    meta: cleanMeta(obj.meta),
    events,
  };
}

module.exports = { parseTrackBody, cleanData, cleanMeta, MAX_EVENTS };
