/* BEU Syllabus App - service worker
 *
 * Layout of this file
 *   1. Config & cache names
 *   2. Shared helpers
 *   3. App shell caching        (versioned cache, replaced on every build)
 *   4. Syllabus data module     (data.js: network-first, refresh, "SYLLABUS_UPDATED")
 *   5. Version module           (version.json check, "VERSION_UPDATED")
 *   6. Lifecycle / fetch / sync / message wiring
 *
 * The data module and the version module share NO state, NO cache and NO
 * message type. Each decides on its own when it has news and posts its own
 * message; the page decides how to present them (see js/app.js).
 */

// Stamped on every build by `node scripts/build-sw.js` - do not edit by hand.
// The marker comment lets the script find and replace this line each time.
const BUILD_ID = "mwewtlgx-8da5e085"; // @build-id

// ---------------------------------------------------------
// 1. CONFIG & CACHE NAMES
// ---------------------------------------------------------

// Auto-detect base path (GitHub Pages project site vs. local / custom domain)
const BASE = self.location.hostname.includes("github.io")
  ? "/BEU-Syllabus-App"
  : "";

// Unique per build -> a new build never reads or reuses an old build's shell.
const SHELL_PREFIX = "beu-shell-";
const SHELL_CACHE = `${SHELL_PREFIX}${BUILD_ID}`;

// Survives builds on purpose: it holds the last syllabus the user was served,
// which is the baseline for detecting "new syllabus added".
const DATA_CACHE = "beu-data";

const SYLLABUS_URL = `${BASE}/js/data.js`;
const VERSION_URL = `${BASE}/version.json`;
const SYNC_TAG = "sync-syllabus";

