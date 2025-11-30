// =============================
//  BEU Syllabus – Auto-Update SW
// =============================

const CACHE_NAME = "beu-syllabus-cache-v6";   // 🚨 Increase version on every deploy

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
  console.log("[SW] Installing…");
  self.skipWaiting(); // Activate immediately

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log("[SW] Caching assets…");
      return cache.addAll(ASSETS);
    })
  );
});

// ============= ACTIVATE =============
self.addEventListener("activate", event => {
  console.log("[SW] Activating…");

  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log("[SW] Deleting old cache:", key);
            return caches.delete(key);
          }
        })
      )
    )
  );

  clients.claim(); // take over clients immediately
});

// ============= FETCH (Network First) =============
self.addEventListener("fetch", event => {
  // Ignore chrome-extension:// URLs
  if (!event.request.url.startsWith("http")) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Save fresh version to cache
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clone);
        });
        return response;
      })
      .catch(() => {
        // Load from cache when offline
        return caches.match(event.request).then(cached => {
          return cached || caches.match("/BEU-Syllabus-App/index.html");
        });
      })
  );
});

// ========== LISTEN FOR "SKIP WAITING" ==========
self.addEventListener("message", event => {
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
});
