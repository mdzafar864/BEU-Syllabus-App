// =============================
//  UNIVERSAL PWA SW (GitHub + Netlify)
// =============================

const CACHE_NAME = "beu-pwa-v26";

// 🔥 AUTO detect base path
const BASE = self.location.hostname.includes("github.io")
  ? "/BEU-Syllabus-App"
  : "";

// App shell
const ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/manifest.json`,
  `${BASE}/icon-192.png`,
  `${BASE}/icon-512.png`,
  `${BASE}/logo.png`
];

// INSTALL
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// ACTIVATE
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => key !== CACHE_NAME && caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// FETCH - (Updated for Perfect Offline & Dynamic Update)
self.addEventListener("fetch", event => {
  if (!event.request.url.startsWith("http")) return;

  const req = event.request;

  // Network First Strategy for all assets & files
  event.respondWith(
    fetch(req)
      .then(res => {
        // If response is valid, clone and update the cache dynamically
        if (res.status === 200 || res.status === 0) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return res;
      })
      .catch(() => {
        // Fallback to cache if network fails (Offline mode)
        return caches.match(req).then(cacheRes => {
          if (cacheRes) return cacheRes;
          
          // Specific fallback for HTML pages
          if (req.headers.get("accept") && req.headers.get("accept").includes("text/html")) {
            return caches.match(`${BASE}/index.html`);
          }
        });
      })
  );
});

// FORCE UPDATE
self.addEventListener("message", event => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
