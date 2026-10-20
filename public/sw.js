// Basic offline-caching service worker for Scanner-K. Keeps the app shell and
// previously-visited static assets available offline.
//
// Bump CACHE_VERSION whenever you change the caching rules below, so the old
// cache is evicted on activate instead of living alongside the new one.
//
// v7: cache-first is now limited to the immutable build output. It used to apply
// to every same-origin GET, which also caught Next's RSC payload requests
// (`?_rsc=...`, same URL across deploys). Those were then served from cache
// forever, so a client could hydrate against a payload from an older build.
const CACHE_VERSION = "v7";
const CACHE = `scanner-k-${CACHE_VERSION}`;

// Content-hashed build output: the URL changes when the bytes change, so serving
// it from cache can never be stale. Everything else (RSC payloads, route data,
// API-shaped requests) is left entirely to the browser's normal HTTP handling.
function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    /^\/(icon|favicon)\.(svg|ico|png)$/.test(url.pathname)
  );
}

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

  // Immutable build output: cache-first for speed, warming from the network.
  if (isImmutableAsset(url)) {
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
  }

  // Anything else: not intercepted.
});
