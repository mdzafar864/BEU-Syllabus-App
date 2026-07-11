// =============================
//  UNIVERSAL PWA SW (GitHub + Netlify)
// =============================

const CACHE_NAME = "beu-pwa-v24";

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

// FETCH
self.addEventListener("fetch", event => {
  if (!event.request.url.startsWith("http")) return;

  const req = event.request;

  // HTML → Network First
  if (req.headers.get("accept").includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          return res;
        })
        .catch(() =>
          caches.match(req).then(res => res || caches.match(`${BASE}/index.html`))
        )
    );
    return;
  }

  // Other → Cache First
  event.respondWith(
    caches.match(req).then(cacheRes => {
      return cacheRes || fetch(req).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        return res;
      });
    })
  );
});

// FORCE UPDATE
self.addEventListener("message", event => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
