// service-worker.js (GitHub Pages Version - Auto Update Enabled)

const CACHE_NAME = "beu-syllabus-cache-v3"; // ← Change version on every deploy

const ASSETS = [
  "/BEU-Syllabus-App/",
  "/BEU-Syllabus-App/index.html",
  "/BEU-Syllabus-App/manifest.json",
  "/BEU-Syllabus-App/icon-192.png",
  "/BEU-Syllabus-App/icon-512.png",
  "/BEU-Syllabus-App/logo.png"
];

// ============= INSTALL =============
self.addEventListener("install", event => {
  self.skipWaiting(); // Force SW to activate immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// ============= ACTIVATE =============
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  clients.claim(); // Take control instantly
});

// ============= FETCH (Network First) =============
self.addEventListener("fetch", event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Fresh data → update cache
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => {
        // Offline → return from cache
        return caches.match(event.request).then(cached => {
          return cached || caches.match("/BEU-Syllabus-App/index.html");
        });
      })
  );
});
