const assetsToCache = [
  "/BEU-Syllabus-App/index.html",
  "/BEU-Syllabus-App/manifest.json",
  "/BEU-Syllabus-App/icon-192.png",
  "/BEU-Syllabus-App/icon-512.png"
];

// Install Event
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(assetsToCache))
  );
});

// Fetch Event
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
