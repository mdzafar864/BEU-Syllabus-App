// service-worker.js (GitHub Pages Version)

const CACHE_NAME = "beu-syllabus-cache-v2";

const ASSETS = [
  "/BEU-Syllabus-App/",
  "/BEU-Syllabus-App/index.html",
  "/BEU-Syllabus-App/manifest.json",
  "/BEU-Syllabus-App/icon-192.png",
  "/BEU-Syllabus-App/icon-512.png",
  "/BEU-Syllabus-App/logo.png"
];

// Install
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      return (
        cached ||
        fetch(event.request).catch(() =>
          caches.match("/BEU-Syllabus-App/index.html")
        )
      );
    })
  );
});
