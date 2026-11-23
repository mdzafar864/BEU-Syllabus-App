// user-id.js
//
// Gives every browser a persistent, anonymous "userId" and registers it with
// the BEU API so a new user is recorded in MongoDB.
//
// Flow on every page load:
//   1. "userId" already in localStorage and confirmed by the server -> do nothing.
//   2. "userId" missing or malformed -> generate a UUID, save it, send it to
//      POST /api/users.
//   3. "userId" saved but never confirmed (e.g. the user was offline) -> retry
//      the send.
//
// This file is standalone: it does not touch any other script.

(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const USER_ID_KEY = "userId";
  // "1" once the server confirmed the id, "0" while the send is still pending.
  const SYNCED_KEY = "userIdSynced";
  const SYNCED = "1";
  const NOT_SYNCED = "0";

  // Same shape the server accepts (see parseUserBody in server/src/validate.js).
  const USER_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

  const API_BASE = resolveApiBase(window.BEU_CONFIG);

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  // Reads `apiBase` from js/config.js and normalises it. Returns "" when no API
  // is configured, in which case the id is still created but never sent.
  function resolveApiBase(config) {
    const base = String((config && config.apiBase) || "")
      .trim()
      .replace(/\/+$/, "");

    // "my-api.vercel.app" without a scheme would be treated as a path on this
    // site, so default to https.
    if (base && !/^https?:\/\//i.test(base)) {
      return `https://${base}`;
    }
    return base;
  }

  // ---------------------------------------------------------------------------
  // localStorage access
  // ---------------------------------------------------------------------------
  // localStorage can throw (private mode, blocked cookies, quota exceeded), so
  // every access is wrapped: a storage failure must never break the page.

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage unavailable: nothing more we can do.
    }
  }

  // ---------------------------------------------------------------------------
  // UUID generation
  // ---------------------------------------------------------------------------

  // Returns a random RFC 4122 version-4 UUID.
  function generateUuid() {
    const cryptoApi = window.crypto;

    // Preferred path: built into all modern browsers (secure contexts only).
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
      return cryptoApi.randomUUID();
    }

    // Fallback: build a v4 UUID from 16 random bytes.
    const bytes = new Uint8Array(16);
    if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
      cryptoApi.getRandomValues(bytes);
    } else {
      // Last resort for very old browsers (not cryptographically strong).
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }

    // Stamp the version (4) and variant (10xx) bits required by the UUID spec.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10).join(""),
    ].join("-");
  }

  // ---------------------------------------------------------------------------
  // Server sync
  // ---------------------------------------------------------------------------

  // Sends the id to the API. Marks it as synced only when the server answers
  // with a 2xx status; any failure is silent and retried on the next page load.
  async function sendUserToServer(userId) {
    if (!API_BASE) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/users`, {
        method: "POST",
        // text/plain keeps this a "simple" CORS request, so the browser skips
        // the preflight round trip (same approach as tracker.js).
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({ userId }),
        // Lets the request finish even if the page is closed right away.
        keepalive: true,
        credentials: "omit",
      });

      if (response.ok) {
        writeStorage(SYNCED_KEY, SYNCED);
      }
    } catch {
      // Offline or blocked: the id stays "not synced" and is retried later.
    }
  }

  // ---------------------------------------------------------------------------
  // Entry point
  // ---------------------------------------------------------------------------

  function ensureUserId() {
    const storedId = readStorage(USER_ID_KEY);

    if (!USER_ID_PATTERN.test(storedId || "")) {
      // First visit (or a corrupted value): create, save, then register it.
      const newId = generateUuid();
      writeStorage(USER_ID_KEY, newId);
      writeStorage(SYNCED_KEY, NOT_SYNCED);
      sendUserToServer(newId);
      return;
    }

    if (readStorage(SYNCED_KEY) === NOT_SYNCED) {
      // The id exists but the server never confirmed it: try again.
      sendUserToServer(storedId);
    }
  }

  ensureUserId();
})();