// App shell. data.js is deliberately NOT here: it lives in DATA_CACHE.
const SHELL_ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/manifest.json`,
  `${BASE}/css/style.css`,
  `${BASE}/js/app.js`,
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
// 2. SHARED HELPERS
// ---------------------------------------------------------
async function notifyClients(type, extra = {}) {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  clients.forEach((client) => client.postMessage({ type, ...extra }));
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

// ---------------------------------------------------------
// 3. APP SHELL (everything except data.js / version.json)
// ---------------------------------------------------------
async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(SHELL_ASSETS);
}

// Delete shell caches from other builds. Returns how many were removed, which
// is also how we know this activation is an UPDATE and not a first install.
async function removeOldShells() {
  const keys = await caches.keys();
  const stale = keys.filter(
    (key) => key.startsWith(SHELL_PREFIX) && key !== SHELL_CACHE,
  );
  await Promise.all(stale.map((key) => caches.delete(key)));
  return stale.length;
}

// Network first, cached copy only when the network fails.
async function shellNetworkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.status === 200 || res.status === 0) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(request, { cacheName: SHELL_CACHE });
    if (cached) {
      return cached;
    }

    const accept = request.headers.get("accept");
    if (accept && accept.includes("text/html")) {
      const fallback = await caches.match(`${BASE}/index.html`, {
        cacheName: SHELL_CACHE,
      });
      if (fallback) {
        return fallback;
      }
    }
    return Response.error();
  }
}

// ---------------------------------------------------------
// 4. SYLLABUS DATA MODULE  ->  posts "SYLLABUS_UPDATED"
// ---------------------------------------------------------
const SyllabusData = {
  // Cache key is the fixed data URL so "?v=123" style requests share one entry.
  key: SYLLABUS_URL,

  async cached() {
    const cache = await caches.open(DATA_CACHE);
    return cache.match(this.key);
  },

  // Network first. The HTTP cache is bypassed too ("no-store"), so there is
  // never a delay before new syllabus links show up. The cached copy is used
  // only when the network is down or the server errors.
  async networkFirst(request) {
    try {
      const res = await fetch(request.url, { cache: "no-store" });
      if (res.status === 200) {
        const cache = await caches.open(DATA_CACHE);
        await cache.put(this.key, res.clone());
        return res;
      }
      return (await this.cached()) || res;
    } catch {
      return (await this.cached()) || Response.error();
    }
  },

  // Fill an empty cache at install so the first offline visit works.
  // Never overwrites: an existing copy is the baseline for change detection.
  async seed() {
    try {
      if (await this.cached()) {
        return;
      }
      const res = await fetch(SYLLABUS_URL, { cache: "no-store" });
      if (res.status === 200) {
        const cache = await caches.open(DATA_CACHE);
        await cache.put(this.key, res);
      }
    } catch {
      // offline at install: the first online page load fills it instead
    }
  },

  // Background refresh (Background Sync or the manual fallback message).
  // Fetch -> compare with the stored copy -> store -> announce only if changed.
  async refresh() {
    const previous = await this.cached();

    // Throwing makes the browser retry the sync later.
    const res = await fetch(SYLLABUS_URL, { cache: "no-store" });
    if (res.status !== 200) {
      throw new Error("Syllabus fetch failed: " + res.status);
    }

    let changed = false;
    if (previous) {
      const [oldText, newText] = await Promise.all([
        previous.clone().text(),
        res.clone().text(),
      ]);
      changed = oldText !== newText;
    }

    const cache = await caches.open(DATA_CACHE);
    await cache.put(this.key, res);

    if (changed) {
      await notifyClients("SYLLABUS_UPDATED");
    }
  },
};

// ---------------------------------------------------------
// 5. VERSION MODULE  ->  posts "VERSION_UPDATED"
// ---------------------------------------------------------
const AppVersion = {
  // Compare the build this worker was made with against version.json on the
  // server (written by the same build script). Stateless: nothing is stored,
  // so it can never disturb the syllabus baseline.
  async check() {
    const res = await fetch(VERSION_URL, { cache: "no-store" });
    if (!res.ok) {
      return;
    }

    let remote = null;
    try {
      remote = await res.json();
    } catch {
      return;
    }

    const latestBuild = remote && remote.build;
    if (!latestBuild || latestBuild === BUILD_ID) {
      return;
    }

    // A newer deploy is live: fetch the new worker now instead of waiting for
    // the browser's own update check. It will skipWaiting() and take over.
    await self.registration.update().catch(() => {});
    await notifyClients("VERSION_UPDATED", { version: remote.version });
  },

  // Called from "activate". True when this worker replaced an older build.
  async announceIfUpgrade(wasUpgrade) {
    if (wasUpgrade) {
      await notifyClients("VERSION_UPDATED", { version: BUILD_ID });
    }
  },
};

// ---------------------------------------------------------
// 6. LIFECYCLE / FETCH / SYNC / MESSAGE WIRING
// ---------------------------------------------------------

// INSTALL - cache the shell, then take over without waiting.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await precacheShell();
      await SyllabusData.seed();
      await self.skipWaiting();
    })(),
  );
});

// ACTIVATE - drop old builds' shells, claim open pages immediately.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const removed = await removeOldShells();
      await self.clients.claim();
      await AppVersion.announceIfUpgrade(removed > 0);
    })(),
  );
});

// FETCH
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!req.url.startsWith("http") || req.method !== "GET") {
    return;
  }

  const url = new URL(req.url);

  // Cross-origin (Google Analytics, Drive previews...) goes straight to network
  if (!isSameOrigin(url)) {
    return;
  }

  // version.json is never served from any cache.
  if (url.pathname === VERSION_URL) {
    return;
  }

  // data.js: network first, own persistent cache.
  if (url.pathname === SYLLABUS_URL) {
    event.respondWith(SyllabusData.networkFirst(req));
    return;
  }

  // Everything else: network first, per-build shell cache.
  event.respondWith(shellNetworkFirst(req));
});

// BACKGROUND SYNC - syllabus refresh when connectivity returns
self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(SyllabusData.refresh());
  }
});

// MESSAGES from the page - each message routes to exactly one module
self.addEventListener("message", (event) => {
  const data = event.data;
  const type = data && data.type ? data.type : data;

  switch (type) {
    case "skipWaiting":
    case "SKIP_WAITING":
      self.skipWaiting();
      break;
    case "CHECK_VERSION":
      event.waitUntil(AppVersion.check().catch(() => {}));
      break;
    case "SYNC_SYLLABUS":
      // Fallback for browsers without Background Sync (Safari / Firefox)
      event.waitUntil(SyllabusData.refresh().catch(() => {}));
      break;
  }
});
