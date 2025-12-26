/* docs/sw.js
 * PWA cache with SWR for assets, network-first for navigations.
 * Includes SKIP_WAITING message for fast update.
 */

const VERSION = "v2025-12-26-01";
const CACHE_NAME = `wardrobe-ai-${VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./db.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // 有些檔案可能不存在（例如你還沒放 icon），用 allSettled 避免整個 install 失敗
      await Promise.allSettled(CORE_ASSETS.map((u) => cache.add(u)));
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Fetch strategy:
// - Navigations: network-first (fallback to cache)
// - Same-origin JS/CSS: stale-while-revalidate
// - Same-origin images: cache-first (fallback network)
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET
  if (req.method !== "GET") return;

  // Navigation
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
    return;
  }

  // Only cache same-origin assets
  if (url.origin !== self.location.origin) return;

  const dest = req.destination;

  if (dest === "script" || dest === "style" || dest === "font") {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  if (dest === "image") {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Default: SWR
  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);
    cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(req);
    return cached || cache.match("./index.html");
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((fresh) => {
      cache.put(req, fresh.clone());
      return fresh;
    })
    .catch(() => null);

  return cached || (await fetchPromise) || cached;
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;

  const fresh = await fetch(req);
  cache.put(req, fresh.clone());
  return fresh;
}