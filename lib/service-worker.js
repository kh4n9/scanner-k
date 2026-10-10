// Basic offline-caching service worker for Scanner-K. Keeps the app shell and
// previously-visited static assets available offline; never caches cross-origin
// requests other than the app itself. Handles a fetch to satisfy installability.
//
// Bump the CACHE_VERSION string below whenever you deploy breaking changes so
// old cached assets are evicted and users get the fresh build.
const CACHE_VERSION = "v4";
const CACHE = `scanner-k-${CACHE_VERSION}`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first so the user gets fresh HTML when online, falling
  // back to a cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches
            .match(req)
            .then((c) => c || caches.match("/"))
            .then((c) => c || caches.match("/scan")),
        ),
    );
    return;
  }

  // Static assets: cache-first for speed, warming the cache from the network.
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
          }
          return res;
        }),
    ),
  );
});
