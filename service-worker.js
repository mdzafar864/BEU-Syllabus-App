const CACHE_NAME = "beu-pwa-v1.0.14";

// 🔥 AUTO detect base path
const BASE = self.location.hostname.includes("github.io")
  ? "/BEU-Syllabus-App"
  : "";

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

// Store a fresh syllabus response in cache. Returns true if its content
// differs from what was cached before (i.e. there is NEW syllabus content).
async function storeSyllabus(request, response, previous) {
  const cache = await caches.open(CACHE_NAME);
  let changed = false;

  if (previous) {
    try {
      const [oldText, newText] = await Promise.all([
        previous.clone().text(),
        response.clone().text()
      ]);
      changed = oldText !== newText;
    } catch (e) {
      changed = false;
    }
  }

  await cache.put(request, response.clone());
  return changed;
}

// Used by Background Sync (and the manual fallback message):
// fetch newest syllabus from server -> update cache -> tell the page.
async function refreshSyllabus() {
  const cache = await caches.open(CACHE_NAME);
  const previous = await cache.match(SYLLABUS_URL);

  // Throwing here makes the browser retry the sync later.
  const response = await fetch(SYLLABUS_URL, { cache: "no-store" });
  if (!response || response.status !== 200) {
    throw new Error("Syllabus fetch failed: " + (response && response.status));
  }

  const changed = await storeSyllabus(SYLLABUS_URL, response, previous);
  if (changed) await notifyClients("SYLLABUS_UPDATED");
}

// Network First for syllabus data with instant cache fallback
function syllabusNetworkFirst(event) {
  const req = event.request;

  const respond = (async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });

    const networkPromise = fetch(req).then(async res => {
      if (res && res.status === 200) {
        const changed = await storeSyllabus(req, res, cached);
        return { res, changed };
      }
      return { res, changed: false };
    });

    // Offline -> fetch rejects immediately -> cache is served instantly.
    if (!cached) {
      return (await networkPromise).res;
    }

    const TIMEOUT = Symbol("timeout");
    const winner = await Promise.race([
      networkPromise.catch(() => null),
      new Promise(resolve => setTimeout(() => resolve(TIMEOUT), NETWORK_TIMEOUT_MS))
    ]);

    // Network answered in time with a valid response -> fresh data, no prompt needed.
    if (winner && winner !== TIMEOUT && winner.res) {
      if (winner.res.status === 200) return winner.res;
      return cached;
    }

    // Offline (null) or slow (TIMEOUT): serve cache now.
    if (winner === TIMEOUT) {
      // Page is showing cached data; if the network later returns newer
      // content, tell the page.
      event.waitUntil(
        networkPromise
          .then(r => r.changed && notifyClients("SYLLABUS_UPDATED"))
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
