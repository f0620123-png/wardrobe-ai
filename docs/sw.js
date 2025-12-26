/* docs/sw.js
   - Cache core assets
   - Stale-while-revalidate for static files
   - Network-first for navigations (index.html)
   - Version bump to force refresh
*/

const SW_VERSION = "sw-v1.0.0"; // 每次要強制刷新就改這個字串
const CACHE_NAME = `wardrobe-cache-${SW_VERSION}`;

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
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k !== CACHE_NAME) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isNavigationRequest(req) {
  return req.mode === "navigate" ||
    (req.method === "GET" && req.headers.get("accept")?.includes("text/html"));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // only handle GET
  if (req.method !== "GET") return;

  // Network-first for navigation (fresh UI)
  if (isNavigationRequest(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE_NAME);
        cache.put("./index.html", fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match("./index.html");
        return cached || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  // Stale-while-revalidate for static assets
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });

    const fetchPromise = (async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return null;
      }
    })();

    return cached || (await fetchPromise) || new Response("Offline", { status: 503 });
  })());
});