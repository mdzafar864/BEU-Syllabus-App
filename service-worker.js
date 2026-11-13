const CACHE_NAME = "beu-pwa-v1.0.2";

// 🔥 AUTO detect base path
const BASE = self.location.hostname.includes("github.io")
  ? "/BEU-Syllabus-App"
  : "";

// Syllabus data (all PDF links live in this file)
const SYLLABUS_URL = `${BASE}/js/data.js`;
const SYNC_TAG = "sync-syllabus";

// Release marker, checked independently of the service worker file itself.
// Bump "version" in version.json on every release; open apps are then told to
// reload without touching the syllabus data or its background sync.
const VERSION_URL = `${BASE}/version.json`;

// App shell
const ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/manifest.json`,
  `${BASE}/css/style.css`,
  `${BASE}/js/app.js`,
  `${BASE}/js/data.js`,
  `${BASE}/js/analytics.js`,
  `${BASE}/assets/icon-192.png`,
  `${BASE}/assets/icon-512.png`,
  `${BASE}/assets/icon-maskable-192.png`,
  `${BASE}/assets/icon-maskable-512.png`,
  `${BASE}/assets/apple-touch-icon.png`,
  `${BASE}/assets/favicon.ico`,
  `${BASE}/assets/favicon.svg`,
  `${BASE}/assets/favicon-96x96.png`,
  `${BASE}/assets/logo.png`,
];

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------
async function notifyClients(type, extra = {}) {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  clients.forEach((client) => client.postMessage({ type, ...extra }));
}

function isSyllabusRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && url.pathname === SYLLABUS_URL;
}

function isVersionRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && url.pathname === VERSION_URL;
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
        response.clone().text(),
      ]);
      changed = oldText !== newText;
    } catch {
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
  if (changed) {
    await notifyClients("SYLLABUS_UPDATED");
  }
}

// Strategy 1 - cache bypass: data.js and version.json always come straight
// from the network (no Cache Storage, no HTTP cache). The cached copy is used
// only when the network is unreachable or errors, so the app still works
// offline. Only data.js refreshes the cached copy; the version baseline is
// owned by checkVersion().
function networkOnly(event, { store }) {
  const req = event.request;

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req.url, { cache: "no-store" });
        if (res.status === 200) {
          if (store) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(req, res.clone());
          }
          return res;
        }
        // Server error: prefer the last good copy, otherwise pass it on.
        return (await caches.match(req, { ignoreSearch: true })) || res;
      } catch {
        return (
          (await caches.match(req, { ignoreSearch: true })) || Response.error()
        );
      }
    })(),
  );
}

// Strategy 2 - version check: compare version.json on the server with the
// copy stored at install time. A difference means a new release is live.
async function readVersion(response) {
  try {
    const data = await response.json();
    return data && typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

async function fetchVersionFile() {
  const response = await fetch(VERSION_URL, { cache: "no-store" });
  return response.ok ? response : null;
}

// Record the version this cache was built with (no notification).
async function seedVersion() {
  try {
    const response = await fetchVersionFile();
    if (response) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(VERSION_URL, response);
    }
  } catch {
    // version.json missing/offline: checks simply stay quiet until it exists
  }
}

async function checkVersion() {
  const response = await fetchVersionFile();
  if (!response) {
    return;
  }

  const latest = await readVersion(response.clone());
  if (!latest) {
    return;
  }

  const cache = await caches.open(CACHE_NAME);
  const stored = await cache.match(VERSION_URL);
  const current = stored ? await readVersion(stored) : null;

  // Remember the new version first so each release is announced only once.
  await cache.put(VERSION_URL, response);

  if (current && current !== latest) {
    await notifyClients("VERSION_UPDATED", { version: latest });
  }
}

// ---------------------------------------------------------
// INSTALL
// ---------------------------------------------------------
self.addEventListener("install", (event) => {
  // First-ever install has no active worker yet -> nothing to "update" from,
  // so never announce NEW_VERSION in that case (prevents a false popup when the
  // user acts quickly on their very first visit).
  const isUpdate = !!self.registration.active;

  // NOTE: no skipWaiting() here. The new worker waits until the user confirms
  // the "New version available" dialog (then the page sends SKIP_WAITING).
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(seedVersion)
      .then(() => isUpdate && notifyClients("NEW_VERSION")),
  );
});

// ---------------------------------------------------------
// ACTIVATE
// ---------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => key !== CACHE_NAME && caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ---------------------------------------------------------
// FETCH - data.js / version.json bypass the cache; everything else Network First
// ---------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!req.url.startsWith("http") || req.method !== "GET") {
    return;
  }

  // Cross-origin requests (Google Analytics, Drive previews...) go straight to network
  if (new URL(req.url).origin !== self.location.origin) {
    return;
  }

  if (isSyllabusRequest(req)) {
    networkOnly(event, { store: true });
    return;
  }

  if (isVersionRequest(req)) {
    networkOnly(event, { store: false });
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.status === 200 || res.status === 0) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cacheRes) => {
          if (cacheRes) {
            return cacheRes;
          }

          const accept = req.headers.get("accept");
          if (accept && accept.includes("text/html")) {
            return caches.match(`${BASE}/index.html`);
          }
          return Response.error();
        }),
      ),
  );
});

// ---------------------------------------------------------
// BACKGROUND SYNC - runs as soon as connectivity is restored
// ---------------------------------------------------------
self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(refreshSyllabus());
  }
});

// ---------------------------------------------------------
// MESSAGES from the page
// ---------------------------------------------------------
self.addEventListener("message", (event) => {
  const data = event.data;
  const type = data && data.type ? data.type : data;

  if (type === "skipWaiting" || type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  // Version check requested by the page (load, back online, tab focused).
  // Independent of syllabus sync, so the two never interfere.
  if (type === "CHECK_VERSION") {
    event.waitUntil(checkVersion().catch(() => {}));
  }

  // Fallback for browsers without Background Sync (Safari / Firefox)
  if (type === "SYNC_SYLLABUS") {
    event.waitUntil(refreshSyllabus().catch(() => {}));
  }
});
