const CACHE_NAME = "beu-pwa-v1.0.16";

// Base path = wherever this service worker is actually served from
// (works on github.io/<repo>, a custom domain, localhost, any sub-folder).
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");

// Syllabus data (all PDF links live in this file)
const SYLLABUS_URL = `${BASE}/js/data.js`;
const SYNC_TAG = "sync-syllabus";

// If the network hasn't answered within this time, serve the cached syllabus
// immediately and keep fetching in the background (flaky / "lie-fi" networks).
// When fully offline, fetch() rejects instantly, so fallback is instant anyway.
const NETWORK_TIMEOUT_MS = 3000;

// App shell
const ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/manifest.json`,
  `${BASE}/css/style.css`,
  `${BASE}/js/app.js`,
  `${BASE}/js/data.js`,
  `${BASE}/assets/icon-192.png`,
  `${BASE}/assets/icon-512.png`,
  `${BASE}/assets/icon-maskable-192.png`,
  `${BASE}/assets/icon-maskable-512.png`,
  `${BASE}/assets/apple-touch-icon.png`,
  `${BASE}/assets/favicon.ico`,
  `${BASE}/assets/favicon.svg`,
  `${BASE}/assets/favicon-96x96.png`,
  `${BASE}/assets/logo.png`
];

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------
async function notifyClients(type) {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true
  });
  clients.forEach(client => client.postMessage({ type }));
}

function isSyllabusRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && url.pathname === SYLLABUS_URL;
}

// Compare content, not bytes: ignore line-ending / trailing-space noise.
function normalize(text) {
  return text.replace(/\r\n/g, "\n").trim();
}

// Small stable hash (FNV-1a) used to identify one version of data.js.
function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// Hash of the syllabus last handed to a page in this worker's lifetime.
// A page that already received the newest data never needs a popup.
let lastServedHash = null;

// ONE canonical cache entry for the syllabus (no query string, always the same
// key). Before, the page path and the sync path stored/looked up different
// keys, so they kept comparing against each other's stale copy.
async function readCachedSyllabus() {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(SYLLABUS_URL, { ignoreSearch: true });
  return cached ? normalize(await cached.clone().text()) : null;
}

// Always ask the SERVER (bypass the browser HTTP cache, e.g. GitHub Pages'
// max-age=600). Otherwise the worker can re-store a stale copy and later see
// the fresh one as "new" again and again.
async function fetchFreshSyllabus() {
  const response = await fetch(SYLLABUS_URL, { cache: "no-store" });
  if (!response || response.status !== 200) {
    throw new Error("Syllabus fetch failed: " + (response && response.status));
  }
  return response;
}

// Fetch + store, shared by every caller so overlapping requests (page load +
// background sync) never race each other.
let inflight = null;
function updateSyllabusCache() {
  if (!inflight) {
    inflight = (async () => {
      const previousText = await readCachedSyllabus();
      const response = await fetchFreshSyllabus();
      const text = normalize(await response.clone().text());
      const cache = await caches.open(CACHE_NAME);
      await cache.put(SYLLABUS_URL, response.clone());
      return {
        response,
        hash: hashText(text),
        // First-ever download (no previous copy) is never "an update".
        changed: previousText !== null && previousText !== text
      };
    })().finally(() => { inflight = null; });
  }
  return inflight;
}

async function notifySyllabusUpdated(hash) {
  if (hash === lastServedHash) return; // page already runs this version
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach(client => client.postMessage({ type: "SYLLABUS_UPDATED", hash }));
}

// Used by Background Sync (and the manual fallback message).
// Throwing makes the browser retry the sync later.
async function refreshSyllabus() {
  const { changed, hash } = await updateSyllabusCache();
  if (changed) await notifySyllabusUpdated(hash);
}

// Network First for syllabus data with instant cache fallback
function syllabusNetworkFirst(event) {
  const respond = (async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(SYLLABUS_URL, { ignoreSearch: true });

    const networkPromise = updateSyllabusCache();

    // Nothing cached yet: must wait for the network.
    if (!cached) {
      const { response, hash } = await networkPromise;
      lastServedHash = hash;
      return response;
    }

    const TIMEOUT = Symbol("timeout");
    const winner = await Promise.race([
      networkPromise.catch(() => null),
      new Promise(resolve => setTimeout(() => resolve(TIMEOUT), NETWORK_TIMEOUT_MS))
    ]);

    // Network answered in time -> the page gets the fresh data, no prompt needed.
    if (winner && winner !== TIMEOUT) {
      lastServedHash = winner.hash;
      return winner.response;
    }

    // Offline (null) or slow (TIMEOUT): serve cache now.
    lastServedHash = hashText(normalize(await cached.clone().text()));
    if (winner === TIMEOUT) {
      // Page is showing cached data; if the network later returns newer
      // content, tell the page.
      event.waitUntil(
        networkPromise
          .then(r => r.changed && notifySyllabusUpdated(r.hash))
          .catch(() => {})
      );
    }
    return cached;
  })();

  event.respondWith(respond);
}

// ---------------------------------------------------------
// INSTALL
// ---------------------------------------------------------
self.addEventListener("install", event => {
  // First-ever install has no active worker yet -> nothing to "update" from,
  // so never announce NEW_VERSION in that case (prevents a false popup when the
  // user acts quickly on their very first visit).
  const isUpdate = !!self.registration.active;

  // NOTE: no skipWaiting() here. The new worker waits until the user confirms
  // the "New version available" dialog (then the page sends SKIP_WAITING).
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => isUpdate && notifyClients("NEW_VERSION"))
  );
});

// ---------------------------------------------------------
// ACTIVATE
// ---------------------------------------------------------
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(keys.map(key => key !== CACHE_NAME && caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------
// FETCH - Network First (syllabus data gets timeout + change detection)
// ---------------------------------------------------------
self.addEventListener("fetch", event => {
  const req = event.request;
  if (!req.url.startsWith("http") || req.method !== "GET") return;

  // Cross-origin requests (Google Analytics, Drive previews...) go straight to network
  if (new URL(req.url).origin !== self.location.origin) return;

  if (isSyllabusRequest(req)) {
    syllabusNetworkFirst(event);
    return;
  }

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.status === 200 || res.status === 0) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then(cacheRes => {
          if (cacheRes) return cacheRes;

          const accept = req.headers.get("accept");
          if (accept && accept.includes("text/html")) {
            return caches.match(`${BASE}/index.html`);
          }
          return Response.error();
        })
      )
  );
});

// ---------------------------------------------------------
// BACKGROUND SYNC - runs as soon as connectivity is restored
// ---------------------------------------------------------
self.addEventListener("sync", event => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(refreshSyllabus());
  }
});

// ---------------------------------------------------------
// MESSAGES from the page
// ---------------------------------------------------------
self.addEventListener("message", event => {
  const data = event.data;
  const type = data && data.type ? data.type : data;

  if (type === "skipWaiting" || type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  // Fallback for browsers without Background Sync (Safari / Firefox)
  if (type === "SYNC_SYLLABUS") {
    event.waitUntil(refreshSyllabus().catch(() => {}));
  }
});
